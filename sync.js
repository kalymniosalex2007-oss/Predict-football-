import { state, log } from './store.js';
import { api } from './api.js';
import { athensDate, addDays, slugify, FINISHED } from './util.js';
import { buildAnalysis, parseRecent } from './analysis.js';
import { aiAnalysis } from './ai.js';
import { logPick, settleAll, cornerTotal } from './tracking.js';
import { recordPick, settleLedger } from './ledger.js';
import * as supa from './supa.js';

export const LEAGUES = (process.env.LEAGUE_IDS || '2,3,848,39,140,135,78,61,197,88,94,203,40,144,179,218,207,119,103,113,106,71,128,253,262,62,79,136,141,45,143,137,81,66').split(',').map(Number).filter(Boolean);
const PREMIUM_MIN = Number(process.env.PREMIUM_MIN_PCT || 68);
// Εθνικές ομάδες: αναγνωρίζονται από το id ή από το όνομα της διοργάνωσης
const NAT_IDS = [1, 4, 5, 6, 9, 10, 32, 34, 960];
const NAT_RE = /(World Cup|Nations League|Friendlies|Euro Championship|Copa America|Africa Cup of Nations|Asian Cup|Gold Cup|Qualification|Qualifiers)/i, NAT_NO = /(Club|Women|U\d{2}|Youth|Olympic)/i;
const isNational = l => !NAT_NO.test(l.name) && (NAT_IDS.includes(l.id) || (l.country === 'World' && NAT_RE.test(l.name)));
const prio = m => m.national ? -1 : (i => i < 0 ? 999 : i)(LEAGUES.indexOf(m.league_id));
const now = () => Math.floor(Date.now() / 1000);
const list = () => [...state.matches.values()];
export const pickOdds = (o, id) => o ? ({ '1': o.home, '2': o.away, 'O2.5': o.o25, 'U2.5': o.u25, 'GG': o.gg, 'NG': o.ng })[id] ?? null : null;

// Μέσες αποδόσεις bookmakers από το API (πληροφοριακά)
async function footballOdds(id) {
  const books = (await api('/odds', { fixture: id })).flatMap(r => r.bookmakers || []);
  const get = (bet, val) => { const v = books.map(b => Number(b.bets?.find(x => x.name === bet)?.values?.find(x => x.value === val)?.odd)).filter(x => x > 1); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null; };
  const o = { home: get('Match Winner', 'Home'), draw: get('Match Winner', 'Draw'), away: get('Match Winner', 'Away'), o25: get('Goals Over/Under', 'Over 2.5'), u25: get('Goals Over/Under', 'Under 2.5'), gg: get('Both Teams Score', 'Yes'), ng: get('Both Teams Score', 'No'), books: books.length };
  return o.books && [o.home, o.o25, o.gg].some(Boolean) ? o : null;
}
// Όλοι οι αγώνες της ημέρας αποθηκεύονται· οι «tracked» (λίστα πρωταθλημάτων + εθνικές) παίρνουν σελίδα και ανάλυση
export async function syncFixtures(date) {
  const rows = await api('/fixtures', { date, timezone: 'Europe/Athens' });
  for (const f of rows) {
    const id = f.fixture.id, ts = f.fixture.timestamp, md = athensDate(new Date(ts * 1000));
    const base = { national: isNational(f.league), tracked: LEAGUES.includes(f.league.id) || isNational(f.league), fixture_id: id, match_date: md, kickoff_ts: ts, league_id: f.league.id, league_name: f.league.name, league_country: f.league.country, league_logo: f.league.logo, season: f.league.season, round: f.league.round,
      home_id: f.teams.home.id, home_name: f.teams.home.name, home_logo: f.teams.home.logo, away_id: f.teams.away.id, away_name: f.teams.away.name, away_logo: f.teams.away.logo,
      venue: f.fixture.venue?.name || null, status: f.fixture.status.short, goals_home: f.goals.home, goals_away: f.goals.away,
      ht_home: f.score?.halftime?.home ?? null, ht_away: f.score?.halftime?.away ?? null, ft_home: f.score?.fulltime?.home ?? null, ft_away: f.score?.fulltime?.away ?? null, updated_at: now() };
    const old = state.matches.get(id);
    if (old) { Object.assign(old, base); continue; }
    const taken = s => list().some(m => m.slug === s && m.fixture_id !== id);
    let slug = slugify(`${base.home_name}-vs-${base.away_name}`) || `match-${id}`; const b = slug;
    if (taken(slug)) slug = `${b}-${md}`; if (taken(slug)) slug = `${b}-${id}`;
    state.matches.set(id, { ...base, slug, analysis: null, prediction: null, lineups: null, lineups_try: 0, enriched_at: null, hidden: false, corners: null });
  }
  return rows.length;
}
// Κατάλογος διοργανώσεων: ανεξάρτητος από το πρόγραμμα της ημέρας (1 κλήση την εβδομάδα)
export const refreshLeagues = () => supa.cached('leagues:football', 7 * 86400, async () =>
  (await api('/leagues', { current: 'true' })).map(x => ({ id: x.league.id, name: x.league.name, type: x.league.type, logo: x.league.logo, country: x.country?.name || '', code: x.country?.code || '' })));
async function injuriesFor(date) {
  try {
    const map = {};
    for (const i of await api('/injuries', { date })) (map[i.fixture.id] ||= []).push({ team_id: i.team.id, name: i.player.name, type: i.player.type, reason: i.player.reason });
    return map;
  } catch (e) { log('injuries', false, e.message); return null; }
}
const fmtInj = i => ({ name: i.name, kind: /suspen/i.test(i.reason || '') ? 'Τιμωρία' : 'Τραυματισμός/απουσία', status: i.type === 'Questionable' ? 'Αμφίβολος' : 'Θα απουσιάσει', reason: i.reason });
const splitInj = (m, l) => l == null ? null : { home: l.filter(i => i.team_id === m.home_id).map(fmtInj), away: l.filter(i => i.team_id === m.away_id).map(fmtInj) };

export async function enrichDay(date) {
  const max = Number(process.env.MAX_ANALYSES_PER_DAY || 6);
  const top = list().filter(m => m.match_date === date && m.tracked !== false).sort((a, b) => prio(a) - prio(b) || a.kickoff_ts - b.kickoff_ts).slice(0, max)
    .filter(m => !m.enriched_at && !FINISHED.includes(m.status) && m.kickoff_ts > now());
  if (!top.length) return 0;
  const inj = await injuriesFor(date);
  let done = 0;
  for (const m of top) {
    try {
      let groups = []; try { groups = await supa.cached(`standings:football:${m.league_id}:${m.season}`, 12 * 3600, async () => (await api('/standings', { league: m.league_id, season: m.season }))[0]?.league?.standings || []); } catch (e) { if (/QUOTA/.test(e.message)) throw e; }
      const grp = groups.find(g => g.some(t => t.team.id === m.home_id)) || [];
      const standings = { home: grp.find(t => t.team.id === m.home_id), away: grp.find(t => t.team.id === m.away_id), total: grp.length };
      const pred = (await api('/predictions', { fixture: m.fixture_id }))[0] || null;
      const recent = { home: parseRecent(await api('/fixtures', { team: m.home_id, last: 5 }), m.home_id), away: parseRecent(await api('/fixtures', { team: m.away_id, last: 5 }), m.away_id) };
      if (process.env.ENABLE_CORNERS === 'true') for (const r of [...recent.home, ...recent.away]) r.ct = await cornerTotal(r.id);
      let odds = null; try { odds = await footballOdds(m.fixture_id); } catch (e) { if (/QUOTA/.test(e.message)) throw e; }
      const { analysis, prediction } = buildAnalysis(m, { pred, recent, standings, injuries: splitInj(m, inj?.[m.fixture_id] ?? (inj ? [] : null)) });
      let ai = null; try { ai = await aiAnalysis(m, analysis, prediction, null); } catch (e) { log('ai', false, `${m.slug}: ${e.message}`); }
      // Premium: το προγνωστικό ΔΕΝ γράφεται ποτέ στο δημόσιο repo/HTML. Αποθηκεύεται μόνο στη βάση και το site δείχνει κλειδί.
      const premium = supa.enabled() && prediction.status === 'ok' && prediction.pct >= PREMIUM_MIN && prediction.confidence !== 'Χαμηλό';
      if (prediction.status === 'ok') await recordPick({ sport: 'football', key: `f:${m.fixture_id}`, tier: premium ? 'premium' : 'free', league: m.league_name, home: m.home_name, away: m.away_name,
        kickoff_ts: m.kickoff_ts, pick: prediction, odds: pickOdds(odds, prediction.id), analysis: ai?.text || null, legacy: () => logPick(m, prediction, 'auto') });
      if (premium) Object.assign(m, { analysis, prediction: { status: 'locked', tier: 'premium' }, odds, tier: 'premium', enriched_at: now() });
      else { if (ai) analysis.ai = ai; Object.assign(m, { analysis, prediction, odds, tier: 'free', enriched_at: now() }); }
      done++;
    } catch (e) { log('enrich', false, `${m.slug}: ${e.message}`); if (/QUOTA/.test(e.message)) break; }
  }
  return done;
}
export async function regenAI(m) {
  if (!m.analysis || m.analysis.ai?.edited || m.tier === 'premium') return;
  const ai = await aiAnalysis(m, m.analysis, m.prediction, m.lineups); if (ai) m.analysis.ai = ai;
}
export async function refreshLive() {
  await settleAll(false); await settleLedger(false);
  const t = now(), today = athensDate();
  const act = list().filter(m => [addDays(today, -1), today].includes(m.match_date) && !FINISHED.includes(m.status) && m.kickoff_ts < t + 5400 && m.kickoff_ts > t - 4 * 3600);
  if (!act.length) return;
  for (const m of act.filter(x => x.enriched_at && !x.lineups && x.lineups_try < 6 && x.kickoff_ts - t < 4200)) {
    m.lineups_try++;
    const r = await api('/fixtures/lineups', { fixture: m.fixture_id });
    if (r.length === 2) { m.lineups = r.map(x => ({ team_id: x.team.id, formation: x.formation, coach: x.coach?.name, xi: x.startXI.map(p => ({ n: p.player.number, name: p.player.name, pos: p.player.pos })) })); await regenAI(m).catch(e => log('ai', false, e.message)); }
  }
  for (const d of new Set(act.filter(x => x.kickoff_ts < t).map(x => x.match_date))) await syncFixtures(d);
  await settleAll(false); await settleLedger(false);
}
export async function refreshInjuries() {
  const today = athensDate(), up = list().filter(m => m.match_date === today && m.analysis && m.kickoff_ts > now());
  if (!up.length || now() - (state.meta.injAt || 0) < 10800) return;
  const inj = await injuriesFor(today); if (!inj) return;
  state.meta.injAt = now();
  for (const m of up) m.analysis.injuries = { ...splitInj(m, inj[m.fixture_id] || []), has: true };
}
export async function dailyJob() {
  const today = athensDate(), n = Number(process.env.DAYS_AHEAD || 1);
  if (state.meta.lastDaily !== today) {
    let okToday = false;
    for (const d of [today, addDays(today, -1), ...Array.from({ length: n }, (_, i) => addDays(today, i + 1))]) {
      try { await syncFixtures(d); if (d === today) okToday = true; } catch (e) { log('fixtures', false, `${d}: ${e.message}`); if (/QUOTA/.test(e.message)) break; }
    }
    try { await settleAll(true); await settleLedger(true); } catch (e) { log('settle', false, e.message); }
    try { await refreshLeagues(); } catch (e) { log('leagues', false, e.message); }
    if (okToday) { state.meta.lastDaily = today; log('daily', true, `Φορτώθηκαν αγώνες ${today}`); }
  }
  await enrichDay(today);
  if (process.env.ENRICH_TOMORROW === 'true') await enrichDay(addDays(today, 1));
}

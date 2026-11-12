// Μπάσκετ (API-Basketball): ίδια δομή με το ποδόσφαιρο. Όλα τα παιχνίδια αποθηκεύονται, τα «tracked» αναλύονται.
import fs from 'node:fs'; import path from 'node:path';
import { makeApi } from './api.js';
import { state, log } from './store.js';
import { athensDate, addDays, slugify } from './util.js';
import * as supa from './supa.js';
import { recordPick, registerSettler } from './ledger.js';

const api = makeApi('basketball', process.env.API_BASE_BB || 'https://v1.basketball.api-sports.io');
const DIR = 'data/basketball', now = () => Math.floor(Date.now() / 1000);
export const bb = { games: new Map(), meta: { lastDaily: null, lastRefresh: 0, window: null } };
export const BB_LIVE = ['Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT', 'HT'], BB_DONE = ['FT', 'AOT'], BB_OVER = ['FT', 'AOT', 'CANC', 'AWD', 'ABD'];
const BB_IDS = (process.env.BB_LEAGUE_IDS || '').split(',').map(Number).filter(Boolean);
const BB_RE = /^(NBA|Euroleague|EuroLeague|EuroCup|Eurocup|Basketball Champions League|FIBA Europe Cup|ACB|Liga ACB|LBA|Lega Basket Serie A|BSL|BBL|Basketball Bundesliga|LNB|Pro A|Betclic Elite|A1|Basket League|VTB United League|ABA League|Adriatic)/i;
const tracked = l => BB_IDS.length ? BB_IDS.includes(l.id) : BB_RE.test(l.name) && !/Women|U\d\d|Youth/i.test(l.name);
const prio = g => /^(NBA|Euroleague|EuroLeague)/i.test(g.league_name) ? 0 : 1;
const written = new Map(), rd = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
export function loadBB() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR).filter(x => /^\d{4}-/.test(x))) { const t = rd(path.join(DIR, f)); written.set(f, t); for (const g of JSON.parse(t)) bb.games.set(g.game_id, g); }
  const mt = rd(path.join(DIR, 'meta.json')); if (mt) { Object.assign(bb.meta, JSON.parse(mt)); written.set('meta.json', mt); }
}
export function saveBB() {
  const c1 = addDays(athensDate(), -120), c2 = addDays(athensDate(), -10);
  for (const [id, g] of bb.games) if (g.match_date < c1 || (!g.tracked && g.match_date < c2)) bb.games.delete(id);
  const by = {}; for (const g of bb.games.values()) (by[g.match_date] ||= []).push(g);
  const out = new Map(Object.entries(by).map(([d, l]) => [`${d}.json`, JSON.stringify(l.sort((a, b) => a.kickoff_ts - b.kickoff_ts))])); out.set('meta.json', JSON.stringify(bb.meta));
  for (const [f, t] of out) if (written.get(f) !== t) { fs.writeFileSync(path.join(DIR, f), t); written.set(f, t); }
  for (const f of [...written.keys()]) if (/^\d{4}-/.test(f) && !out.has(f)) { fs.rmSync(path.join(DIR, f), { force: true }); written.delete(f); }
}
export async function syncGames(date) {
  const rows = await api('/games', { date, timezone: 'Europe/Athens' });
  for (const g of rows) {
    const ts = g.timestamp || Math.floor(Date.parse(g.date) / 1000), md = athensDate(new Date(ts * 1000));
    const base = { game_id: g.id, tracked: tracked(g.league), match_date: md, kickoff_ts: ts, league_id: g.league.id, league_name: g.league.name, league_country: g.country?.name || '', league_logo: g.league.logo, season: g.league.season,
      home_id: g.teams.home.id, home_name: g.teams.home.name, home_logo: g.teams.home.logo, away_id: g.teams.away.id, away_name: g.teams.away.name, away_logo: g.teams.away.logo,
      status: g.status.short, score_home: g.scores?.home?.total ?? null, score_away: g.scores?.away?.total ?? null, updated_at: now() };
    const old = bb.games.get(g.id); if (old) { Object.assign(old, base); continue; }
    const taken = s => [...bb.games.values()].some(x => x.slug === s && x.game_id !== g.id);
    let slug = slugify(`${base.home_name}-vs-${base.away_name}`) || `game-${g.id}`; const b = slug;
    if (taken(slug)) slug = `${b}-${md}`; if (taken(slug)) slug = `${b}-${g.id}`;
    bb.games.set(g.id, { ...base, slug, analysis: null, prediction: null, odds: null, enriched_at: null, tier: null });
  }
}
export const refreshLeaguesBB = () => supa.cached('leagues:basketball', 7 * 86400, async () => (await api('/leagues')).map(x => { const l = x.league || x; return { id: l.id, name: l.name, type: l.type, logo: l.logo, country: x.country?.name || '', code: x.country?.code || '' }; }));

// ---- μοντέλο (απλό, με ρητές παραδοχές: πλεονέκτημα έδρας +2 πόντοι, τυπική απόκλιση διαφοράς 11 και συνόλου 17 πόντοι)
const Phi = x => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const HCA = 2, SIG = 11, SIGT = 17, mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const rate = (t, r) => t && t.p >= 5 ? { pf: t.pf / t.p, pa: t.pa / t.p, src: 'season' } : r.length >= 3 ? { pf: mean(r.map(x => x.pf)), pa: mean(r.map(x => x.pa)), src: 'recent' } : null;
export function parseBBOdds(resp) {
  const books = resp.flatMap(r => r.bookmakers || []), avg = a => a.length ? +mean(a).toFixed(2) : null;
  const ml = { h: [], a: [] }, lines = {};
  for (const b of books) for (const bet of b.bets || []) {
    if (/^(Home\/Away|Money ?line)/i.test(bet.name)) { const h = Number(bet.values?.find(v => v.value === 'Home')?.odd), a = Number(bet.values?.find(v => v.value === 'Away')?.odd); if (h > 1 && a > 1) { ml.h.push(h); ml.a.push(a); } }
    else if (/^Over\/Under$/i.test(bet.name)) for (const v of bet.values || []) { const m = /^(Over|Under) (\d+(?:\.\d+)?)$/.exec(v.value); if (m && Number(v.odd) > 1) ((lines[m[2]] ||= { o: [], u: [] })[m[1] === 'Over' ? 'o' : 'u']).push(Number(v.odd)); }
  }
  const best = Object.entries(lines).filter(([, v]) => v.o.length && v.u.length).sort((x, y) => Math.abs(mean(x[1].o) - mean(x[1].u)) - Math.abs(mean(y[1].o) - mean(y[1].u)))[0];
  const o = { home: avg(ml.h), away: avg(ml.a), line: best ? Number(best[0]) : null, over: best ? avg(best[1].o) : null, under: best ? avg(best[1].u) : null, books: books.length };
  return o.books && (o.home || o.line) ? o : null;
}
export function bbPredict(g, a) {
  const H = rate(a.table.home, a.form.home), A = rate(a.table.away, a.form.away);
  if (!H || !A) return { status: 'no_data', note: 'Δεν υπάρχουν επαρκή στατιστικά δεδομένα για αξιόπιστο προγνωστικό.' };
  const he = (H.pf + A.pa) / 2, ae = (A.pf + H.pa) / 2, total = he + ae, margin = he - ae + HCA;
  let ph = Phi(margin / SIG), mk = null;
  const o = a.odds;
  if (o?.home && o?.away) { const s = 1 / o.home + 1 / o.away; mk = 1 / o.home / s; ph = (ph + mk) / 2; }
  const C = [{ id: 'B1', label: `Νίκη ${g.home_name} (1)`, market: 'Νικητής αγώνα', p: ph, w: 1.05 }, { id: 'B2', label: `Νίκη ${g.away_name} (2)`, market: 'Νικητής αγώνα', p: 1 - ph, w: 1.05 }];
  if (o?.line) { const po = 1 - Phi((o.line - total) / SIGT); C.push({ id: `BO${o.line}`, label: `Over ${o.line} πόντοι`, market: 'Over/Under πόντων', p: po, w: .95 }, { id: `BU${o.line}`, label: `Under ${o.line} πόντοι`, market: 'Over/Under πόντων', p: 1 - po, w: .95 }); }
  C.sort((x, y) => y.p * y.w - x.p * x.w);
  const alts = C.map(x => ({ label: x.label, pct: Math.round(Math.min(.85, x.p) * 100) })), b = C[0];
  const reasons = [`Το μοντέλο εκτιμά ${he.toFixed(1)} πόντους για ${g.home_name} και ${ae.toFixed(1)} για ${g.away_name} (συνολικά ${total.toFixed(1)}), με πλεονέκτημα έδρας ${HCA} πόντων (παραδοχή του μοντέλου).`];
  if (H.src === 'recent' || A.src === 'recent') reasons.push('Λόγω έλλειψης βαθμολογίας, το μοντέλο βασίστηκε στους τελευταίους αγώνες (μικρό δείγμα).');
  if (mk !== null) reasons.push('Η πιθανότητα νίκης είναι ο μέσος όρος του μοντέλου και των αποδόσεων της αγοράς.');
  if (a.table.home && a.table.away) reasons.push(`Βαθμολογία: ${g.home_name} ${a.table.home.rank}η (${a.table.home.w}-${a.table.home.l}), ${g.away_name} ${a.table.away.rank}η (${a.table.away.w}-${a.table.away.l}).`);
  if (b.p < .56) return { status: 'no_pick', alts, note: 'Καμία αγορά δεν ξεπερνά το όριο 56%. Δεν προτείνουμε επιλογή για αυτόν τον αγώνα.', reasons };
  let conf = b.p >= .70 ? 2 : b.p >= .62 ? 1 : 0; if (H.src === 'recent' || A.src === 'recent') conf = Math.max(0, conf - 1);
  return { status: 'ok', id: b.id, label: b.label, market: b.market, pct: Math.round(Math.min(.85, b.p) * 100), confidence: ['Χαμηλό', 'Μέτριο', 'Υψηλό'][conf], alts, reasons, source: 'auto' };
}
export const bbPickOdds = (o, id) => !o ? null : id === 'B1' ? o.home : id === 'B2' ? o.away : id.startsWith('BO') && Number(id.slice(2)) === o.line ? o.over : id.startsWith('BU') && Number(id.slice(2)) === o.line ? o.under : null;
const recentOf = (rows, tid) => rows.map(r => ({ date: athensDate(new Date(r.ts * 1000)), opp: r.opp, home: r.home, pf: r.pf, pa: r.pa, res: r.pf > r.pa ? 'W' : 'L' }));
const PREM = () => Number(process.env.PREMIUM_MIN_PCT || 68);
export async function enrichBB(date) {
  const max = Number(process.env.MAX_BB_ANALYSES_PER_DAY || 4);
  const top = [...bb.games.values()].filter(g => g.match_date === date && g.tracked !== false).sort((a, b) => prio(a) - prio(b) || a.kickoff_ts - b.kickoff_ts).slice(0, max)
    .filter(g => !g.enriched_at && !BB_OVER.includes(g.status) && g.kickoff_ts > now());
  for (const g of top) {
    try {
      let st = []; try { st = await supa.cached(`standings:basketball:${g.league_id}:${g.season}`, 12 * 3600, async () => (await api('/standings', { league: g.league_id, season: g.season })).flat().map(x => ({ id: x.team.id, name: x.team.name, logo: x.team.logo, rank: x.position, p: x.games.played, w: x.games.win.total, l: x.games.lose.total, pf: x.points.for, pa: x.points.against, form: x.form, group: x.group?.name }))); } catch (e) { if (/QUOTA/.test(e.message)) throw e; }
      const tg = tid => supa.cached(`teamgames:basketball:${tid}:${g.league_id}:${g.season}`, 6 * 3600, async () => (await api('/games', { team: tid, league: g.league_id, season: g.season }))
        .filter(x => BB_DONE.includes(x.status.short) && x.scores.home.total != null).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 10)
        .map(x => { const home = x.teams.home.id === tid; return { ts: x.timestamp, home, opp: home ? x.teams.away.name : x.teams.home.name, pf: home ? x.scores.home.total : x.scores.away.total, pa: home ? x.scores.away.total : x.scores.home.total }; }));
      const rh = recentOf(await tg(g.home_id)), ra = recentOf(await tg(g.away_id));
      const h2 = await supa.cached(`h2h:basketball:${[g.home_id, g.away_id].sort().join('-')}`, 7 * 86400, async () => (await api('/games', { h2h: `${g.home_id}-${g.away_id}` })).filter(x => BB_DONE.includes(x.status.short) && x.scores.home.total != null)
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 6).map(x => ({ ts: x.timestamp, home_id: x.teams.home.id, home: x.teams.home.name, away: x.teams.away.name, gh: x.scores.home.total, ga: x.scores.away.total })));
      let odds = null; try { odds = parseBBOdds(await api('/odds', { game: g.game_id })); } catch (e) { if (/QUOTA/.test(e.message)) throw e; }
      const t = id => { const s = st.find(x => x.id === id); return s ? { rank: s.rank, p: s.p, w: s.w, l: s.l, pf: s.pf, pa: s.pa } : null; };
      const hw = h2.filter(x => (x.gh > x.ga ? x.home_id : x.home_id === g.home_id ? g.away_id : g.home_id) === g.home_id).length;
      const a = { form: { home: rh, away: ra }, table: { home: t(g.home_id), away: t(g.away_id) }, odds, h2h: { list: h2.map(x => ({ date: athensDate(new Date(x.ts * 1000)), home: x.home, away: x.away, gh: x.gh, ga: x.ga })), hw, aw: h2.length - hw, avg: h2.length ? +mean(h2.map(x => x.gh + x.ga)).toFixed(1) : null } };
      const prediction = bbPredict(g, a);
      const premium = supa.enabled() && prediction.status === 'ok' && prediction.pct >= PREM() && prediction.confidence !== 'Χαμηλό';
      if (prediction.status === 'ok') await recordPick({ sport: 'basketball', key: `b:${g.game_id}`, tier: premium ? 'premium' : 'free', league: g.league_name, home: g.home_name, away: g.away_name, kickoff_ts: g.kickoff_ts, pick: prediction, odds: bbPickOdds(odds, prediction.id),
        legacy: () => { state.picks[`b${g.game_id}`] = { key: `b:${g.game_id}`, sport: 'basketball', pick_id: prediction.id, label: prediction.label, market: prediction.market, pct: prediction.pct, confidence: prediction.confidence, source: 'auto', created_at: now(), result: null, league: g.league_name, kickoff_ts: g.kickoff_ts, home: g.home_name, away: g.away_name, date: g.match_date, odds: bbPickOdds(odds, prediction.id) }; } });
      Object.assign(g, { analysis: a, odds, prediction: premium ? { status: 'locked', tier: 'premium' } : prediction, tier: premium ? 'premium' : 'free', enriched_at: now() });
    } catch (e) { log('enrich-bb', false, `${g.slug}: ${e.message}`); if (/QUOTA/.test(e.message)) break; }
  }
}
// ---- έλεγχος αποτελεσμάτων (συνολικό σκορ με παράταση, όπως στις αγορές των bookmakers)
export const evalBB = (id, gh, ga) => {
  const t = gh + ga; if (id === 'B1') return gh > ga; if (id === 'B2') return ga > gh;
  const m = /^B([OU])(\d+(?:\.\d+)?)$/.exec(id); if (!m) return null; const L = Number(m[2]); if (t === L) return 'push'; return m[1] === 'O' ? t > L : t < L;
};
const settleOne = r => {
  const g = bb.games.get(Number(r.event_key.slice(2))); if (!g) return null;
  if (['CANC', 'AWD', 'ABD'].includes(g.status)) return { result: 'void', score: null };
  if (!BB_DONE.includes(g.status) || g.score_home == null) return null;
  const ok = evalBB(r.pick_id, g.score_home, g.score_away); if (ok === null) return null;
  return { result: ok === 'push' ? 'void' : ok ? 'win' : 'loss', score: `${g.score_home}-${g.score_away}` };
};
registerSettler('basketball', async r => settleOne(r));
export function settleBBLegacy() { // λειτουργία χωρίς Supabase
  for (const pk of Object.values(state.picks)) { if (pk.sport !== 'basketball' || pk.result) continue; const s = settleOne({ event_key: pk.key, pick_id: pk.pick_id }); if (s) { pk.result = s.result; pk.score = s.score; pk.settled_at = now(); } }
}
export async function runBasketball() {
  const today = athensDate(), n = Number(process.env.DAYS_AHEAD || 1);
  if (bb.meta.lastDaily !== today) {
    let ok = false;
    for (const d of [today, addDays(today, -1), ...Array.from({ length: n }, (_, i) => addDays(today, i + 1))]) { try { await syncGames(d); if (d === today) ok = true; } catch (e) { log('games-bb', false, `${d}: ${e.message}`); if (/QUOTA/.test(e.message)) break; } }
    try { await refreshLeaguesBB(); } catch (e) { log('leagues-bb', false, e.message); }
    if (ok) { bb.meta.lastDaily = today; log('daily', true, `Φορτώθηκαν παιχνίδια μπάσκετ ${today}`); }
  } else { // ανανέωση αποτελεσμάτων μόνο αν υπάρχουν παιχνίδια σε εξέλιξη ή που έπρεπε να έχουν τελειώσει
    const t = now(), pend = [...bb.games.values()].filter(g => !BB_OVER.includes(g.status) && g.kickoff_ts < t - 1800 && g.kickoff_ts > t - 6 * 3600);
    if (pend.length && t - (bb.meta.lastRefresh || 0) > 1500) { bb.meta.lastRefresh = t; for (const d of new Set(pend.map(g => g.match_date))) try { await syncGames(d); } catch (e) { log('games-bb', false, e.message); } }
  }
  await enrichBB(today); if (process.env.ENRICH_TOMORROW === 'true') await enrichBB(addDays(today, 1));
}

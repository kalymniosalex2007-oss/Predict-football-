import { state } from './store.js';
import * as supa from './supa.js';
import { evalPick } from './predict.js';
import { cornerTotal } from './tracking.js';
const now = () => Math.floor(Date.now() / 1000), iso = ts => new Date(ts * 1000).toISOString();
const settlers = {}; export const registerSettler = (sport, fn) => { settlers[sport] = fn; };

// Καταγραφή προγνωστικού. Με Supabase: ένα ενιαίο ledger (πίνακας picks) με κανόνες που απαγορεύουν αλλαγή μετά την έναρξη του αγώνα.
export async function recordPick(o) {
  if (!supa.enabled()) return o.legacy?.();
  const p = o.pick;
  await supa.upsert('picks', [{ sport: o.sport, event_key: o.key, tier: o.tier, source: o.source || 'auto', league: o.league, home: o.home, away: o.away, kickoff_at: iso(o.kickoff_ts),
    publish_at: new Date().toISOString(), market: p.market, pick_id: p.id, label: p.label, odds: o.odds, pct: p.pct, confidence: p.confidence, reasoning: p.reasons || [], analysis: o.analysis || null }], 'event_key,source,pick_id');
}
// Έλεγχος αποτελεσμάτων: οι «settlers» κάθε αθλήματος επιστρέφουν {result, score} ή null αν λείπουν δεδομένα
settlers.football = async (r, withApi) => {
  const m = state.matches.get(Number(r.event_key.slice(2))); if (!m) return null;
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(m.status)) return { result: 'void', score: null };
  if (!['FT', 'AET', 'PEN'].includes(m.status)) return null;
  const isC = r.pick_id.startsWith('C');
  if (isC && m.status !== 'FT') return { result: 'void', score: null };
  if (isC && m.corners == null) { if (!withApi) return null; m.corners = await cornerTotal(m.fixture_id); if (m.corners == null) return null; }
  const gh = m.ft_home ?? m.goals_home, ga = m.ft_away ?? m.goals_away;
  const ok = evalPick({ status: 'ok', id: r.pick_id }, gh, ga, { hth: m.ht_home, hta: m.ht_away, corners: m.corners });
  return ok === null ? null : { result: ok ? 'win' : 'loss', score: `${gh}-${ga}` };
};
export async function settleLedger(withApi) {
  if (!supa.enabled()) return;
  const rows = await supa.select('picks', `result=is.null&kickoff_at=lt.${iso(now() - 7200)}&select=id,sport,event_key,pick_id`);
  for (const r of rows) {
    const f = settlers[r.sport]; if (!f || !/^[fb]:/.test(r.event_key)) continue;
    const s = await f(r, withApi); if (s) await supa.patch('picks', `id=eq.${r.id}`, { result: s.result, score: s.score, settled_at: new Date().toISOString() });
  }
}
// Φόρτωση ledger για τις δημόσιες σελίδες. Premium προγνωστικά πριν την έναρξη ΔΕΝ περνούν ποτέ στις δημόσιες σελίδες.
let rows = [];
export async function loadLedger() {
  if (supa.enabled()) { rows = await supa.selectAll('picks', 'select=*&order=kickoff_at.desc'); return; }
  rows = Object.values(state.picks).map(pk => {
    const m = pk.fixture_id ? state.matches.get(pk.fixture_id) : null, bk = pk.sport === 'basketball';
    const ts = bk ? pk.kickoff_ts : m?.kickoff_ts, score = bk ? pk.score : m && m.goals_home != null ? `${m.ft_home ?? m.goals_home}-${m.ft_away ?? m.goals_away}` : null;
    return { sport: bk ? 'basketball' : 'football', event_key: bk ? pk.key : `f:${pk.fixture_id}`, tier: 'free', source: pk.source, league: bk ? pk.league : m?.league_name, home: pk.home, away: pk.away,
      kickoff_at: ts ? iso(ts) : `${pk.date}T12:00:00Z`, market: pk.market, label: pk.label, pct: pk.pct, confidence: pk.confidence, odds: pk.odds || null, result: pk.result, score };
  });
}
const started = r => Date.parse(r.kickoff_at) <= Date.now();
export const publicRows = () => rows.filter(r => r.tier === 'free' || started(r));
export const premiumPendingCount = day => rows.filter(r => r.tier === 'premium' && !started(r) && r.kickoff_at.slice(0, 10) >= day).length;
export const revealed = () => new Map(rows.filter(r => r.tier === 'premium' && started(r)).map(r => [r.event_key, r]));
export const resultMap = () => new Map(publicRows().filter(r => r.result).map(r => [r.event_key, r.result]));

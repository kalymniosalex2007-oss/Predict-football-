// Αποθήκευση σε αρχεία JSON μέσα στο repo (data/). Το GitHub Actions τα κάνει commit μετά από κάθε εκτέλεση.
import fs from 'node:fs'; import path from 'node:path';
import { athensDate, addDays } from './util.js';
const DIR = 'data', DAYS = path.join(DIR, 'days');
export const state = { matches: new Map(), picks: {}, meta: { lastDaily: null, injAt: 0, log: [] } };
const written = new Map();
const rd = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
export function load() {
  fs.mkdirSync(DAYS, { recursive: true });
  for (const f of fs.readdirSync(DAYS).filter(x => x.endsWith('.json'))) {
    const t = rd(path.join(DAYS, f)); written.set(f, t);
    for (const m of JSON.parse(t)) state.matches.set(m.fixture_id, m);
  }
  const p = rd(path.join(DIR, 'picks.json')); if (p) { state.picks = JSON.parse(p); written.set('picks.json', p); }
  const mt = rd(path.join(DIR, 'meta.json')); if (mt) { Object.assign(state.meta, JSON.parse(mt)); written.set('meta.json', mt); }
}
export function log(job, ok, msg) {
  console.log(ok ? 'OK ' : 'ERR', job, msg);
  if (ok && job !== 'daily') return; // στο αρχείο μένουν μόνο σφάλματα και οι ημερήσιες εκτελέσεις
  state.meta.log.unshift({ at: Math.floor(Date.now() / 1000), job, ok, msg: String(msg).slice(0, 300) });
  state.meta.log.length = Math.min(state.meta.log.length, 40);
}
export function save() {
  const cutoff = addDays(athensDate(), -120);
  const cut2 = addDays(athensDate(), -10); // οι αγώνες χωρίς ανάλυση κρατιούνται 10 ημέρες, οι αναλυμένοι 120
  for (const [id, m] of state.matches) if (m.match_date < cutoff || (m.tracked === false && m.match_date < cut2)) state.matches.delete(id);
  const by = {}; for (const m of state.matches.values()) (by[m.match_date] ||= []).push(m);
  const out = new Map(Object.entries(by).map(([d, l]) => [`${d}.json`, JSON.stringify(l.sort((a, b) => a.kickoff_ts - b.kickoff_ts))]));
  out.set('picks.json', JSON.stringify(state.picks)); out.set('meta.json', JSON.stringify(state.meta));
  for (const [f, t] of out) if (written.get(f) !== t) { fs.writeFileSync(path.join(/^\d/.test(f) ? DAYS : DIR, f), t); written.set(f, t); }
  for (const f of [...written.keys()]) if (/^\d{4}-/.test(f) && !out.has(f)) { fs.rmSync(path.join(DAYS, f), { force: true }); written.delete(f); }
}

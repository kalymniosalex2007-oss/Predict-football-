// Χειροκίνητες αλλαγές από το αρχείο data/overrides.json (επεξεργάζεσαι το αρχείο μέσα από το GitHub)
import fs from 'node:fs';
import { state } from './store.js';
import { PICK_IDS, labelOf, marketOf } from './predict.js';
import { logPick } from './tracking.js';
import { enabled as supaOn } from './supa.js';
const now = () => Math.floor(Date.now() / 1000);
export function applyOverrides() {
  let ov = {}; try { ov = JSON.parse(fs.readFileSync('data/overrides.json', 'utf8')); } catch { return; }
  const by = new Map([...state.matches.values()].map(m => { m.hidden = false; return [m.slug, m]; }));
  for (const [slug, o] of Object.entries(ov)) {
    const m = by.get(slug); if (!m || slug.startsWith('_')) continue;
    m.hidden = !!o.hidden;
    if (m.analysis && typeof o.ai_text === 'string' && o.ai_text.trim() && m.analysis.ai?.text !== o.ai_text.trim()) m.analysis.ai = { text: o.ai_text.trim(), edited: true, at: now() };
    if (!supaOn() && m.kickoff_ts > now() && o.pick !== undefined) { // με Supabase τα χειροκίνητα προγνωστικά μπαίνουν από το Admin
      const c = o.pick;
      if (c === null) { if (m.prediction?.source === 'manual' || m.prediction?.status !== 'no_pick') { m.prediction = { status: 'no_pick', note: 'Δεν προτείνεται επιλογή για αυτόν τον αγώνα.', alts: m.prediction?.alts || [], reasons: o.reasons || [] }; logPick(m, m.prediction); } }
      else if (PICK_IDS.includes(c.id) && c.pct >= 1 && c.pct <= 95) {
        const cur = m.prediction;
        if (!(cur?.source === 'manual' && cur.id === c.id && cur.pct === c.pct)) {
          m.prediction = { status: 'ok', id: c.id, label: labelOf(c.id, m), market: marketOf(c.id), pct: c.pct, confidence: ['Χαμηλό', 'Μέτριο', 'Υψηλό'].includes(c.confidence) ? c.confidence : 'Μέτριο', alts: cur?.alts || [], reasons: [], source: 'manual' };
          logPick(m, m.prediction, 'manual');
        }
      }
    }
    if (m.prediction?.status === 'ok' && Array.isArray(o.reasons)) m.prediction.reasons = o.reasons;
  }
}

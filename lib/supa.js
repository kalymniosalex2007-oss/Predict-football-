import fs from 'node:fs'; import path from 'node:path';
const URLB = (process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_SERVICE_KEY || '';
export const enabled = () => !!(URLB && KEY);
async function rest(method, table, { query = '', body, prefer } = {}) {
  const res = await fetch(`${URLB}/rest/v1/${table}${query ? '?' + query : ''}`, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) } });
  if (!res.ok) throw new Error(`Supabase ${method} ${table}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const t = await res.text(); return t ? JSON.parse(t) : null;
}
export const select = (t, q) => rest('GET', t, { query: q });
export async function selectAll(t, q) { const out = []; for (let off = 0; ; off += 1000) { const r = await rest('GET', t, { query: `${q}&limit=1000&offset=${off}` }); out.push(...r); if (r.length < 1000) break; } return out; }
export const upsert = (t, rows, conflict) => rest('POST', t, { query: `on_conflict=${conflict}`, body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
export const patch = (t, q, body) => rest('PATCH', t, { query: q, body, prefer: 'return=minimal' });

// Cache με TTL: στη βάση (Supabase) όταν είναι ενεργή, αλλιώς σε αρχεία data/cache (commit στο repo). Μειώνει τις κλήσεις API.
const file = key => path.join('data/cache', key.replace(/[^\w.-]/g, '_') + '.json');
export async function peek(key) {
  try {
    if (enabled()) { const r = await select('cache', `key=eq.${encodeURIComponent(key)}&select=payload,fetched_at`); return r[0] ? { payload: r[0].payload, at: Date.parse(r[0].fetched_at) / 1000 } : null; }
    const c = JSON.parse(fs.readFileSync(file(key), 'utf8')); return { payload: c.payload, at: c.at };
  } catch { return null; }
}
export async function cached(key, ttlSec, fn) {
  const c = await peek(key); if (c && Date.now() / 1000 - c.at < ttlSec) return c.payload;
  const payload = await fn();
  try {
    if (enabled()) await upsert('cache', [{ key, payload, fetched_at: new Date().toISOString() }], 'key');
    else { fs.mkdirSync('data/cache', { recursive: true }); fs.writeFileSync(file(key), JSON.stringify({ at: Math.floor(Date.now() / 1000), payload })); }
  } catch (e) { console.log('cache write failed', key, e.message); }
  return payload;
}

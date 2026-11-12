// Γενικός client για τα API της API-Sports (Football και Basketball). Το κλειδί διαβάζεται ΜΟΝΟ από μεταβλητές περιβάλλοντος (GitHub Secrets).
export const usage = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function makeApi(name, base) {
  let last = 0; usage[name] = { limit: null, remaining: null, calls: 0, window: null, error: null };
  return async function api(endpoint, params = {}) {
    const key = (name === 'basketball' && process.env.API_BASKETBALL_KEY) || process.env.API_FOOTBALL_KEY;
    if (!key) throw new Error('Λείπει το API_FOOTBALL_KEY στα GitHub Secrets');
    const u = usage[name];
    if (u.remaining !== null && u.remaining <= 5) throw new Error(`QUOTA: τέλος ημερήσιου ορίου κλήσεων (${name})`);
    const wait = last + Number(process.env.API_DELAY_MS ?? 6500) - Date.now(); if (wait > 0) await sleep(wait);
    const url = new URL(base + endpoint); Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url, { headers: { 'x-apisports-key': key } }); last = Date.now(); u.calls++;
    const lim = res.headers.get('x-ratelimit-requests-limit'), rem = res.headers.get('x-ratelimit-requests-remaining');
    if (lim !== null) u.limit = Number(lim); if (rem !== null) u.remaining = Number(rem);
    const fail = msg => { u.error = msg.slice(0, 300); const w = /try from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(msg); if (w) u.window = { from: w[1], to: w[2] }; throw new Error(msg); };
    if (!res.ok) fail(`API ${name} ${res.status} ${endpoint}`);
    const j = await res.json(), e = j.errors;
    if (e && (Array.isArray(e) ? e.length : Object.keys(e).length)) fail(`API ${name}: ${JSON.stringify(e)}`);
    return j.response || [];
  };
}
export const api = makeApi('football', process.env.API_BASE || 'https://v3.football.api-sports.io');

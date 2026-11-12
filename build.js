import fs from 'node:fs'; import path from 'node:path';
import { load, save, state, log } from './lib/store.js';
import { loadBB, saveBB, runBasketball, bb, settleBBLegacy } from './lib/basketball.js';
import { dailyJob, refreshLive, refreshInjuries } from './lib/sync.js';
import { usage } from './lib/api.js';
import * as supa from './lib/supa.js';
import { loadLedger, publicRows, premiumPendingCount, revealed, resultMap } from './lib/ledger.js';
import { applyOverrides } from './lib/overrides.js';
import { matchPage, notFound, SITE } from './lib/render.js';
import * as P from './lib/pages.js';
import { athensDate, addDays } from './lib/util.js';

load(); loadBB();
const hasKey = !!process.env.API_FOOTBALL_KEY; let handled = [];
if (!hasKey) log('config', false, 'Λείπει το μυστικό API_FOOTBALL_KEY: δεν φορτώθηκαν νέα δεδομένα');
if (supa.enabled()) { // αιτήματα χειροκίνητης ανανέωσης από το Admin
  try { const rq = await supa.select('refresh_requests', 'handled_at=is.null&select=id'); if (rq.length) { state.meta.lastDaily = null; bb.meta.lastDaily = null; handled = rq.map(r => r.id); } } catch (e) { log('refresh', false, e.message); }
}
if (hasKey) {
  for (const [n, f] of [['daily', dailyJob], ['live', refreshLive], ['injuries', refreshInjuries], ['basketball', runBasketball]]) { try { await f(); } catch (e) { log(n, false, e.message); } }
  if (!supa.enabled()) settleBBLegacy();
}
if (usage.football.window) state.meta.window = usage.football.window; if (usage.basketball.window) bb.meta.window = usage.basketball.window;
applyOverrides(); save(); saveBB();
if (supa.enabled()) { // καταγραφή χρήσης API και ολοκλήρωση αιτημάτων ανανέωσης
  const day = new Date().toISOString().slice(0, 10), rows = Object.entries(usage).filter(([, u]) => u.limit !== null || u.error).map(([api, u]) => ({ day, api, daily_limit: u.limit, remaining: u.remaining, used: u.limit != null && u.remaining != null ? u.limit - u.remaining : null, error: u.error, updated_at: new Date().toISOString() }));
  try { if (rows.length) await supa.upsert('api_usage', rows, 'day,api'); if (handled.length) await supa.patch('refresh_requests', `id=in.(${handled.join(',')})`, { handled_at: new Date().toISOString() }); } catch (e) { log('usage', false, e.message); save(); }
}
try { await loadLedger(); } catch (e) { log('ledger', false, e.message); }

// ---------- σελίδες
const out = 'dist', put = (p, c) => { const f = path.join(out, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
fs.rmSync(out, { recursive: true, force: true }); fs.cpSync('public', out, { recursive: true }); put('.nojekyll', '');
const today = athensDate(), nowTs = Math.floor(Date.now() / 1000), minDate = addDays(today, -60), maxDate = addDays(today, 30);
const rev = revealed(), res = resultMap();
const fromRow = r => ({ status: 'ok', id: r.pick_id, label: r.label, market: r.market, pct: r.pct, confidence: r.confidence, reasons: r.reasoning || [], alts: [], source: r.source });
const fbList = [...state.matches.values()].filter(m => !m.hidden).map(m => { const r = m.tier === 'premium' && rev.get(`f:${m.fixture_id}`); return r ? { ...m, prediction: fromRow(r), analysis: m.analysis && { ...m.analysis, ai: r.analysis ? { text: r.analysis } : undefined } } : m; });
const bbList = [...bb.games.values()].filter(g => !g.hidden).map(g => { const r = g.tier === 'premium' && rev.get(`b:${g.game_id}`); return r ? { ...g, prediction: fromRow(r) } : g; });
const fb = fbList.map(P.adaptFb), bk = bbList.map(P.adaptBb), all = [...fb, ...bk].sort((a, b) => a.ts - b.ts);
const pub = publicRows(), settled = pub.filter(r => r.result === 'win' || r.result === 'loss'), wins = settled.filter(r => r.result === 'win').length, wu = settled.filter(r => r.odds);
const kpi = { n: settled.length, w: wins, rate: settled.length ? Math.round(wins * 100 / settled.length) : null, yield: wu.length ? +(wu.reduce((s, r) => s + (r.result === 'win' ? r.odds - 1 : -1), 0) * 100 / wu.length).toFixed(1) : null };
// κατάλογοι διοργανώσεων: από το API (ανεξάρτητα από το πρόγραμμα) + όσες υπάρχουν στα αποθηκευμένα δεδομένα
const dir = async (sp, key, rows) => { const l = ((await supa.peek(key))?.payload || []).slice(), ids = new Set(l.map(x => x.id)); for (const r of rows) if (!ids.has(r.lid)) { ids.add(r.lid); l.push({ id: r.lid, name: r.lname, country: r.national ? 'World' : r.lcountry, type: '', logo: r.llogo, code: '' }); } return l.sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name)); };
const lg = { football: await dir('football', 'leagues:football', fb), basketball: await dir('basketball', 'leagues:basketball', bk) };
const dates = []; for (let d = minDate; d <= maxDate; d = addDays(d, 1)) dates.push(d);
for (const [sp, rows, win] of [['football', fb, state.meta.window], ['basketball', bk, bb.meta.window]]) {
  const cfg = P.S[sp];
  for (const d of dates) {
    const day = rows.filter(r => r.date === d).sort((a, b) => a.ts - b.ts), days = { list: [-2, -1, 0, 1, 2, 3, 4].map(i => addDays(d, i)), prev: addDays(d, -1), next: addDays(d, 1) };
    const o = { sp, date: d, today, rows: day, days, win, res, minDate, maxDate };
    put(`${cfg.day.slice(1)}${d}/index.html`, P.dayPageG({ ...o, isRoot: false }));
    if (d === today) put(`${cfg.base.slice(1)}index.html`, P.dayPageG({ ...o, isRoot: true, days: { list: [-1, 0, 1, 2, 3, 4, 5].map(i => addDays(d, i)), prev: addDays(d, -1), next: addDays(d, 1) } }));
  }
  put(`${cfg.leagues.slice(1)}index.html`, P.leaguesPage(sp, lg[sp]));
  for (const L of lg[sp]) {
    const lr = rows.filter(r => r.lid === L.id).sort((a, b) => b.ts - a.ts).slice(0, 40), season = (sp === 'football' ? state.matches : bb.games);
    let st = null; if (lr.length) { const m = [...season.values()].find(x => (x.league_id === L.id)); if (m) st = (await supa.peek(`standings:${sp}:${L.id}:${m.season}`))?.payload || null; }
    put(`${cfg.league.slice(1)}${L.id}/index.html`, P.leaguePage(sp, L, lr, st, win, res));
  }
}
for (const m of fbList) if (m.tracked !== false) put(`predictions/${m.slug}/index.html`, matchPage(m));
for (const g of bbList) if (g.tracked !== false) put(`basketball/game/${g.slug}/index.html`, P.bbGamePage(g, res));
const pop = [...[39, 140, 135, 78, 61, 2, 3, 197].map(id => lg.football.find(l => l.id === id)).filter(Boolean).map(l => ({ ...l, sp: 'football' })), ...lg.basketball.filter(l => /^(NBA|Euroleague|EuroLeague)$/i.test(l.name)).map(l => ({ ...l, sp: 'basketball' }))];
put('index.html', P.homePage({ today, rows: all, res, premCount: premiumPendingCount(today), popular: pop, kpi, window: state.meta.window }));
put('history/index.html', P.historyPage(pub.slice().sort((a, b) => b.kickoff_at.localeCompare(a.kickoff_at))));
put('premium/index.html', P.premiumPage()); put('login/index.html', P.loginPage()); put('account/index.html', P.accountPage()); put('admin/index.html', P.adminPage()); put('contact/index.html', P.contactPage());
put('terms/index.html', P.termsPage()); put('privacy/index.html', P.privacyPage()); put('cookies/index.html', P.cookiesPage()); put('subscription-terms/index.html', P.subTermsPage()); put('responsible-gaming/index.html', P.responsiblePage());
put('stats/index.html', `<!doctype html><meta http-equiv="refresh" content="0;url=${process.env.BASE || ''}/history/"><a href="${process.env.BASE || ''}/history/">Ιστορικό</a>`);
put('events.json', JSON.stringify(P.eventsJson(all, nowTs)));
put('404.html', notFound());
const base = SITE;
const urls = ['/', '/football/', '/basketball/', '/history/', '/premium/', '/contact/', '/terms/', '/privacy/', '/cookies/', '/subscription-terms/', '/responsible-gaming/', '/football/leagues/', '/basketball/leagues/', ...[0, 1, 2].map(i => `/day/${addDays(today, i)}/`), ...[0, 1, 2].map(i => `/basketball/day/${addDays(today, i)}/`),
  ...fbList.filter(m => m.tracked !== false).map(m => `/predictions/${m.slug}/`), ...bbList.filter(g => g.tracked !== false).map(g => `/basketball/game/${g.slug}/`)];
put('robots.txt', `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /account/\nSitemap: ${base}/sitemap.xml\n`);
put('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(x => `<url><loc>${base}${x}</loc></url>`).join('')}</urlset>`);
console.log(`Έτοιμο: ${fbList.length} αγώνες ποδοσφαίρου, ${bbList.length} μπάσκετ, ${pub.length} προγνωστικά στο ιστορικό, ${state.meta.log.filter(l => !l.ok).length} σφάλματα στο ιστορικό`);

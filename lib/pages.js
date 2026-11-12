import fs from 'node:fs';
import { bb, BB_LIVE } from './basketball.js';
import { layout, e, u, NAME, SITE } from './render.js';
import { fmtTime, fmtDay, statusLabel } from './util.js';
import { LEAGUES } from './sync.js';

let SITE_CFG = {}; try { SITE_CFG = JSON.parse(fs.readFileSync('data/site.json', 'utf8')); } catch { /* προαιρετικό */ }
export const S = {
  football: { key: 'football', name: 'Ποδόσφαιρο', base: '/football/', day: '/day/', game: '/predictions/', league: '/football/league/', leagues: '/football/leagues/' },
  basketball: { key: 'basketball', name: 'Μπάσκετ', base: '/basketball/', day: '/basketball/day/', game: '/basketball/game/', league: '/basketball/league/', leagues: '/basketball/leagues/' }
};
export const adaptFb = m => ({ sport: 'football', key: `f:${m.fixture_id}`, tracked: m.tracked !== false, slug: m.slug, ts: m.kickoff_ts, status: m.status, sh: m.goals_home, sa: m.goals_away, home: m.home_name, away: m.away_name, hl: m.home_logo, al: m.away_logo,
  lid: m.league_id, lname: m.league_name, lcountry: m.league_country, llogo: m.league_logo, national: !!m.national, pred: m.prediction, tier: m.tier, date: m.match_date, analysed: !!m.analysis });
export const adaptBb = g => ({ sport: 'basketball', key: `b:${g.game_id}`, tracked: g.tracked !== false, slug: g.slug, ts: g.kickoff_ts, status: g.status, sh: g.score_home, sa: g.score_away, home: g.home_name, away: g.away_name, hl: g.home_logo, al: g.away_logo,
  lid: g.league_id, lname: g.league_name, lcountry: g.league_country, llogo: g.league_logo, national: false, pred: g.prediction, tier: g.tier, date: g.match_date, analysed: !!g.analysis });
const FB_LIVE = ['1H', '2H', 'HT', 'ET', 'P', 'LIVE'], DONE = ['FT', 'AET', 'PEN', 'AOT'];
export const isLive = r => (r.sport === 'football' ? FB_LIVE : BB_LIVE).includes(r.status);
const BBL = { Q1: 'Ζωντανά (1ο δ.)', Q2: 'Ζωντανά (2ο δ.)', Q3: 'Ζωντανά (3ο δ.)', Q4: 'Ζωντανά (4ο δ.)', OT: 'Παράταση', HT: 'Ημίχρονο', BT: 'Διάλειμμα', AOT: 'Τελικό (παρ.)', POST: 'Αναβλήθηκε', SUSP: 'Διακόπηκε' };
const stl = r => r.sport === 'basketball' ? (BBL[r.status] || statusLabel(r.status)) : statusLabel(r.status);
const lgLink = (s, id) => u(S[s].league + id + '/');
const gameLink = r => u(S[r.sport].game + r.slug + '/');
const resChip = (res, key) => { const x = res.get(key); return x && x !== 'void' ? `<em class="${x === 'win' ? 'win' : 'loss'}">${x === 'win' ? 'Επιτυχία' : 'Αποτυχία'}</em>` : ''; };

const card = (r, res) => {
  const p = r.pred;
  const sum = p?.status === 'locked' ? '<span class="chip lock">Premium · κλειδωμένο</span>' : p?.status === 'ok' ? `<span class="chip">${e(p.label)} · ${p.pct}%</span><small>${e(p.reasons?.[0] || '')}</small>${resChip(res, r.key)}`
    : p ? `<small>${e(p.note || '')}</small>` : r.tracked ? '<small>Η ανάλυση δεν έχει δημιουργηθεί ακόμη.</small>' : '<small>Χωρίς ανάλυση (εκτός των διοργανώσεων που αναλύουμε).</small>';
  const t = (n, l, g) => `<div>${l ? `<img src="${e(l)}" alt="" width="28" height="28" loading="lazy">` : ''}${e(n)}${g != null ? `<b class="sc">${g}</b>` : ''}</div>`;
  return `<article class="card"><div class="when"><b>${fmtTime(r.ts)}</b><small class="${isLive(r) ? 'live' : ''}">${e(stl(r))}</small></div><div class="teams">${t(r.home, r.hl, r.sh)}${t(r.away, r.al, r.sa)}</div><div class="sum">${sum}</div>${r.tracked ? `<a class="btn" href="${gameLink(r)}">ΑΝΑΛΥΣΗ ΑΓΩΝΑ</a>` : '<span></span>'}</article>`;
};
const winNote = (win, date) => win && (date < win.from || date > win.to) ? `Το τρέχον πλάνο του API παρέχει δεδομένα αγώνων μόνο από ${win.from} έως ${win.to}. Για άλλες ημερομηνίες απαιτείται αναβάθμιση του πλάνου. Δεν εμφανίζουμε στοιχεία που δεν διαθέτουμε.` : 'Δεν βρέθηκαν αγώνες για αυτή την ημέρα ή δεν έχουν φορτωθεί ακόμη.';

// ---------- σελίδα ημέρας (ποδόσφαιρο και μπάσκετ)
export function dayPageG({ sp, date, today, rows, days, isRoot, win, res, minDate, maxDate }) {
  const cfg = S[sp], groups = [];
  for (const r of rows) { let g = groups.find(x => x.id === r.lid); if (!g) groups.push(g = { id: r.lid, name: r.lname, country: r.lcountry, logo: r.llogo, nat: r.national, items: [] }); g.items.push(r); }
  groups.sort((a, b) => (a.nat ? -1000 : (LEAGUES.indexOf(a.id) + 1 || 999)) - (b.nat ? -1000 : (LEAGUES.indexOf(b.id) + 1 || 999)) || a.name.localeCompare(b.name));
  const countries = [...new Set(groups.map(g => g.nat ? 'Εθνικές ομάδες' : g.country).filter(Boolean))].sort();
  const prevD = days.prev, nextD = days.next;
  const nav = `<p class="selhead">Επίλεξε ημέρα</p><nav class="days" aria-label="Επιλογή ημέρας"><a href="${u(cfg.day + prevD + '/')}" aria-label="Προηγούμενη ημέρα"><b>‹</b><span>Πριν</span></a>${days.list.map(d => `<a href="${u(cfg.day + d + '/')}" class="${d === date ? 'on' : ''}"><b>${fmtDay(d, { weekday: 'short' })}</b><span>${fmtDay(d, { day: 'numeric', month: 'short' })}</span>${d === today ? '<i>Σήμερα</i>' : ''}</a>`).join('')}<a href="${u(cfg.day + nextD + '/')}" aria-label="Επόμενη ημέρα"><b>›</b><span>Μετά</span></a>
<form onsubmit="return false"><label>Ημερολόγιο <input type="date" id="cal" value="${date}" min="${minDate}" max="${maxDate}"></label></form></nav><p class="note" id="calmsg" hidden></p>`;
  const filters = rows.length ? `<div class="filters"><input type="search" id="q" placeholder="Αναζήτηση διοργάνωσης..." aria-label="Αναζήτηση διοργάνωσης"><select id="ctry"><option value="">Όλες οι χώρες</option>${countries.map(c => `<option>${e(c)}</option>`).join('')}</select>
<details><summary>Επιλογή διοργανώσεων</summary><div class="chk">${groups.map(g => `<label><input type="checkbox" value="${g.id}"> ${e(g.name)} (${g.items.length})</label>`).join('')}</div></details></div>` : '';
  const body = `${nav}<h1>${cfg.name}: ${date === today ? 'σημερινοί αγώνες' : fmtDay(date)}</h1><p class="note">Ζωντανά σκορ και αποτελέσματα ανανεώνονται περίπου κάθε 15 λεπτά.</p>${filters}
${rows.length ? '' : `<p class="empty">${e(winNote(win, date))}</p>`}
${groups.map(g => `<section class="league" data-lg="${g.id}" data-country="${e(g.nat ? 'Εθνικές ομάδες' : g.country)}" data-name="${e(g.name.toLowerCase())}"><h2><img src="${e(g.logo || '')}" alt="" width="22" height="22" loading="lazy">${e(g.name)} <small>${g.nat ? 'Εθνικές ομάδες' : e(g.country)}</small> <a class="lglink" href="${lgLink(sp, g.id)}">Πρόγραμμα και βαθμολογία ›</a></h2>${g.items.map(r => card(r, res)).join('')}</section>`).join('')}
<script>(function(){var sel={},q='',c='',cal=document.getElementById('cal'),cm=document.getElementById('calmsg');function ap(){document.querySelectorAll('.league').forEach(function(s){var ok=(!c||s.dataset.country===c)&&(!q||s.dataset.name.indexOf(q)>-1)&&(!Object.keys(sel).length||sel[s.dataset.lg]);s.style.display=ok?'':'none'})}
var qi=document.getElementById('q');if(qi)qi.oninput=function(){q=qi.value.toLowerCase();ap()};var ci=document.getElementById('ctry');if(ci)ci.onchange=function(){c=ci.value;ap()};
document.querySelectorAll('.chk input').forEach(function(i){i.onchange=function(){if(i.checked)sel[i.value]=1;else delete sel[i.value];ap()}});
var m=/[?&]lg=([\\d,]+)/.exec(location.search);if(m){m[1].split(',').forEach(function(x){sel[x]=1;var i=document.querySelector('.chk input[value="'+x+'"]');if(i)i.checked=true});ap()}
cal.onchange=function(){var v=cal.value;if(!v)return;if(v<cal.min||v>cal.max){cm.hidden=false;cm.textContent='Δεν υπάρχουν διαθέσιμα δεδομένα για αυτή την ημερομηνία (διαθέσιμο εύρος: '+cal.min+' έως '+cal.max+').';return}location.href='${u(cfg.day)}'+v+'/'}})()</script>
${isRoot ? `<script>try{var d=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Athens'}).format(new Date());if(d!=='${today}'&&d>='${minDate}'&&d<='${maxDate}')location.replace('${u(cfg.day)}'+d+'/')}catch(x){}</script>` : ''}`;
  return layout({ title: `${cfg.name}: προγνωστικά και αγώνες ${fmtDay(date)} | ${NAME}`, desc: `Όλοι οι αγώνες ${sp === 'football' ? 'ποδοσφαίρου' : 'μπάσκετ'} της ${fmtDay(date)} με αναλύσεις, αποδόσεις και προγνωστικά.`, path: isRoot ? cfg.base : `${cfg.day}${date}/`, body, sport: sp });
}
// ---------- κατάλογος διοργανώσεων (ανεξάρτητος από το πρόγραμμα της ημέρας)
export function leaguesPage(sp, leagues) {
  const cfg = S[sp], countries = [...new Set(leagues.map(l => l.country).filter(Boolean))].sort(), types = [...new Set(leagues.map(l => l.type).filter(Boolean))];
  const body = `<h1>${cfg.name}: όλες οι διοργανώσεις</h1><p class="note">Η λίστα φορτώνεται από το API και δεν εξαρτάται από το αν υπάρχει αγώνας σήμερα. Σύνολο: ${leagues.length}.</p>
<div class="filters"><input type="search" id="lq" placeholder="Αναζήτηση πρωταθλήματος..."><select id="lc"><option value="">Όλες οι χώρες</option>${countries.map(c => `<option>${e(c)}</option>`).join('')}</select><select id="lt"><option value="">Όλοι οι τύποι</option>${types.map(t => `<option>${e(t)}</option>`).join('')}</select></div>
<p><a class="btn" id="go" href="${u(cfg.base)}">Δες αγώνες των επιλεγμένων</a> <small class="note">Επίλεξε ένα ή περισσότερα πρωταθλήματα με τα κουτάκια.</small></p>
<ul class="lgl" id="lgl">${leagues.map(l => `<li data-n="${e(l.name.toLowerCase())}" data-c="${e(l.country)}" data-t="${e(l.type)}"><label><input type="checkbox" value="${l.id}"></label>${l.logo ? `<img src="${e(l.logo)}" alt="" width="20" height="20" loading="lazy">` : ''}<a href="${lgLink(sp, l.id)}">${e(l.name)}</a> <small>${e(l.country)}</small></li>`).join('')}</ul>
<script>(function(){var q='',c='',t='',L=document.querySelectorAll('#lgl li');function ap(){L.forEach(function(li){li.style.display=((!q||li.dataset.n.indexOf(q)>-1)&&(!c||li.dataset.c===c)&&(!t||li.dataset.t===t))?'':'none'})}
document.getElementById('lq').oninput=function(){q=this.value.toLowerCase();ap()};document.getElementById('lc').onchange=function(){c=this.value;ap()};document.getElementById('lt').onchange=function(){t=this.value;ap()};
document.getElementById('lgl').onchange=function(){var v=[].map.call(document.querySelectorAll('#lgl input:checked'),function(i){return i.value});document.getElementById('go').href='${u(cfg.base)}'+(v.length?'?lg='+v.join(','):'')}})()</script>`;
  return layout({ title: `${cfg.name}: όλες οι διοργανώσεις | ${NAME}`, desc: `Πλήρης κατάλογος διοργανώσεων ${sp === 'football' ? 'ποδοσφαίρου' : 'μπάσκετ'} με αναζήτηση και φίλτρα ανά χώρα.`, path: cfg.leagues, body, sport: sp });
}
const standTable = (sp, st) => {
  if (!st?.length) return '<p class="note">Δεν υπάρχει αποθηκευμένη βαθμολογία για αυτή τη διοργάνωση ακόμη (ενημερώνεται όταν αναλύονται αγώνες της).</p>';
  const rows = sp === 'football' ? st.flat().map(x => ({ rank: x.rank, name: x.team.name, p: x.all.played, rec: `${x.all.win}-${x.all.draw}-${x.all.lose}`, g: `${x.all.goals.for}-${x.all.goals.against}`, pts: x.points, form: x.form, grp: x.group }))
    : st.map(x => ({ rank: x.rank, name: x.name, p: x.p, rec: `${x.w}-${x.l}`, g: `${x.pf}-${x.pa}`, pts: '', form: x.form, grp: x.group }));
  return `<div class="scroll"><table><thead><tr><th>#</th><th>Ομάδα</th><th>Αγ.</th><th>${sp === 'football' ? 'Ν-Ι-Η' : 'Ν-Η'}</th><th>${sp === 'football' ? 'Γκολ' : 'Πόντοι'}</th>${sp === 'football' ? '<th>Βαθμοί</th>' : ''}<th>Φόρμα</th></tr></thead><tbody>${rows.map(x => `<tr><td>${x.rank}</td><td>${e(x.name)}</td><td>${x.p}</td><td>${x.rec}</td><td>${x.g}</td>${sp === 'football' ? `<td><b>${x.pts}</b></td>` : ''}<td>${e(x.form || '')}</td></tr>`).join('')}</tbody></table></div>`;
};
export function leaguePage(sp, L, rows, standings, win, res) {
  const cfg = S[sp], byDate = {}; for (const r of rows) (byDate[r.date] ||= []).push(r);
  const body = `<a class="back" href="${u(cfg.leagues)}">‹ Όλες οι διοργανώσεις</a><h1>${L.logo ? `<img src="${e(L.logo)}" alt="" width="34" height="34"> ` : ''}${e(L.name)} <small>${e(L.country)}</small></h1>
<section class="panel"><h2>Βαθμολογία</h2>${standTable(sp, standings)}</section>
<section class="panel"><h2>Πρόγραμμα και αποτελέσματα</h2>${rows.length ? Object.keys(byDate).sort().reverse().map(d => `<h3>${fmtDay(d)}</h3>${byDate[d].map(r => card(r, res)).join('')}`).join('') : `<p class="note">Δεν υπάρχουν αποθηκευμένοι αγώνες για αυτή τη διοργάνωση. ${win ? `Το πλάνο API καλύπτει ${win.from} έως ${win.to}.` : ''} Δεν εμφανίζουμε στοιχεία που δεν διαθέτουμε.</p>`}</section>`;
  return layout({ title: `${L.name} (${L.country}): πρόγραμμα, αποτελέσματα, βαθμολογία | ${NAME}`, desc: `${L.name}: αγώνες, αποτελέσματα και βαθμολογία.`, path: `${cfg.league}${L.id}/`, body, sport: sp });
}
// ---------- αρχική
const pickCard = (r, res) => `<a class="pick" href="${gameLink(r)}"><small>${r.sport === 'football' ? 'Ποδόσφαιρο' : 'Μπάσκετ'} · ${fmtTime(r.ts)} · ${e(r.lname)}</small><strong>${e(r.home)} - ${e(r.away)}</strong><span class="sel">${e(r.pred.label)}</span><em>${r.pred.pct}% · εμπιστοσύνη ${e(r.pred.confidence.toLowerCase())}</em>${resChip(res, r.key)}</a>`;
export function homePage({ today, rows, res, premCount, popular, kpi, window: w }) {
  const free = rows.filter(r => r.pred?.status === 'ok' && r.date === today).sort((a, b) => b.pred.pct - a.pred.pct).slice(0, 6);
  const featured = rows.filter(r => r.tracked && r.date === today).slice(0, 6), live = rows.filter(r => isLive(r)).slice(0, 10);
  const recent = rows.filter(r => DONE.includes(r.status) && r.tracked && r.sh != null).sort((a, b) => b.ts - a.ts).slice(0, 8);
  const sug = rows.filter(r => r.analysed && r.tracked && r.date >= today).slice(0, 4);
  const mini = r => `<a class="mini" href="${gameLink(r)}"><small>${r.sport === 'football' ? 'Ποδόσφαιρο' : 'Μπάσκετ'} · ${fmtTime(r.ts)} · ${e(r.lname)}</small><b>${e(r.home)} - ${e(r.away)}</b>${r.sh != null ? `<span class="sc">${r.sh} - ${r.sa}</span>` : ''}</a>`;
  const body = `<section class="hero home"><h1>Αθλητικά προγνωστικά με ανοιχτό ιστορικό</h1><p>Αναλύσεις ποδοσφαίρου και μπάσκετ βασισμένες σε δεδομένα. Κάθε προγνωστικό καταγράφεται πριν τον αγώνα και ελέγχεται αυτόματα μετά.</p><p class="actions"><a class="btn" href="${u('/football/')}">Ποδόσφαιρο</a> <a class="btn" href="${u('/basketball/')}">Μπάσκετ</a> <a class="btn" href="${u('/premium/')}">Premium</a></p></section>
${kpi ? `<div class="kpis"><div><b>${kpi.rate ?? '—'}${kpi.rate != null ? '%' : ''}</b><span>Ποσοστό επιτυχίας (${kpi.w}/${kpi.n})</span></div><div><b>${kpi.yield ?? '—'}${kpi.yield != null ? '%' : ''}</b><span>Yield (μόνο με γνωστή απόδοση)</span></div><div><a href="${u('/history/')}">Δες όλο το ιστορικό ›</a></div></div>${kpi.n < 30 ? '<p class="note">Μικρό δείγμα: τα ποσοστά δεν είναι ακόμη στατιστικά αξιόπιστα.</p>' : ''}` : ''}
<h2>Σημερινά προγνωστικά</h2>${free.length ? `<div class="grid3">${free.map(r => pickCard(r, res)).join('')}</div>` : '<p class="empty">Δεν υπάρχουν ακόμη δημοσιευμένα προγνωστικά για σήμερα.</p>'}
<section class="locked" id="premium-today" data-day="${today}"><span class="badge">Premium</span> <b>${premCount ? `${premCount} Premium προγνωστικά είναι κλειδωμένα μέχρι την έναρξη των αγώνων` : 'Τα Premium προγνωστικά της ημέρας εμφανίζονται εδώ για συνδρομητές'}</b><p class="note">Οι συνδρομητές βλέπουν επιλογή, απόδοση, πιθανότητα και πλήρη αιτιολόγηση.</p><a class="btn" href="${u('/premium/')}">Δες το Premium</a></section>
${live.length ? `<h2>LIVE αγώνες</h2><div class="minis">${live.map(mini).join('')}</div>` : '<h2>LIVE αγώνες</h2><p class="note">Δεν υπάρχουν αγώνες σε εξέλιξη τη στιγμή της τελευταίας ανανέωσης (κάθε ~15 λεπτά).</p>'}
${featured.length ? `<h2>Επιλεγμένοι αγώνες της ημέρας</h2><div class="minis">${featured.map(mini).join('')}</div>` : ''}
${recent.length ? `<h2>Πρόσφατα αποτελέσματα</h2><div class="minis">${recent.map(mini).join('')}</div>` : ''}
${popular.length ? `<h2>Δημοφιλή πρωταθλήματα</h2><p class="flinks">${popular.map(l => `<a class="chipl" href="${lgLink(l.sp, l.id)}">${e(l.name)}</a>`).join('')}</p>` : ''}
${sug.length ? `<h2>Προτεινόμενες αναλύσεις</h2><div class="minis">${sug.map(mini).join('')}</div>` : ''}
<p class="note">Τα προγνωστικά είναι στατιστικές εκτιμήσεις και δεν αποτελούν εγγύηση κέρδους. ${w ? '' : ''}</p>`;
  return layout({ title: `${NAME}: προγνωστικά ποδοσφαίρου και μπάσκετ`, desc: 'Σημερινά προγνωστικά ποδοσφαίρου και μπάσκετ με αναλύσεις, αποδόσεις και διαφανές ιστορικό επιτυχίας.', path: '/', body, app: true });
}
// ---------- μπάσκετ: σελίδα αγώνα
export function bbNarrative(g) {
  const a = g.analysis, p = g.prediction; if (!a) return [];
  const rec = r => { const w = r.filter(x => x.res === 'W').length; return `${w}-${r.length - w} στους τελευταίους ${r.length} αγώνες, μέσος όρος ${(r.reduce((s, x) => s + x.pf, 0) / r.length).toFixed(1)}-${(r.reduce((s, x) => s + x.pa, 0) / r.length).toFixed(1)} πόντοι`; };
  const tb = (n, t) => t ? `${n}: ${t.rank}η θέση, ${t.w}-${t.l}, μέσος όρος πόντων ${(t.pf / t.p).toFixed(1)}-${(t.pa / t.p).toFixed(1)}.` : '';
  const out = [`Φόρμα. ${a.form.home.length ? `${g.home_name}: ${rec(a.form.home)}.` : `${g.home_name}: δεν υπάρχουν διαθέσιμα πρόσφατα αποτελέσματα.`} ${a.form.away.length ? `${g.away_name}: ${rec(a.form.away)}.` : `${g.away_name}: δεν υπάρχουν διαθέσιμα πρόσφατα αποτελέσματα.`}`];
  out.push(`Βαθμολογία. ${[tb(g.home_name, a.table.home), tb(g.away_name, a.table.away)].filter(Boolean).join(' ') || 'Δεν υπάρχουν διαθέσιμα στοιχεία βαθμολογίας.'}`);
  out.push(a.h2h.list.length ? `Head to Head. Στις τελευταίες ${a.h2h.list.length} μεταξύ τους αναμετρήσεις: νίκες ${g.home_name} ${a.h2h.hw}, νίκες ${g.away_name} ${a.h2h.aw}, μέσο σύνολο ${a.h2h.avg} πόντοι.` : 'Head to Head. Δεν υπάρχει ιστορικό αναμετρήσεων στην πηγή δεδομένων.');
  const o = a.odds; out.push(o ? `Αποδόσεις. ${o.home ? `Νίκη ${g.home_name} ${o.home}, νίκη ${g.away_name} ${o.away}.` : ''} ${o.line ? `Όριο πόντων ${o.line} (Over ${o.over}, Under ${o.under}).` : ''} Μέσος όρος από ${o.books} bookmakers.` : 'Αποδόσεις. Δεν υπάρχουν διαθέσιμες αποδόσεις από την πηγή.');
  out.push(p?.status === 'locked' ? 'Προγνωστικό. Το προγνωστικό αυτού του αγώνα είναι διαθέσιμο σε συνδρομητές Premium μέχρι την έναρξη του αγώνα.' : p?.status === 'ok' ? `Προγνωστικό. ${p.label} με εκτιμώμενη πιθανότητα ${p.pct}% και επίπεδο εμπιστοσύνης ${p.confidence.toLowerCase()}.` : `Προγνωστικό. ${p?.note || 'Δεν υπάρχουν επαρκή δεδομένα.'}`);
  return out;
}
export function bbGamePage(g, res) {
  const a = g.analysis, p = g.prediction, name = `${g.home_name} - ${g.away_name}`, r = adaptBb(g);
  const frm = (n, l) => `<div><h2>Φόρμα: ${e(n)}</h2><div class="form">${l.map(x => `<i class="f${x.res}">${x.res === 'W' ? 'Ν' : 'Η'}</i>`).join('')}</div><ul class="res">${l.map(x => `<li><span>${x.date} ${x.home ? 'vs' : '@'} ${e(x.opp)}</span><b class="${x.res}">${x.pf}-${x.pa}</b></li>`).join('') || '<li>Δεν υπάρχουν διαθέσιμα αποτελέσματα.</li>'}</ul></div>`;
  const o = a?.odds, imp = (x, y) => { const s = 1 / x + 1 / y; return [1 / x / s, 1 / y / s]; }, pc = x => Math.round(x * 100) + '%';
  const oddsP = o ? `<section class="panel"><h2>Αποδόσεις</h2><div class="scroll"><table><thead><tr><th>Αγορά</th><th>Μέση απόδοση</th><th>Πιθανότητα αγοράς</th></tr></thead><tbody>${o.home && o.away ? `<tr><td>Νίκη ${e(g.home_name)}</td><td>${o.home}</td><td>${pc(imp(o.home, o.away)[0])}</td></tr><tr><td>Νίκη ${e(g.away_name)}</td><td>${o.away}</td><td>${pc(imp(o.home, o.away)[1])}</td></tr>` : ''}${o.line ? `<tr><td>Over ${o.line} πόντοι</td><td>${o.over}</td><td>${pc(imp(o.over, o.under)[0])}</td></tr><tr><td>Under ${o.line} πόντοι</td><td>${o.under}</td><td>${pc(imp(o.over, o.under)[1])}</td></tr>` : ''}</tbody></table></div><p class="note">Μέσος όρος από ${o.books} bookmakers (API-Basketball), μετά την αφαίρεση του περιθωρίου κέρδους. Πληροφοριακά. Οι αποδόσεις αλλάζουν συνεχώς.</p></section>` : '';
  const predBox = p?.status === 'locked' ? `<div class="locked" id="premium-box" data-event="b:${g.game_id}"><span class="badge">Premium</span><p>Το προγνωστικό αυτού του αγώνα είναι διαθέσιμο σε συνδρομητές Premium μέχρι την έναρξη του αγώνα.</p><a class="btn" href="${u('/premium/')}">Δες το Premium</a></div>`
    : p?.status === 'ok' ? `<div class="big"><span class="pl">Επιλογή</span><strong>${e(p.label)}</strong></div><dl><div><dt>Αγορά</dt><dd>${e(p.market)}</dd></div><div><dt>Εκτίμηση πιθανότητας</dt><dd>${p.pct}%</dd></div><div><dt>Επίπεδο εμπιστοσύνης</dt><dd>${e(p.confidence)}</dd></div></dl><h3>Αιτιολόγηση</h3><ul class="list">${(p.reasons || []).map(x => `<li>${e(x)}</li>`).join('')}</ul><p class="alts">Αγορές που εξετάστηκαν: ${(p.alts || []).map(x => `<span>${e(x.label)} ${x.pct}%</span>`).join('')}</p>${resChip(res, r.key)}`
    : `<p>${e(p?.note || 'Δεν υπάρχουν επαρκή δεδομένα για προγνωστικό σε αυτόν τον αγώνα.')}</p>`;
  const body = `<a class="back" href="${u('/basketball/day/' + g.match_date + '/')}">‹ Όλοι οι αγώνες</a><section class="hero"><p class="lg"><img src="${e(g.league_logo || '')}" alt="" width="20" height="20">${e(g.league_name)}</p><div class="vs"><div><img src="${e(g.home_logo || '')}" alt="" width="72" height="72"><h1>${e(g.home_name)}</h1></div><div class="mid"><b>${g.score_home != null ? `${g.score_home} - ${g.score_away}` : fmtTime(g.kickoff_ts)}</b><small>${fmtDay(g.match_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</small><small>${e(stl(r))}</small></div><div><img src="${e(g.away_logo || '')}" alt="" width="72" height="72"><h1>${e(g.away_name)}</h1></div></div></section>
${a ? `<section class="panel ai"><h2>Ανάλυση αγώνα <small>(αυτόματη, με βάση τα δεδομένα)</small></h2>${bbNarrative(g).map(x => `<p>${e(x)}</p>`).join('')}<p class="note">Το κείμενο βασίζεται αποκλειστικά στα δεδομένα των ενοτήτων παρακάτω. Τα στατιστικά είναι πραγματικά δεδομένα, το προγνωστικό είναι εκτίμηση.</p></section><section class="panel two">${frm(g.home_name, a.form.home)}${frm(g.away_name, a.form.away)}</section>
<section class="panel"><h2>Head to Head</h2>${a.h2h.list.length ? `<ul class="res">${a.h2h.list.map(x => `<li><span>${x.date} · ${e(x.home)} - ${e(x.away)}</span><b>${x.gh}-${x.ga}</b></li>`).join('')}</ul>` : '<p class="note">Δεν υπάρχει ιστορικό αναμετρήσεων στην πηγή δεδομένων.</p>'}</section>${oddsP}` : '<p class="empty">Η πλήρης ανάλυση αυτού του αγώνα δεν έχει δημιουργηθεί ακόμη. Δεν εμφανίζουμε στοιχεία που δεν έχουμε από αξιόπιστη πηγή.</p>'}
<section class="pred"><h2>Προγνωστικό</h2>${predBox}<p class="note">Η πιθανότητα είναι εκτίμηση απλού στατιστικού μοντέλου. Δεν αποτελεί εγγύηση. 18+, παίξτε υπεύθυνα.</p></section>`;
  const ld = { '@context': 'https://schema.org', '@type': 'SportsEvent', name, startDate: new Date(g.kickoff_ts * 1000).toISOString(), homeTeam: { '@type': 'SportsTeam', name: g.home_name }, awayTeam: { '@type': 'SportsTeam', name: g.away_name } };
  return layout({ ld, title: `${name} Προγνωστικά & Ανάλυση ${fmtDay(g.match_date, { day: 'numeric', month: 'long' })} | ${NAME}`, desc: `${name} (${g.league_name}): ανάλυση, φόρμα, αποδόσεις και προγνωστικό.`, path: `/basketball/game/${g.slug}/`, body, sport: 'basketball', app: g.tier === 'premium' });
}
// ---------- ιστορικό
export function historyPage(rows) {
  const unit = r => r.odds && r.result ? (r.result === 'win' ? +(r.odds - 1).toFixed(2) : r.result === 'loss' ? -1 : 0) : '';
  const R = { win: 'Επιτυχία', loss: 'Αποτυχία', void: 'Επιστροφή' };
  const body = `<h1>Ιστορικό προγνωστικών</h1><p class="note">Κάθε προγνωστικό καταγράφεται πριν την έναρξη του αγώνα και δεν αλλάζει μετά. Τα Premium προγνωστικά εμφανίζονται εδώ από την έναρξη του αγώνα. Αποτέλεσμα 90 λεπτών στο ποδόσφαιρο, με παράταση στο μπάσκετ.</p>
<div class="filters"><select id="fs"><option value="">Όλα τα αθλήματα</option><option value="football">Ποδόσφαιρο</option><option value="basketball">Μπάσκετ</option></select><select id="ft"><option value="">Δωρεάν και Premium</option><option value="free">Μόνο δωρεάν</option><option value="premium">Μόνο Premium</option></select><label>Από <input type="date" id="fa"></label><label>Έως <input type="date" id="fb"></label></div>
<div class="kpis" id="hk"><div><b id="k1">—</b><span>Ποσοστό επιτυχίας</span></div><div><b id="k2">—</b><span>Yield (μόνο με γνωστή απόδοση)</span></div><div><b id="k3">0</b><span>Ολοκληρωμένα</span></div><div><b id="k4">0</b><span>Σε αναμονή</span></div></div>
<p class="note">Yield = (άθροισμα κερδών/ζημιών ανά μονάδα) / (αριθμός προγνωστικών με γνωστή απόδοση). Η απόδοση είναι ο μέσος όρος των bookmakers τη στιγμή της δημοσίευσης. Μικρό δείγμα (κάτω από 30) δεν είναι στατιστικά αξιόπιστο.</p>
<div class="scroll"><table class="hist"><thead><tr><th>Ημ/νία</th><th>Άθλημα</th><th>Αγώνας</th><th>Επιλογή</th><th>Απόδοση</th><th>Πιθ.</th><th>Σκορ</th><th>Κατάσταση</th><th>Κατηγορία</th></tr></thead><tbody id="hb">
${rows.slice(0, 1500).map(r => `<tr data-s="${r.sport}" data-t="${r.tier}" data-d="${r.kickoff_at.slice(0, 10)}" data-r="${r.result || ''}" data-u="${unit(r)}"><td>${r.kickoff_at.slice(0, 10)}</td><td>${r.sport === 'football' ? 'Ποδόσφαιρο' : 'Μπάσκετ'}</td><td>${e(r.home)} - ${e(r.away)}</td><td>${e(r.label)}</td><td>${r.odds ?? '—'}</td><td>${r.pct ?? ''}%</td><td>${e(r.score || '—')}</td><td class="${r.result === 'win' ? 'win' : r.result === 'loss' ? 'loss' : ''}">${R[r.result] || 'Αναμονή'}</td><td>${r.tier === 'premium' ? 'Premium' : 'Δωρεάν'}</td></tr>`).join('')}</tbody></table></div>
<script>(function(){var T=[].slice.call(document.querySelectorAll('#hb tr'));function ap(){var s=fs.value,t=ft.value,a=fa.value,b=fb.value,w=0,l=0,p=0,us=0,un=0;T.forEach(function(r){var d=r.dataset,ok=(!s||d.s===s)&&(!t||d.t===t)&&(!a||d.d>=a)&&(!b||d.d<=b);r.style.display=ok?'':'none';if(!ok)return;if(d.r==='win')w++;else if(d.r==='loss')l++;else if(!d.r)p++;if(d.u!==''){us+=Number(d.u);un++}});
document.getElementById('k1').textContent=(w+l)?Math.round(w*100/(w+l))+'%':'—';document.getElementById('k2').textContent=un?(us*100/un).toFixed(1)+'%':'—';document.getElementById('k3').textContent=w+l;document.getElementById('k4').textContent=p}
var fs=document.getElementById('fs'),ft=document.getElementById('ft'),fa=document.getElementById('fa'),fb=document.getElementById('fb');[fs,ft,fa,fb].forEach(function(x){x.onchange=ap});ap()})()</script>`;
  return layout({ title: `Ιστορικό προγνωστικών | ${NAME}`, desc: 'Διαφανές ιστορικό όλων των προγνωστικών με αποτέλεσμα, ποσοστό επιτυχίας και yield.', path: '/history/', body });
}
export const eventsJson = (rows, now) => rows.filter(r => r.tracked && r.ts > now).map(r => ({ key: r.key, sport: r.sport, league: r.lname, home: r.home, away: r.away, kickoff: new Date(r.ts * 1000).toISOString() }));
// ---------- premium / λογαριασμός / admin / επικοινωνία / νομικά
const pl = SITE_CFG.plans || {}, op = SITE_CFG.operatorName || '[Επωνυμία/Ονοματεπώνυμο υπευθύνου]', mail = SITE_CFG.contactEmail || '';
export function premiumPage() {
  const plan = (k, hl) => `<div class="plan${hl ? ' hl' : ''}"><h2>${e(pl[k]?.label || k)}</h2><div class="price">${e(pl[k]?.price || 'Η τιμή εμφανίζεται στο Stripe Checkout')}</div><button class="btn" data-plan="${k}">Συνδρομή</button></div>`;
  const body = `<h1>Premium</h1><p>Οι Premium συνδρομητές βλέπουν τα προγνωστικά υψηλότερης εκτιμώμενης πιθανότητας πριν την έναρξη των αγώνων, με απόδοση, αιτιολόγηση και πλήρη ανάλυση. Μετά την έναρξη του αγώνα κάθε Premium προγνωστικό γίνεται δημόσιο και μετράει στο ιστορικό.</p>
<ul class="list">${(SITE_CFG.premiumFeatures || []).map(f => `<li>${e(f)}</li>`).join('')}</ul>
<div id="premium-app"><div class="plans">${plan('monthly', false)}${plan('yearly', true)}</div><p class="note">Η πληρωμή γίνεται στο Stripe. Χρειάζεται λογαριασμός: <a href="${u('/login/')}">σύνδεση ή εγγραφή</a>. Ακύρωση ανά πάσα στιγμή από τη σελίδα του λογαριασμού σου. Δες τους <a href="${u('/subscription-terms/')}">όρους συνδρομών</a>. Τα προγνωστικά δεν αποτελούν εγγύηση κέρδους.</p></div>`;
  return layout({ title: `Premium συνδρομή | ${NAME}`, desc: 'Premium προγνωστικά ποδοσφαίρου και μπάσκετ με απόδοση, αιτιολόγηση και πλήρη ανάλυση.', path: '/premium/', body, app: true, attrs: 'data-page="premium"' });
}
const shell = (page, title, h) => layout({ title: `${title} | ${NAME}`, desc: title, path: `/${page}/`, noindex: true, app: true, attrs: `data-page="${page}"`, body: `<h1>${h}</h1><div id="app"><p class="note">Φόρτωση...</p></div>` });
export const loginPage = () => shell('login', 'Σύνδεση', 'Σύνδεση / Εγγραφή');
export const accountPage = () => shell('account', 'Λογαριασμός', 'Ο λογαριασμός μου');
export const adminPage = () => shell('admin', 'Διαχείριση', 'Διαχείριση');
export function contactPage() {
  const body = `<h1>Επικοινωνία</h1>${mail ? `<p>Email: <a href="mailto:${e(mail)}">${e(mail)}</a></p>` : ''}<form class="contact panel" id="cf"><label>Όνομα (προαιρετικό)<input name="name" maxlength="120" autocomplete="name"></label><label>Email<input name="email" type="email" required maxlength="190" autocomplete="email"></label><label>Μήνυμα<textarea name="message" rows="6" required minlength="10" maxlength="4000"></textarea></label><label class="hp" style="position:absolute;left:-9999px">Μην το συμπληρώσεις<input name="website" tabindex="-1" autocomplete="off"></label><button class="btn" type="submit">Αποστολή</button> <span id="cmsg" class="note"></span></form><p class="note">Με την αποστολή αποδέχεσαι την <a href="${u('/privacy/')}">Πολιτική απορρήτου</a>. Τα στοιχεία χρησιμοποιούνται μόνο για να απαντήσουμε στο μήνυμά σου.</p>`;
  return layout({ title: `Επικοινωνία | ${NAME}`, desc: 'Επικοινωνία με την ομάδα.', path: '/contact/', body, app: true, attrs: 'data-page="contact"' });
}
const prose = (path, title, secs) => layout({ title: `${title} | ${NAME}`, desc: title, path, body: `<div class="prose"><h1>${title}</h1><p class="note">Τελευταία ενημέρωση: ${new Date().toISOString().slice(0, 10)}</p>${secs.map(([h, t]) => `<h2>${h}</h2>${[].concat(t).map(x => `<p>${x}</p>`).join('')}`).join('')}</div>` });
const contactLine = mail ? `Επικοινωνία: ${e(mail)}.` : `Επικοινωνία: μέσω της <a href="${u('/contact/')}">φόρμας επικοινωνίας</a>.`;
export const termsPage = () => prose('/terms/', 'Όροι χρήσης', [
  ['1. Φορέας και αποδοχή', `Η ιστοσελίδα ${e(NAME)} λειτουργεί από: ${e(op)}${SITE_CFG.operatorAddress ? `, ${e(SITE_CFG.operatorAddress)}` : ''}${SITE_CFG.operatorVat ? `, ΑΦΜ ${e(SITE_CFG.operatorVat)}` : ''}. ${contactLine} Χρησιμοποιώντας την ιστοσελίδα αποδέχεσαι τους παρόντες όρους.`],
  ['2. Χαρακτήρας υπηρεσίας', 'Η ιστοσελίδα παρέχει πληροφοριακό περιεχόμενο: στατιστικά, αναλύσεις και εκτιμήσεις. Δεν είναι πάροχος τυχερών παιγνίων, δεν δέχεται στοιχήματα και δεν παρέχει επενδυτικές ή στοιχηματικές συμβουλές.'],
  ['3. Καμία εγγύηση', 'Τα προγνωστικά είναι στατιστικές εκτιμήσεις και δεν αποτελούν εγγύηση κέρδους. Τα παρελθόντα αποτελέσματα δεν εγγυώνται μελλοντικά. Το στοίχημα ενέχει κίνδυνο απώλειας χρημάτων. Συμμετέχεις με δική σου ευθύνη.'],
  ['4. Ηλικία και νομιμότητα', 'Η χρήση απευθύνεται αποκλειστικά σε άτομα άνω των 18 ετών. Ευθύνεσαι να ελέγξεις ότι η χρήση και το στοίχημα είναι νόμιμα στη χώρα σου.'],
  ['5. Πηγές δεδομένων και αποδόσεις', 'Τα δεδομένα προέρχονται από τρίτους παρόχους (API-Football, API-Basketball) και μπορεί να είναι ελλιπή, καθυστερημένα ή λανθασμένα. Οι αποδόσεις είναι μέσοι όροι bookmakers, πληροφοριακές και μεταβάλλονται συνεχώς. Μέρος των κειμένων δημιουργείται αυτόματα και μπορεί να περιέχει λάθη.'],
  ['6. Λογαριασμός και συνδρομές', `Για την πρόσβαση σε Premium περιεχόμενο απαιτείται λογαριασμός. Ευθύνεσαι για την ασφάλεια των στοιχείων σου. Οι συνδρομές διέπονται από τους <a href="${u('/subscription-terms/')}">Όρους συνδρομών και ακυρώσεων</a>. Απαγορεύεται η κοινοποίηση ή αναδιανομή Premium περιεχομένου πριν γίνει δημόσιο.`],
  ['7. Πνευματική ιδιοκτησία', 'Το περιεχόμενο και ο σχεδιασμός ανήκουν στον φορέα ή στους παρόχους τους. Απαγορεύεται η μαζική αντιγραφή ή αυτοματοποιημένη εξαγωγή χωρίς άδεια.'],
  ['8. Περιορισμός ευθύνης', 'Στον βαθμό που επιτρέπει ο νόμος, ο φορέας δεν ευθύνεται για ζημιές από τη χρήση της ιστοσελίδας ή την εμπιστοσύνη στα προγνωστικά. Τα δικαιώματα του καταναλωτή που προβλέπει η νομοθεσία δεν θίγονται.'],
  ['9. Αλλαγές και εφαρμοστέο δίκαιο', 'Οι όροι μπορεί να τροποποιούνται, και η ισχύς τους ξεκινά από την ανάρτησή τους. Εφαρμόζεται το ελληνικό δίκαιο, με την επιφύλαξη των αναγκαστικού δικαίου διατάξεων για καταναλωτές.']]);
export const privacyPage = () => prose('/privacy/', 'Πολιτική απορρήτου', [
  ['Υπεύθυνος επεξεργασίας', `${e(op)}. ${contactLine}`],
  ['Ποια δεδομένα συλλέγουμε', 'Λογαριασμός: email και κρυπτογραφημένος κωδικός (διαχειρίζεται η υπηρεσία Supabase). Συνδρομή: κατάσταση, πλάνο, ημερομηνία λήξης και κωδικός πελάτη Stripe· τα στοιχεία κάρτας τα επεξεργάζεται μόνο το Stripe και δεν φτάνουν σε εμάς. Φόρμα επικοινωνίας: όνομα (προαιρετικά), email και μήνυμα.'],
  ['Σκοποί και νομική βάση', 'Παροχή λογαριασμού και συνδρομής (εκτέλεση σύμβασης), απάντηση σε μηνύματα (έννομο συμφέρον/αίτημά σου), τήρηση λογιστικών υποχρεώσεων (νομική υποχρέωση).'],
  ['Τρίτοι πάροχοι', 'GitHub (φιλοξενία ιστοσελίδας), Supabase (βάση δεδομένων και ταυτοποίηση), Stripe (πληρωμές), API-Sports (εικόνες ομάδων/διοργανώσεων). Η φόρτωση σελίδων επικοινωνεί με τις διευθύνσεις αυτές και ενδέχεται να μεταδοθεί η διεύθυνση IP.'],
  ['Διατήρηση', 'Τα δεδομένα λογαριασμού διατηρούνται όσο υπάρχει ο λογαριασμός. Τα μηνύματα επικοινωνίας διατηρούνται όσο χρειάζεται για την απάντηση. Τα λογιστικά στοιχεία διατηρούνται όσο ορίζει ο νόμος.'],
  ['Τα δικαιώματά σου', 'Έχεις δικαίωμα πρόσβασης, διόρθωσης, διαγραφής, περιορισμού, εναντίωσης και φορητότητας. Μπορείς να υποβάλεις καταγγελία στην Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα (dpa.gr).']]);
export const cookiesPage = () => prose('/cookies/', 'Πολιτική cookies', [
  ['Τι χρησιμοποιούμε', 'Η ιστοσελίδα δεν χρησιμοποιεί cookies διαφήμισης ή στατιστικών. Όταν συνδέεσαι, η υπηρεσία Supabase αποθηκεύει το διακριτικό σύνδεσης στην τοπική αποθήκευση (localStorage) του προγράμματος περιήγησης, αυστηρά απαραίτητο για τη λειτουργία του λογαριασμού.'],
  ['Στο Stripe', 'Όταν μεταβαίνεις στη σελίδα πληρωμής, το Stripe μπορεί να χρησιμοποιεί δικά του cookies. Δες την πολιτική του.'],
  ['Έλεγχος', 'Μπορείς να διαγράψεις τα δεδομένα της ιστοσελίδας από τις ρυθμίσεις του προγράμματος περιήγησης. Θα αποσυνδεθείς.']]);
export const subTermsPage = () => prose('/subscription-terms/', 'Όροι συνδρομών και ακυρώσεων', [
  ['Τι περιλαμβάνει', 'Η Premium συνδρομή δίνει πρόσβαση, όσο είναι ενεργή, στα Premium προγνωστικά πριν την έναρξη των αγώνων, με την απόδοση και την αιτιολόγησή τους. Δεν εγγυάται κέρδος.'],
  ['Χρέωση και ανανέωση', 'Οι συνδρομές (μηνιαία ή ετήσια) ανανεώνονται αυτόματα στο τέλος κάθε περιόδου μέχρι να ακυρωθούν. Η τιμή και ο φόρος εμφανίζονται στη σελίδα πληρωμής του Stripe πριν την επιβεβαίωση. Η πληρωμή γίνεται μέσω Stripe.'],
  ['Ενεργοποίηση και λήξη', 'Η πρόσβαση ενεργοποιείται αυτόματα μετά την επιβεβαιωμένη πληρωμή και απενεργοποιείται αυτόματα όταν η συνδρομή λήξει ή ακυρωθεί ή όταν η πληρωμή αποτύχει και δεν διορθωθεί.'],
  ['Ακύρωση', `Μπορείς να ακυρώσεις οποτεδήποτε από τη σελίδα <a href="${u('/account/')}">Λογαριασμός</a> (πύλη διαχείρισης Stripe). Η ακύρωση ισχύει από το τέλος της τρέχουσας περιόδου και διατηρείς την πρόσβαση μέχρι τότε.`],
  ['Επιστροφές', `Τα δικαιώματά σου ως καταναλωτή (π.χ. δικαίωμα υπαναχώρησης για συμβάσεις εξ αποστάσεως, με τις εξαιρέσεις που προβλέπει ο νόμος για την άμεση παροχή ψηφιακού περιεχομένου) δεν θίγονται. ${contactLine} Για ζητήματα χρέωσης επικοινώνησε μαζί μας.`],
  ['Κατάχρηση', 'Η κοινή χρήση λογαριασμού ή η αναδιανομή Premium προγνωστικών πριν γίνουν δημόσια μπορεί να οδηγήσει σε αναστολή του λογαριασμού.']]);
export const responsiblePage = () => prose('/responsible-gaming/', 'Υπεύθυνο παιχνίδι', [
  ['Τα προγνωστικά δεν είναι εγγύηση', 'Κανένα προγνωστικό δεν εγγυάται αποτέλεσμα. Ακόμη και τα πιο ισχυρά στατιστικά μοντέλα αποτυγχάνουν συχνά. Στοιχημάτισε μόνο χρήματα που αντέχεις να χάσεις.'],
  ['Συμβουλές', 'Όρισε όριο ποσού και χρόνου πριν παίξεις. Μην κυνηγάς τις απώλειες. Μην στοιχηματίζεις υπό την επήρεια αλκοόλ ή έντονου στρες. Το στοίχημα δεν είναι τρόπος βιοπορισμού.'],
  ['Ζητήματα εξάρτησης', 'Αν το στοίχημα επηρεάζει την προσωπική, οικονομική ή οικογενειακή σου ζωή, απευθύνσου σε εξειδικευμένη υπηρεσία υποστήριξης και μίλα σε κάποιον που εμπιστεύεσαι. Η Επιτροπή Εποπτείας και Ελέγχου Παιγνίων (ΕΕΕΠ) δημοσιεύει πληροφορίες για τον υπεύθυνο τζόγο στην ιστοσελίδα της.'],
  ['Ηλικία', 'Το στοίχημα επιτρέπεται μόνο σε άτομα άνω των 18 ετών.']]);

// Frontend λογαριασμών, Premium και Admin. Χρησιμοποιεί ΜΟΝΟ το δημόσιο anon key· η προστασία των δεδομένων γίνεται από τους κανόνες RLS της βάσης.
const cfg = window.__CFG || {}, base = cfg.base || '', page = document.body.dataset.page || '';
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
let _sb; async function sb() { if (!cfg.supabaseUrl || !cfg.anonKey) return null; if (!_sb) { const { createClient } = await import(CDN); _sb = createClient(cfg.supabaseUrl, cfg.anonKey); } return _sb; }
const $ = (s, r = document) => r.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = iso => iso ? new Date(iso).toLocaleString('el-GR', { timeZone: 'Europe/Athens', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const msg = (el, t, cls = '') => { el.innerHTML = `<div class="msg ${cls}">${esc(t)}</div>`; };
async function status() {
  const c = await sb(); if (!c) return null;
  const { data: { session } } = await c.auth.getSession(); if (!session) return { session: null };
  const { data } = await c.rpc('me_status'); return { session, ...(data || {}) };
}
const pickCard = p => `<div class="pcard"><small>${p.sport === 'football' ? 'Ποδόσφαιρο' : 'Μπάσκετ'} · ${esc(p.league || '')} · ${fmt(p.kickoff_at)}</small><h3>${esc(p.home)} - ${esc(p.away)}</h3><div class="sel">${esc(p.label)}</div>
<p>${p.odds ? `Απόδοση ${p.odds} · ` : ''}Πιθανότητα ${p.pct ?? '—'}% · Εμπιστοσύνη ${esc(p.confidence || '—')}${p.tier === 'premium' ? ' <span class="badge">Premium</span>' : ''}</p>
${p.reasoning?.length ? `<ul class="list">${p.reasoning.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}${p.analysis ? `<p>${esc(p.analysis).replace(/\n\n/g, '</p><p>')}</p>` : ''}</div>`;
const loginUrl = (next) => `${base}/login/?next=${encodeURIComponent(next || location.pathname)}`;
async function call(fn, plan) {
  const s = await status(); if (!s?.session) { location.href = loginUrl(); return; }
  const r = await fetch(`${cfg.functionsUrl}/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session.access_token}`, apikey: cfg.anonKey }, body: JSON.stringify({ plan }) });
  const j = await r.json().catch(() => ({})); if (!r.ok || !j.url) throw new Error(j.error || 'Σφάλμα'); location.href = j.url;
}
// ---- Premium: ξεκλείδωμα κουτιών στις σελίδες αγώνων και στην αρχική
async function unlock() {
  const box = $('#premium-box'), day = $('#premium-today'); if (!box && !day) return;
  const s = await status(); if (!s) return;
  const c = await sb();
  if (!s.session) { for (const el of [box, day]) if (el) el.insertAdjacentHTML('beforeend', `<p><a href="${loginUrl()}">Συνδέσου</a> αν έχεις Premium συνδρομή.</p>`); return; }
  if (!s.is_premium && !s.is_admin) { for (const el of [box, day]) if (el) el.insertAdjacentHTML('beforeend', '<p class="note">Ο λογαριασμός σου δεν έχει ενεργή Premium συνδρομή.</p>'); return; }
  if (box) { const { data } = await c.from('picks').select('*').eq('event_key', box.dataset.event).eq('tier', 'premium'); if (data?.length) { box.classList.remove('locked'); box.innerHTML = data.map(pickCard).join(''); } }
  if (day) { const { data } = await c.from('picks').select('*').eq('tier', 'premium').gte('kickoff_at', new Date().toISOString()).order('kickoff_at').limit(40); if (data?.length) { day.classList.remove('locked'); day.innerHTML = `<h2>Premium προγνωστικά</h2>${data.map(pickCard).join('')}`; } }
}
// ---- Σελίδα Premium
async function premium() {
  const el = $('#premium-app'); const s = await status();
  if (!s) { msg(el, 'Οι συνδρομές δεν έχουν ενεργοποιηθεί ακόμη.'); return; }
  const go = (btn, fn, plan) => btn.onclick = async () => { btn.disabled = true; try { await call(fn, plan); } catch (e) { msg($('#pmsg') || el, e.message, 'err'); btn.disabled = false; } };
  if (s.is_premium) {
    const c = await sb(); const { data } = await c.from('picks').select('*').eq('tier', 'premium').gte('kickoff_at', new Date(Date.now() - 6 * 3600e3).toISOString()).order('kickoff_at').limit(60);
    el.innerHTML = `<p class="msg ok">Η Premium συνδρομή σου είναι ενεργή${s.subscription?.current_period_end ? ` μέχρι ${fmt(s.subscription.current_period_end)}` : ''}.</p><p><button class="btn" id="mng">Διαχείριση συνδρομής</button> <a href="${base}/account/">Λογαριασμός</a></p><h2>Premium προγνωστικά</h2>${data?.length ? data.map(pickCard).join('') : '<p class="note">Δεν υπάρχουν ακόμη Premium προγνωστικά για τους επόμενους αγώνες.</p>'}`;
    go($('#mng'), 'customer-portal'); return;
  }
  $('#premium-app').insertAdjacentHTML('beforeend', '<div id="pmsg"></div>');
  document.querySelectorAll('[data-plan]').forEach(b => go(b, 'create-checkout', b.dataset.plan));
  if (!s.session) el.insertAdjacentHTML('afterbegin', `<p class="msg">Για συνδρομή χρειάζεται <a href="${loginUrl(base + '/premium/')}">σύνδεση ή εγγραφή</a>.</p>`);
  if (new URLSearchParams(location.search).get('checkout') === 'cancel') msg($('#pmsg'), 'Η πληρωμή ακυρώθηκε. Δεν έγινε καμία χρέωση.');
}
// ---- Σύνδεση / εγγραφή
async function login() {
  const el = $('#app'), c = await sb(); if (!c) { msg(el, 'Οι λογαριασμοί δεν έχουν ενεργοποιηθεί ακόμη.'); return; }
  const next = new URLSearchParams(location.search).get('next');
  el.innerHTML = `<form class="contact panel" id="lf"><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Κωδικός (τουλάχιστον 8 χαρακτήρες)<input name="password" type="password" minlength="8" autocomplete="current-password"></label>
<button class="btn" data-a="in">Σύνδεση</button> <button class="btn sm" data-a="up" type="button">Εγγραφή</button> <button class="lnk" data-a="reset" type="button">Ξέχασα τον κωδικό</button><div id="lm"></div></form>`;
  const f = $('#lf'), lm = $('#lm'), redirectTo = `${location.origin}${base}/account/`;
  const run = async a => {
    const email = f.email.value.trim(), password = f.password.value; lm.innerHTML = '';
    try {
      if (a === 'reset') { const { error } = await c.auth.resetPasswordForEmail(email, { redirectTo }); if (error) throw error; return msg(lm, 'Αν υπάρχει λογαριασμός, στάλθηκε email για νέο κωδικό.', 'ok'); }
      if (a === 'up') { const { data, error } = await c.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }); if (error) throw error; return msg(lm, data.session ? 'Η εγγραφή ολοκληρώθηκε.' : 'Στάλθηκε email επιβεβαίωσης. Πάτα τον σύνδεσμο και μετά συνδέσου.', 'ok'); }
      const { error } = await c.auth.signInWithPassword({ email, password }); if (error) throw error;
      location.href = next && next.startsWith('/') ? next : `${base}/account/`;
    } catch (e) { msg(lm, e.message === 'Invalid login credentials' ? 'Λάθος email ή κωδικός.' : e.message, 'err'); }
  };
  f.onsubmit = ev => { ev.preventDefault(); run('in'); }; f.querySelectorAll('[data-a]').forEach(b => { if (b.type === 'button') b.onclick = () => run(b.dataset.a); });
}
// ---- Λογαριασμός
async function account() {
  const el = $('#app'), c = await sb(); if (!c) { msg(el, 'Οι λογαριασμοί δεν έχουν ενεργοποιηθεί ακόμη.'); return; }
  c.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') el.innerHTML = '<form class="contact panel" id="pw"><label>Νέος κωδικός<input name="p" type="password" minlength="8" required></label><button class="btn">Αλλαγή κωδικού</button><div id="pm"></div></form>', $('#pw').onsubmit = async e => { e.preventDefault(); const { error } = await c.auth.updateUser({ password: e.target.p.value }); msg($('#pm'), error ? error.message : 'Ο κωδικός άλλαξε.', error ? 'err' : 'ok'); }; });
  let s = await status(); if (!s?.session) { el.innerHTML = `<p>Δεν είσαι συνδεδεμένος. <a href="${loginUrl()}">Σύνδεση / Εγγραφή</a></p>`; return; }
  if (new URLSearchParams(location.search).get('checkout') === 'success') { // το Stripe ειδοποιεί τη βάση μέσω webhook· περιμένουμε λίγα δευτερόλεπτα
    el.innerHTML = '<p class="msg ok">Η πληρωμή ολοκληρώθηκε. Ενεργοποίηση της συνδρομής...</p>';
    for (let i = 0; i < 12 && !s.is_premium; i++) { await new Promise(r => setTimeout(r, 2500)); s = await status(); }
  }
  const sub = s.subscription, active = s.is_premium;
  el.innerHTML = `<div class="panel"><p>Email: <b>${esc(s.email || s.session.user.email)}</b></p><p>Premium: <b class="${active ? 'win' : ''}">${active ? 'Ενεργό' : 'Ανενεργό'}</b>${sub?.current_period_end ? ` · ${sub.cancel_at_period_end ? 'λήγει' : 'ανανεώνεται'} στις ${fmt(sub.current_period_end)}` : ''}${sub && sub.status !== 'active' ? ` · κατάσταση: ${esc(sub.status)}` : ''}</p>
<p class="actions">${sub && !sub.id.startsWith('manual_') ? '<button class="btn" id="mng">Διαχείριση / ακύρωση συνδρομής</button>' : ''}${active ? '' : `<a class="btn" href="${base}/premium/">Δες τα πλάνα Premium</a>`}${s.is_admin ? `<a class="btn" href="${base}/admin/">Διαχείριση</a>` : ''} <button class="btn sm" id="out">Αποσύνδεση</button></p><div id="am"></div></div>`;
  if ($('#mng')) $('#mng').onclick = async () => { try { await call('customer-portal'); } catch (e) { msg($('#am'), e.message, 'err'); } };
  $('#out').onclick = async () => { await c.auth.signOut(); location.href = `${base}/`; };
}
// ---- Επικοινωνία
async function contact() {
  const f = $('#cf'), m = $('#cmsg'); f.onsubmit = async e => {
    e.preventDefault(); if (f.website.value) return; const c = await sb(); if (!c) { m.textContent = 'Η φόρμα δεν είναι ενεργή ακόμη. Χρησιμοποίησε το email επικοινωνίας.'; return; }
    m.textContent = 'Αποστολή...'; const { error } = await c.from('contact_messages').insert({ name: f.name.value.trim() || null, email: f.email.value.trim(), message: f.message.value.trim() });
    m.textContent = error ? 'Δεν στάλθηκε. Δοκίμασε ξανά ή χρησιμοποίησε το email.' : 'Το μήνυμά σου στάλθηκε. Ευχαριστούμε!'; if (!error) f.reset();
  };
}
// ---- Admin
const MARKETS = ['1', '2', '1X', 'X2', 'O2.5', 'U2.5', 'O1.5', 'U3.5', 'GG', 'NG', 'HT0.5', 'HF11', 'HF22', 'CO9.5', 'CU9.5', 'CO10.5', 'CU10.5', 'B1', 'B2'];
const LABEL = (id, h, a) => ({ 1: `Νίκη ${h} (1)`, 2: `Νίκη ${a} (2)`, '1X': 'Διπλή Ευκαιρία 1Χ', X2: 'Διπλή Ευκαιρία Χ2', 'O2.5': 'Over 2.5 γκολ', 'U2.5': 'Under 2.5 γκολ', 'O1.5': 'Over 1.5 γκολ', 'U3.5': 'Under 3.5 γκολ', GG: 'Goal/Goal (GG)', NG: 'No Goal (NG)', 'HT0.5': 'Over 0.5 γκολ στο 1ο ημίχρονο', HF11: 'Ημίχρονο/Τελικό 1/1', HF22: 'Ημίχρονο/Τελικό 2/2', B1: `Νίκη ${h} (1)`, B2: `Νίκη ${a} (2)` })[id] || id;
async function admin() {
  const el = $('#app'), c = await sb(); if (!c) { msg(el, 'Το Supabase δεν έχει ρυθμιστεί.'); return; }
  const s = await status(); if (!s?.session) { el.innerHTML = `<p><a href="${loginUrl()}">Σύνδεση</a> ως διαχειριστής.</p>`; return; }
  if (!s.is_admin) { msg(el, 'Δεν έχεις δικαιώματα διαχειριστή.', 'err'); return; }
  el.innerHTML = `<div class="tabs">${[['ov', 'Επισκόπηση'], ['pk', 'Προγνωστικά'], ['us', 'Χρήστες'], ['pay', 'Πληρωμές'], ['ms', 'Μηνύματα'], ['api', 'API']].map(([k, t]) => `<button data-t="${k}">${t}</button>`).join('')}</div><div id="tab"></div>`;
  const tab = $('#tab'), T = {};
  const cnt = async (q) => (await q).count ?? 0, now = new Date().toISOString();
  T.ov = async () => {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [u, a, m, p, pay] = await Promise.all([cnt(c.from('profiles').select('id', { count: 'exact', head: true })), cnt(c.from('subscriptions').select('id', { count: 'exact', head: true }).in('status', ['active', 'trialing']).gt('current_period_end', now)),
      cnt(c.from('contact_messages').select('id', { count: 'exact', head: true }).eq('handled', false)), cnt(c.from('picks').select('id', { count: 'exact', head: true }).is('result', null)), c.from('payments').select('amount_cents,currency,status').gte('created_at', since)]);
    const sum = (pay.data || []).filter(x => x.status === 'paid').reduce((t, x) => t + (x.amount_cents || 0), 0) / 100;
    tab.innerHTML = `<div class="kpis"><div><b>${u}</b><span>Εγγεγραμμένοι χρήστες</span></div><div><b>${a}</b><span>Ενεργοί Premium συνδρομητές</span></div><div><b>${sum.toFixed(2)}</b><span>Πληρωμές 30 ημερών (${esc((pay.data || [])[0]?.currency || 'eur').toUpperCase()})</span></div><div><b>${m}</b><span>Μη διαβασμένα μηνύματα</span></div><div><b>${p}</b><span>Προγνωστικά σε αναμονή</span></div></div><p class="note">Στατιστικά επισκεψιμότητας: το GitHub Pages δεν τα παρέχει. Μπορείς να προσθέσεις υπηρεσία ανάλυσης που σέβεται το απόρρητο (π.χ. Plausible ή Cloudflare Web Analytics) και να ενημερώσεις την πολιτική cookies.</p>`;
  };
  T.pk = async () => {
    const [{ data: rows }, ev] = await Promise.all([c.from('picks').select('*').order('kickoff_at', { ascending: false }).limit(150), fetch(`${base}/events.json`).then(r => r.json()).catch(() => [])]);
    tab.innerHTML = `<form class="panel afrm" id="pf"><h2 class="w2">Νέο / επεξεργασία προγνωστικού</h2><input type="hidden" name="id">
<label class="w2">Αγώνας (από το πρόγραμμα)<select name="ev"><option value="">— Χειροκίνητη καταχώρηση —</option>${ev.map((e, i) => `<option value="${i}">${esc(e.home)} - ${esc(e.away)} (${esc(e.league)}, ${fmt(e.kickoff)})</option>`).join('')}</select></label>
<label>Άθλημα<select name="sport"><option value="football">Ποδόσφαιρο</option><option value="basketball">Μπάσκετ</option></select></label><label>Διοργάνωση<input name="league"></label><label>Γηπεδούχος<input name="home" required></label><label>Φιλοξενούμενος<input name="away" required></label><label>Έναρξη αγώνα<input name="kickoff" type="datetime-local" required></label><label>Δημοσίευση (κενό = τώρα)<input name="publish" type="datetime-local"></label>
<label>Κωδικός αγοράς<input name="pick_id" list="mk" required><datalist id="mk">${MARKETS.map(m => `<option>${m}</option>`).join('')}</datalist></label><label>Περιγραφή επιλογής<input name="label" required></label><label>Αγορά<input name="market"></label><label>Απόδοση<input name="odds" type="number" step="0.01" min="1"></label><label>Πιθανότητα %<input name="pct" type="number" min="1" max="95"></label>
<label>Εμπιστοσύνη<select name="confidence"><option>Χαμηλό</option><option selected>Μέτριο</option><option>Υψηλό</option></select></label><label>Κατηγορία<select name="tier"><option value="premium">Premium</option><option value="free">Δωρεάν</option></select></label>
<label class="w2">Αιτιολόγηση (μία γραμμή = ένα σημείο)<textarea name="reasoning" rows="3"></textarea></label><label class="w2">Ανάλυση<textarea name="analysis" rows="4"></textarea></label><div class="w2"><button class="btn">Αποθήκευση</button> <span id="pmsg2"></span></div><p class="note w2">Μετά την έναρξη του αγώνα η βάση δεν επιτρέπει αλλαγή της επιλογής (μόνο του αποτελέσματος), ώστε το ιστορικό να μένει αξιόπιστο.</p></form>
<div class="scroll panel"><table><thead><tr><th>Έναρξη</th><th>Αγώνας</th><th>Επιλογή</th><th>Κατηγορία</th><th>Αποτέλεσμα</th><th></th></tr></thead><tbody>${(rows || []).map(r => `<tr><td>${fmt(r.kickoff_at)}</td><td>${esc(r.home)} - ${esc(r.away)}<br><small class="note">${r.sport} · ${r.source}${Date.parse(r.publish_at) > Date.now() ? ' · προγραμματισμένο ' + fmt(r.publish_at) : ''}</small></td><td>${esc(r.label)} (${r.pct ?? '—'}%${r.odds ? ', ' + r.odds : ''})</td><td>${r.tier === 'premium' ? 'Premium' : 'Δωρεάν'}</td>
<td><select data-r="${r.id}"><option value="">Αναμονή</option>${['win', 'loss', 'void'].map(x => `<option value="${x}" ${r.result === x ? 'selected' : ''}>${{ win: 'Επιτυχία', loss: 'Αποτυχία', void: 'Επιστροφή' }[x]}</option>`).join('')}</select> <input data-sc="${r.id}" size="6" placeholder="σκορ" value="${esc(r.score || '')}"> <button class="btn sm" data-save="${r.id}">OK</button></td><td><button class="btn sm" data-edit="${r.id}">Επεξεργασία</button> <button class="btn sm" data-del="${r.id}">Διαγραφή</button></td></tr>`).join('')}</tbody></table></div>`;
    const f = $('#pf'), pm = $('#pmsg2'), loc = iso => iso ? new Date(new Date(iso) - new Date(iso).getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
    f.ev.onchange = () => { const e = ev[f.ev.value]; if (!e) return; f.sport.value = e.sport; f.league.value = e.league; f.home.value = e.home; f.away.value = e.away; f.kickoff.value = loc(e.kickoff); f.dataset.key = e.key; };
    f.pick_id.onchange = () => { if (!f.label.value) f.label.value = LABEL(f.pick_id.value, f.home.value, f.away.value); };
    f.onsubmit = async e => {
      e.preventDefault(); const v = Object.fromEntries(new FormData(f)), row = { sport: v.sport, event_key: f.dataset.key || `m:${crypto.randomUUID()}`, tier: v.tier, source: 'manual', league: v.league || null, home: v.home, away: v.away, kickoff_at: new Date(v.kickoff).toISOString(),
        publish_at: v.publish ? new Date(v.publish).toISOString() : new Date().toISOString(), market: v.market || null, pick_id: v.pick_id, label: v.label, odds: v.odds ? Number(v.odds) : null, pct: v.pct ? Number(v.pct) : null, confidence: v.confidence, reasoning: v.reasoning.split('\n').map(x => x.trim()).filter(Boolean), analysis: v.analysis || null };
      const { error } = v.id ? await c.from('picks').update(row).eq('id', v.id) : await c.from('picks').insert(row);
      if (error) return msg(pm, error.message, 'err'); delete f.dataset.key; T.pk();
    };
    tab.onclick = async e => {
      const t = e.target; if (t.dataset.save) { const r = $(`[data-r="${t.dataset.save}"]`).value, sc = $(`[data-sc="${t.dataset.save}"]`).value.trim(); const { error } = await c.from('picks').update({ result: r || null, score: sc || null, settled_at: r ? new Date().toISOString() : null }).eq('id', t.dataset.save); if (error) alert(error.message); }
      if (t.dataset.del && confirm('Διαγραφή προγνωστικού;')) { const { error } = await c.from('picks').delete().eq('id', t.dataset.del); if (error) alert(error.message); else T.pk(); }
      if (t.dataset.edit) { const r = rows.find(x => String(x.id) === t.dataset.edit); for (const k of ['sport', 'league', 'home', 'away', 'pick_id', 'label', 'market', 'odds', 'pct', 'confidence', 'tier', 'analysis']) f[k].value = r[k] ?? ''; f.id.value = r.id; f.kickoff.value = loc(r.kickoff_at); f.publish.value = loc(r.publish_at); f.reasoning.value = (r.reasoning || []).join('\n'); f.dataset.key = r.event_key; scrollTo(0, 0); }
    };
  };
  T.us = async () => {
    const [{ data: us }, { data: subs }] = await Promise.all([c.from('profiles').select('id,email,is_admin,created_at').order('created_at', { ascending: false }).limit(300), c.from('subscriptions').select('*')]);
    const by = {}; for (const x of subs || []) (by[x.user_id] ||= []).push(x);
    tab.innerHTML = `<div class="scroll panel"><table><thead><tr><th>Email</th><th>Εγγραφή</th><th>Συνδρομή</th><th>Ενέργειες</th></tr></thead><tbody>${(us || []).map(u => { const l = (by[u.id] || []).sort((a, b) => (b.current_period_end || '').localeCompare(a.current_period_end || ''))[0]; const live = l && ['active', 'trialing'].includes(l.status) && Date.parse(l.current_period_end) > Date.now();
      return `<tr><td>${esc(u.email)}${u.is_admin ? ' <span class="badge">admin</span>' : ''}</td><td>${fmt(u.created_at)}</td><td>${l ? `${live ? 'Ενεργή' : 'Ανενεργή'} (${esc(l.status)}${l.id.startsWith('manual_') ? ', δώρο' : ''}) έως ${fmt(l.current_period_end)}` : '—'}</td><td><button class="btn sm" data-grant="${u.id}">Δώρισε πρόσβαση</button>${l?.id.startsWith('manual_') && live ? ` <button class="btn sm" data-revoke="${l.id}">Ανάκληση</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
    tab.onclick = async e => { const t = e.target;
      if (t.dataset.grant) { const d = Number(prompt('Πόσες ημέρες πρόσβασης;', '30')); if (!(d > 0)) return; const { error } = await c.from('subscriptions').insert({ id: `manual_${t.dataset.grant}_${Date.now()}`, user_id: t.dataset.grant, status: 'active', plan: 'manual', current_period_end: new Date(Date.now() + d * 864e5).toISOString() }); if (error) alert(error.message); else T.us(); }
      if (t.dataset.revoke) { const { error } = await c.from('subscriptions').update({ status: 'canceled', current_period_end: now }).eq('id', t.dataset.revoke); if (error) alert(error.message); else T.us(); } };
  };
  T.pay = async () => {
    const [{ data: pay }, { data: subs }] = await Promise.all([c.from('payments').select('*').order('created_at', { ascending: false }).limit(100), c.from('subscriptions').select('*').order('updated_at', { ascending: false }).limit(100)]);
    tab.innerHTML = `<h2>Πληρωμές</h2><div class="scroll panel"><table><tbody>${(pay || []).map(p => `<tr><td>${fmt(p.created_at)}</td><td>${((p.amount_cents || 0) / 100).toFixed(2)} ${esc((p.currency || '').toUpperCase())}</td><td class="${p.status === 'paid' ? 'win' : 'loss'}">${esc(p.status)}</td><td><small>${esc(p.id)}</small></td></tr>`).join('') || '<tr><td>Καμία πληρωμή ακόμη.</td></tr>'}</tbody></table></div><h2>Συνδρομές</h2><div class="scroll panel"><table><tbody>${(subs || []).map(x => `<tr><td>${esc(x.status)}</td><td>${esc(x.plan || '')}</td><td>έως ${fmt(x.current_period_end)}</td><td>${x.cancel_at_period_end ? 'ακυρώνεται στη λήξη' : ''}</td><td><small>${esc(x.id)}</small></td></tr>`).join('')}</tbody></table></div>`;
  };
  T.ms = async () => {
    const { data } = await c.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(100);
    tab.innerHTML = (data || []).map(m => `<div class="pcard"><small>${fmt(m.created_at)} · ${esc(m.name || '')} · <a href="mailto:${esc(m.email)}">${esc(m.email)}</a> ${m.handled ? '· διαβάστηκε' : ''}</small><p>${esc(m.message)}</p><button class="btn sm" data-h="${m.id}">${m.handled ? 'Ως μη διαβασμένο' : 'Σήμανση ως διαβασμένο'}</button></div>`).join('') || '<p class="note">Κανένα μήνυμα.</p>';
    tab.onclick = async e => { const id = e.target.dataset.h; if (!id) return; const m = data.find(x => String(x.id) === id); await c.from('contact_messages').update({ handled: !m.handled }).eq('id', id); T.ms(); };
  };
  T.api = async () => {
    const { data } = await c.from('api_usage').select('*').order('day', { ascending: false }).limit(14);
    tab.innerHTML = `<div class="panel"><p>Η χρήση των API καταγράφεται σε κάθε ανανέωση δεδομένων (κάθε ~15 λεπτά).</p><div class="scroll"><table><thead><tr><th>Ημέρα (UTC)</th><th>API</th><th>Χρήση</th><th>Όριο</th><th>Απομένουν</th><th>Τελευταίο σφάλμα</th></tr></thead><tbody>${(data || []).map(u => `<tr><td>${u.day}</td><td>${esc(u.api)}</td><td>${u.used ?? '—'}</td><td>${u.daily_limit ?? '—'}</td><td>${u.remaining ?? '—'}</td><td><small>${esc(u.error || '')}</small></td></tr>`).join('') || '<tr><td>Δεν υπάρχουν ακόμη δεδομένα.</td></tr>'}</tbody></table></div>
<p><button class="btn" id="rf">Ζήτησε ανανέωση δεδομένων</button> <span id="rm"></span></p><p class="note">Η ανανέωση εκτελείται στον επόμενο κύκλο (έως ~15 λεπτά), και πάντα εντός του ημερήσιου ορίου του API. Για άμεση εκτέλεση: GitHub → Actions → Run workflow.</p></div>`;
    $('#rf').onclick = async () => { const { error } = await c.from('refresh_requests').insert({ requested_by: s.id }); msg($('#rm'), error ? error.message : 'Το αίτημα καταγράφηκε.', error ? 'err' : 'ok'); };
  };
  const open = k => { document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === k)); tab.onclick = null; tab.innerHTML = 'Φόρτωση...'; T[k]().catch(e => msg(tab, e.message, 'err')); };
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => open(b.dataset.t)); open('ov');
}
({ premium, login, account, contact, admin })[page]?.();
unlock();

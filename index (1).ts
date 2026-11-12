// Stripe Webhook. ΑΠΑΡΑΙΤΗΤΟ: στις ρυθμίσεις της συνάρτησης απενεργοποίησε το «Verify JWT» (το Stripe δεν στέλνει JWT). Η ασφάλεια βασίζεται στην επαλήθευση υπογραφής.
// Σχεδιασμός ανθεκτικός σε καθυστερήσεις και σειρά γεγονότων: για κάθε γεγονός ξαναδιαβάζουμε την τρέχουσα κατάσταση της συνδρομής από το Stripe.
const SB = Deno.env.get('SUPABASE_URL')!, SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, STRIPE = Deno.env.get('STRIPE_SECRET_KEY')!, SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;
const enc = new TextEncoder();
async function verify(payload: string, header: string): Promise<boolean> {
  const parts = header.split(',').map((p) => p.split('='));
  const t = parts.find((p) => p[0] === 't')?.[1], sigs = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hex = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((s) => s.length === hex.length && [...s].reduce((a, c, i) => a | (c.charCodeAt(0) ^ hex.charCodeAt(i)), 0) === 0);
}
const sget = async (path: string) => { const r = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${STRIPE}` } }); if (!r.ok) throw new Error(`Stripe ${r.status}`); return r.json(); };
const rest = (method: string, q: string, body?: unknown, prefer?: string) => fetch(`${SB}/rest/v1/${q}`, { method, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
async function userFor(customer: string, meta?: { user_id?: string }): Promise<string | null> {
  if (meta?.user_id) return meta.user_id;
  const r = await (await rest('GET', `profiles?stripe_customer_id=eq.${customer}&select=id`)).json(); return r[0]?.id ?? null;
}
async function syncSubscription(id: string) {
  const s = await sget(`subscriptions/${id}`);
  const uid = await userFor(s.customer, s.metadata); if (!uid) throw new Error(`Άγνωστος χρήστης για τον πελάτη ${s.customer}`);
  const item = s.items?.data?.[0], end = s.current_period_end ?? item?.current_period_end;  // το πεδίο μετακινήθηκε στις νεότερες εκδόσεις API
  const res = await rest('POST', 'subscriptions?on_conflict=id', [{ id: s.id, user_id: uid, status: s.status, price_id: item?.price?.id ?? null, plan: item?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly',
    current_period_end: end ? new Date(end * 1000).toISOString() : null, cancel_at_period_end: !!s.cancel_at_period_end, updated_at: new Date().toISOString() }], 'resolution=merge-duplicates,return=minimal');
  if (!res.ok) throw new Error(`DB ${res.status} ${await res.text()}`);
}
async function recordInvoice(inv: any, status: string) {
  const uid = await userFor(inv.customer);
  await rest('POST', 'payments?on_conflict=id', [{ id: inv.id, user_id: uid, subscription_id: inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null, amount_cents: status === 'paid' ? inv.amount_paid : inv.amount_due, currency: inv.currency, status, created_at: new Date((inv.created || Date.now() / 1000) * 1000).toISOString() }], 'resolution=merge-duplicates,return=minimal');
}
Deno.serve(async (req) => {
  const payload = await req.text();
  if (!(await verify(payload, req.headers.get('stripe-signature') || ''))) return new Response('Invalid signature', { status: 400 });
  const ev = JSON.parse(payload), o = ev.data.object;
  try {
    switch (ev.type) {
      case 'checkout.session.completed': if (o.subscription) await syncSubscription(o.subscription); break;
      case 'customer.subscription.created': case 'customer.subscription.updated': case 'customer.subscription.deleted': await syncSubscription(o.id); break;
      case 'invoice.paid': case 'invoice.payment_failed': {
        const sub = o.subscription ?? o.parent?.subscription_details?.subscription; if (sub) await syncSubscription(sub);
        await recordInvoice(o, ev.type === 'invoice.paid' ? 'paid' : 'failed'); break;
      }
    }
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (e) { console.error(ev.type, e); return new Response('Error', { status: 500 }); }  // 500 => το Stripe ξαναδοκιμάζει
});

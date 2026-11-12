// Δημιουργεί Stripe Checkout Session για τον συνδεδεμένο χρήστη. Τα μυστικά (STRIPE_SECRET_KEY κ.λπ.) υπάρχουν ΜΟΝΟ ως Secrets της συνάρτησης.
const SB = Deno.env.get('SUPABASE_URL')!, SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const STRIPE = Deno.env.get('STRIPE_SECRET_KEY')!, SITE = (Deno.env.get('SITE_URL') || '').replace(/\/$/, '');
const cors = { 'Access-Control-Allow-Origin': new URL(SITE).origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const sbGet = async (q: string) => (await fetch(`${SB}/rest/v1/${q}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } })).json();
async function stripe(path: string, params: Record<string, string>) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${STRIPE}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || 'Stripe error'); return j;
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const ur = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
    if (!ur.ok) return json({ error: 'Απαιτείται σύνδεση' }, 401);
    const user = await ur.json();
    const { plan } = await req.json();
    const price = plan === 'yearly' ? Deno.env.get('STRIPE_PRICE_YEARLY') : plan === 'monthly' ? Deno.env.get('STRIPE_PRICE_MONTHLY') : null;
    if (!price) return json({ error: 'Άγνωστο πλάνο' }, 400);
    const active = await sbGet(`subscriptions?user_id=eq.${user.id}&status=in.(active,trialing)&current_period_end=gt.${new Date().toISOString()}&select=id`);
    if (active.length) return json({ error: 'Έχεις ήδη ενεργή συνδρομή. Διαχειρίσου την από τη σελίδα λογαριασμού.' }, 409);
    const prof = (await sbGet(`profiles?id=eq.${user.id}&select=stripe_customer_id`))[0];
    let customer = prof?.stripe_customer_id;
    if (!customer) {
      customer = (await stripe('customers', { email: user.email, 'metadata[user_id]': user.id })).id;
      await fetch(`${SB}/rest/v1/profiles?id=eq.${user.id}`, { method: 'PATCH', headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ stripe_customer_id: customer }) });
    }
    const p: Record<string, string> = { mode: 'subscription', customer, 'line_items[0][price]': price, 'line_items[0][quantity]': '1', client_reference_id: user.id, 'subscription_data[metadata][user_id]': user.id,
      success_url: `${SITE}/account/?checkout=success`, cancel_url: `${SITE}/premium/?checkout=cancel`, allow_promotion_codes: 'true',
      'custom_text[submit][message]': `Με την πληρωμή αποδέχεσαι τους [Όρους χρήσης](${SITE}/terms/) και τους [Όρους συνδρομών](${SITE}/subscription-terms/) και ζητάς την άμεση ενεργοποίηση της υπηρεσίας.` };
    if (Deno.env.get('STRIPE_AUTOMATIC_TAX') === 'true') { p['automatic_tax[enabled]'] = 'true'; p['customer_update[address]'] = 'auto'; }
    return json({ url: (await stripe('checkout/sessions', p)).url });
  } catch (e) { console.error(e); return json({ error: 'Δεν ήταν δυνατή η δημιουργία πληρωμής' }, 500); }
});

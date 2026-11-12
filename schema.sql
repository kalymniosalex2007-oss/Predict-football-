-- GoalPredict: σχήμα βάσης, κανόνες πρόσβασης (RLS) και συναρτήσεις. Εκτέλεσέ το ΟΛΟ στο Supabase → SQL Editor → Run.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);
create table if not exists public.subscriptions (
  id text primary key,                         -- Stripe subscription id, ή 'manual_...' για δωρεάν πρόσβαση από τον admin
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null,
  price_id text, plan text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_idx on public.subscriptions(user_id);
create table if not exists public.payments (
  id text primary key,                         -- Stripe invoice id
  user_id uuid references public.profiles(id) on delete set null,
  subscription_id text, amount_cents integer, currency text, status text,
  created_at timestamptz not null default now()
);
create table if not exists public.picks (
  id bigint generated always as identity primary key,
  sport text not null check (sport in ('football','basketball')),
  event_key text not null,                     -- f:<fixture id>, b:<game id>, m:<uuid> για χειροκίνητα
  tier text not null default 'free' check (tier in ('free','premium')),
  source text not null default 'auto' check (source in ('auto','manual')),
  league text, home text not null, away text not null,
  kickoff_at timestamptz not null,
  publish_at timestamptz not null default now(),
  market text, pick_id text not null, label text not null,
  odds numeric, pct integer, confidence text,
  reasoning text[] not null default '{}', analysis text,
  result text check (result in ('win','loss','void')),
  score text, settled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_key, source, pick_id)
);
create index if not exists picks_kickoff_idx on public.picks(kickoff_at desc);
create table if not exists public.contact_messages (
  id bigint generated always as identity primary key,
  name text, email text not null, message text not null,
  handled boolean not null default false, created_at timestamptz not null default now(),
  constraint contact_len check (char_length(message) between 10 and 4000 and char_length(email) < 200 and char_length(coalesce(name,'')) < 120)
);
create table if not exists public.api_usage (
  day date not null, api text not null, daily_limit integer, remaining integer, used integer, error text,
  updated_at timestamptz not null default now(), primary key (day, api)
);
create table if not exists public.cache (key text primary key, payload jsonb not null, fetched_at timestamptz not null default now());
create table if not exists public.refresh_requests (
  id bigint generated always as identity primary key, requested_by uuid, requested_at timestamptz not null default now(), handled_at timestamptz
);

-- Βοηθητικές συναρτήσεις (χωρίς παράμετρο: δεν επιτρέπουν έλεγχο άλλων χρηστών)
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
create or replace function public.is_premium() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.subscriptions s where s.user_id = auth.uid() and s.status in ('active','trialing') and s.current_period_end > now());
$$;
create or replace function public.me_status() returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', auth.uid(), 'email', (select email from public.profiles where id = auth.uid()), 'is_admin', public.is_admin(), 'is_premium', public.is_premium(),
    'subscription', (select row_to_json(s) from public.subscriptions s where s.user_id = auth.uid() order by s.current_period_end desc nulls last limit 1));
$$;
-- Νέος χρήστης => προφίλ
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing; return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Αμετάβλητο ιστορικό: μετά την έναρξη του αγώνα επιτρέπεται να αλλάξει ΜΟΝΟ το αποτέλεσμα (result, score, settled_at). Ισχύει και για το service key.
create or replace function public.picks_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.kickoff_at <= now() then raise exception 'Το προγνωστικό δεν μπορεί να διαγραφεί μετά την έναρξη του αγώνα'; end if;
    return old;
  end if;
  if old.kickoff_at <= now() and (new.sport, new.event_key, new.tier, new.source, new.league, new.home, new.away, new.kickoff_at, new.publish_at, new.market, new.pick_id, new.label, new.odds, new.pct, new.confidence, new.reasoning, new.analysis)
     is distinct from (old.sport, old.event_key, old.tier, old.source, old.league, old.home, old.away, old.kickoff_at, old.publish_at, old.market, old.pick_id, old.label, old.odds, old.pct, old.confidence, old.reasoning, old.analysis) then
    raise exception 'Το προγνωστικό δεν μπορεί να αλλάξει μετά την έναρξη του αγώνα';
  end if;
  return new;
end; $$;
drop trigger if exists picks_guard_upd on public.picks;
create trigger picks_guard_upd before update on public.picks for each row execute function public.picks_guard();
drop trigger if exists picks_guard_del on public.picks;
create trigger picks_guard_del before delete on public.picks for each row execute function public.picks_guard();

-- RLS: ενεργοποίηση παντού
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.picks enable row level security;
alter table public.contact_messages enable row level security;
alter table public.api_usage enable row level security;
alter table public.cache enable row level security;
alter table public.refresh_requests enable row level security;

drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select using (auth.uid() = id or public.is_admin());
drop policy if exists subs_read on public.subscriptions;
create policy subs_read on public.subscriptions for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists subs_admin_write on public.subscriptions;
create policy subs_admin_write on public.subscriptions for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select using (user_id = auth.uid() or public.is_admin());

-- ΚΥΡΙΟΣ ΚΑΝΟΝΑΣ PREMIUM: ένα Premium προγνωστικό διαβάζεται μόνο από ενεργό συνδρομητή ή admin, μέχρι την έναρξη του αγώνα. Μετά γίνεται δημόσιο.
drop policy if exists picks_read on public.picks;
create policy picks_read on public.picks for select using (
  public.is_admin() or (publish_at <= now() and (tier = 'free' or kickoff_at <= now() or public.is_premium()))
);
drop policy if exists picks_admin_write on public.picks;
create policy picks_admin_write on public.picks for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists contact_insert on public.contact_messages;
create policy contact_insert on public.contact_messages for insert to anon, authenticated with check (true);
drop policy if exists contact_admin on public.contact_messages;
create policy contact_admin on public.contact_messages for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists usage_admin on public.api_usage;
create policy usage_admin on public.api_usage for select using (public.is_admin());
drop policy if exists refresh_admin on public.refresh_requests;
create policy refresh_admin on public.refresh_requests for all using (public.is_admin()) with check (public.is_admin());
-- cache: χωρίς πολιτικές => προσβάσιμο μόνο από το service key του GitHub Actions

-- Αφαίρεση δικαιωμάτων που δεν χρειάζονται στους ανώνυμους χρήστες
revoke all on public.cache, public.payments, public.api_usage, public.refresh_requests, public.profiles, public.subscriptions from anon;
revoke insert, update, delete on public.picks from anon, authenticated;
grant insert, update, delete on public.picks to authenticated;  -- το RLS επιτρέπει εγγραφή μόνο σε admin

-- ΜΕΤΑ την πρώτη σου εγγραφή στο site, κάνε τον εαυτό σου admin (άλλαξε το email):
-- update public.profiles set is_admin = true where email = 'το-email-σου@example.com';

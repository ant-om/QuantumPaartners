-- newsletter_subscribers — email capture for "Get free Stock Bar newsletter".
-- Run this in the Supabase SQL editor.
--
-- Security model: anon may INSERT (with a sane email check) and may NOT
-- SELECT/UPDATE/DELETE — subscribers are write-only from the browser.
-- The n8n Brevo send later reads this table with the service_role key to
-- build the recipient list (replacing the hardcoded recipients).

create table if not exists public.newsletter_subscribers (
  id bigint generated always as identity primary key,
  email text not null,
  source text default 'site',
  created_at timestamptz not null default now()
);

-- one row per address, case-insensitive
create unique index if not exists newsletter_subscribers_email_key
  on public.newsletter_subscribers (lower(email));

alter table public.newsletter_subscribers enable row level security;

drop policy if exists "anon can subscribe" on public.newsletter_subscribers;
create policy "anon can subscribe" on public.newsletter_subscribers
  for insert to anon
  with check (
    email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    and length(email) <= 254
  );
-- no SELECT policy on purpose: inserts must not use .select(), and the
-- duplicate case surfaces as Postgres error 23505 (mapped to a friendly
-- "already subscribed" in the frontend).

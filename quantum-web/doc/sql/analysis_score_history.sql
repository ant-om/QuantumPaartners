-- analysis_score_history — score evolution over runs, for the stock-page timeline.
-- Exposes ONLY stock_id + run timestamp + numeric scores (no analysis text).
-- Run this in the Supabase SQL editor. The frontend hides the timeline until
-- this view exists and a stock has >= 2 runs.
--
-- Per-factor score rule (mirrors the frontend "direct value" rule — no averaging):
--   1. the score of the first block whose heading looks like a conclusion/overall block
--   2. else, the block's score when the factor has exactly one block
--   3. else NULL

create or replace function public._factor_display_score(blocks jsonb)
returns numeric
language sql
immutable
as $$
  select coalesce(
    (
      select (b->>'score')::numeric
      from jsonb_array_elements(coalesce(blocks, '[]'::jsonb)) b
      where lower(coalesce(b->>'heading', '')) ~ '(conclusion|overall|synthesis|verdict)'
        and b->>'score' is not null
      limit 1
    ),
    case
      when jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) = 1
      then (blocks->0->>'score')::numeric
    end
  );
$$;

create or replace view public.analysis_score_history as
select
  t.stock_id,
  t.run_at,
  (t.summary->>'score')::numeric        as summary_score,
  public._factor_display_score(t.political)  as political,
  public._factor_display_score(t.price)      as price,
  public._factor_display_score(t.macro)      as macro,
  public._factor_display_score(t.management) as management,
  public._factor_display_score(t.sentiment)  as sentiment,
  public._factor_display_score(t.competitor) as competitor,
  public._factor_display_score(t.financial)  as financial
from (
  select stock_id, run_at, summary, political, price, macro, management, sentiment, competitor, financial
  from public.stock_analyses
  union all
  select stock_id, run_at, summary, political, price, macro, management, sentiment, competitor, financial
  from public.stock_analyses_history
) t;

grant select on public.analysis_score_history to anon;

-- If stock_analyses_history has RLS enabled without an anon-read policy, the
-- view (security invoker by default on PG15+) returns zero history rows for
-- anon. Scores are already public via stock_analyses, so allow read-only:
-- alter table public.stock_analyses_history enable row level security;
-- create policy "anon can read history scores" on public.stock_analyses_history
--   for select to anon using (true);

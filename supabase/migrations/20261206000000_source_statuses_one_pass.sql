-- worker_source_statuses in one pass over a worker's runs. The old view counted each source's failures and
-- found its first run with a subquery per source over every finished run, which grew with the square of the
-- run history and passed the statement timeout (discover: ~300 boards a run, several runs a day). Same
-- columns, same meaning; a filter on worker (or source) reaches the runs table and its index.
create or replace view worker_source_statuses with (security_invoker = true) as
with ranked as (
  select worker, source, started_at, ok, error, counts,
    row_number() over (partition by worker, source order by started_at desc) as rn
  from worker_runs
  where ok is not null and source is not null
)
select
  worker,
  source,
  max(started_at) filter (where rn = 1) as last_run_at,
  bool_or(ok) filter (where rn = 1) as last_ok,
  max(error) filter (where rn = 1) as last_error,
  (array_agg(counts) filter (where rn = 1))[1] as last_counts,
  max(started_at) filter (where ok) as last_success_at,
  -- The runs since the last success: those ranked above it, or every run when none succeeded.
  coalesce(min(rn) filter (where ok) - 1, count(*))::int as consecutive_failures,
  min(started_at) as first_run_at
from ranked
group by worker, source;

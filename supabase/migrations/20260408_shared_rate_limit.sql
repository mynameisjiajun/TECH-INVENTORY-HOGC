begin;

create table if not exists public.rate_limits (
  key text primary key,
  count integer not null default 0,
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_limits_count_nonnegative_check check (count >= 0)
);

create index if not exists rate_limits_updated_at_idx
  on public.rate_limits (updated_at asc);

drop trigger if exists set_rate_limits_updated_at on public.rate_limits;
create trigger set_rate_limits_updated_at
before update on public.rate_limits
for each row
execute function public.set_updated_at();

create or replace function public.check_rate_limit(
  rate_key text,
  max_attempts integer default 10,
  window_seconds integer default 900
)
returns table(limited boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
as $$
declare
  now_ts timestamptz := now();
  entry_count integer;
  window_started timestamptz;
begin
  insert into public.rate_limits (key, count, window_started_at, updated_at)
  values (rate_key, 1, now_ts, now_ts)
  on conflict (key) do update
    set count = case
      when public.rate_limits.window_started_at <= now_ts - make_interval(secs => window_seconds)
        then 1
      else public.rate_limits.count + 1
    end,
    window_started_at = case
      when public.rate_limits.window_started_at <= now_ts - make_interval(secs => window_seconds)
        then now_ts
      else public.rate_limits.window_started_at
    end,
    updated_at = now_ts
  returning count, window_started_at into entry_count, window_started;

  if entry_count > max_attempts then
    limited := true;
    remaining := 0;
    retry_after_seconds := greatest(
      0,
      ceil(extract(epoch from ((window_started + make_interval(secs => window_seconds)) - now_ts)))::integer
    );
  else
    limited := false;
    remaining := greatest(0, max_attempts - entry_count);
    retry_after_seconds := 0;
  end if;

  return next;
end;
$$;

create or replace function public.reset_rate_limit(rate_key text)
returns void
language plpgsql
security definer
as $$
begin
  delete from public.rate_limits where key = rate_key;
end;
$$;

commit;
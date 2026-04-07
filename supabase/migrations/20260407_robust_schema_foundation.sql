begin;

-- Fail early if existing data would break stronger constraints.
do $$
begin
  if exists (
    select 1
    from public.loan_requests
    where start_date is null
      or btrim(start_date) = ''
      or btrim(start_date) !~ '^\d{4}-\d{2}-\d{2}$'
  ) then
    raise exception 'Migration aborted: invalid loan_requests.start_date values detected.';
  end if;

  if exists (
    select 1
    from public.loan_requests
    where end_date is not null
      and btrim(end_date) <> ''
      and btrim(end_date) !~ '^\d{4}-\d{2}-\d{2}$'
  ) then
    raise exception 'Migration aborted: invalid loan_requests.end_date values detected.';
  end if;

  if exists (
    select 1
    from public.laptop_loan_requests
    where start_date is null
      or btrim(start_date) = ''
      or btrim(start_date) !~ '^\d{4}-\d{2}-\d{2}$'
  ) then
    raise exception 'Migration aborted: invalid laptop_loan_requests.start_date values detected.';
  end if;

  if exists (
    select 1
    from public.laptop_loan_requests
    where end_date is not null
      and btrim(end_date) <> ''
      and btrim(end_date) !~ '^\d{4}-\d{2}-\d{2}$'
  ) then
    raise exception 'Migration aborted: invalid laptop_loan_requests.end_date values detected.';
  end if;

  if exists (
    select 1
    from public.loan_requests
    where loan_type = 'temporary'
      and (end_date is null or btrim(end_date) = '')
  ) then
    raise exception 'Migration aborted: temporary loan_requests rows must have end_date.';
  end if;

  if exists (
    select 1
    from public.laptop_loan_requests
    where loan_type = 'temporary'
      and (end_date is null or btrim(end_date) = '')
  ) then
    raise exception 'Migration aborted: temporary laptop_loan_requests rows must have end_date.';
  end if;

  if exists (
    select 1
    from public.users
    where telegram_chat_id is not null
      and btrim(telegram_chat_id) <> ''
      and btrim(telegram_chat_id) !~ '^[0-9]+$'
  ) then
    raise exception 'Migration aborted: non-numeric users.telegram_chat_id values detected.';
  end if;

  if exists (
    select 1
    from public.users
    where telegram_chat_id is not null
    group by telegram_chat_id
    having count(*) > 1
  ) then
    raise exception 'Migration aborted: duplicate users.telegram_chat_id values detected.';
  end if;

  if exists (
    select 1
    from public.laptop_notifications
    group by user_id, laptop_id
    having count(*) > 1
  ) then
    raise exception 'Migration aborted: duplicate laptop_notifications (user_id, laptop_id) rows detected.';
  end if;
end
$$;

-- Normalize date storage to proper DATE columns.
alter table public.loan_requests
  alter column start_date type date using start_date::date,
  alter column end_date type date using nullif(btrim(end_date), '')::date,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.laptop_loan_requests
  alter column start_date type date using start_date::date,
  alter column end_date type date using nullif(btrim(end_date), '')::date;

alter table public.laptop_loan_requests
  add column if not exists updated_at timestamptz;

update public.laptop_loan_requests
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table public.laptop_loan_requests
  alter column updated_at set default now(),
  alter column updated_at set not null;

-- Stronger business constraints once dates are typed.
alter table public.loan_requests
  drop constraint if exists loan_requests_dates_valid_check;
alter table public.loan_requests
  add constraint loan_requests_dates_valid_check
  check (
    start_date is not null
    and (
      (loan_type = 'permanent' and end_date is null)
      or (loan_type = 'temporary' and end_date is not null and end_date >= start_date)
    )
  );

alter table public.laptop_loan_requests
  drop constraint if exists laptop_loan_requests_dates_valid_check;
alter table public.laptop_loan_requests
  add constraint laptop_loan_requests_dates_valid_check
  check (
    start_date is not null
    and (
      (loan_type = 'permanent' and end_date is null)
      or (loan_type = 'temporary' and end_date is not null and end_date >= start_date)
    )
  );

-- Better delete behavior.
alter table public.loan_items
  drop constraint if exists loan_items_loan_request_id_fkey;
alter table public.loan_items
  add constraint loan_items_loan_request_id_fkey
  foreign key (loan_request_id)
  references public.loan_requests(id)
  on delete cascade;

alter table public.laptop_loan_items
  drop constraint if exists laptop_loan_items_request_fkey;
alter table public.laptop_loan_items
  add constraint laptop_loan_items_request_fkey
  foreign key (loan_request_id)
  references public.laptop_loan_requests(id)
  on delete cascade;

alter table public.loan_requests
  drop constraint if exists loan_requests_user_id_fkey;
alter table public.loan_requests
  add constraint loan_requests_user_id_fkey
  foreign key (user_id)
  references public.users(id)
  on delete cascade;

alter table public.laptop_loan_requests
  drop constraint if exists laptop_loan_requests_user_id_fkey;
alter table public.laptop_loan_requests
  add constraint laptop_loan_requests_user_id_fkey
  foreign key (user_id)
  references public.users(id)
  on delete cascade;

alter table public.notifications
  drop constraint if exists notifications_user_id_fkey;
alter table public.notifications
  add constraint notifications_user_id_fkey
  foreign key (user_id)
  references public.users(id)
  on delete cascade;

alter table public.laptop_notifications
  drop constraint if exists laptop_notifications_user_fkey;
alter table public.laptop_notifications
  add constraint laptop_notifications_user_fkey
  foreign key (user_id)
  references public.users(id)
  on delete cascade;

alter table public.laptop_notifications
  drop constraint if exists laptop_notifications_laptop_fkey;
alter table public.laptop_notifications
  add constraint laptop_notifications_laptop_fkey
  foreign key (laptop_id)
  references public.laptops(id)
  on delete cascade;

alter table public.activity_feed
  drop constraint if exists activity_feed_user_id_fkey;
alter table public.activity_feed
  add constraint activity_feed_user_id_fkey
  foreign key (user_id)
  references public.users(id)
  on delete set null;

alter table public.audit_log
  drop constraint if exists audit_log_user_id_fkey;
alter table public.audit_log
  add constraint audit_log_user_id_fkey
  foreign key (user_id)
  references public.users(id)
  on delete set null;

alter table public.loan_templates
  drop constraint if exists loan_templates_created_by_fkey;
alter table public.loan_templates
  add constraint loan_templates_created_by_fkey
  foreign key (created_by)
  references public.users(id)
  on delete set null;

-- Integrity + performance.
create unique index if not exists users_telegram_chat_id_unique_idx
  on public.users (telegram_chat_id)
  where telegram_chat_id is not null;

create unique index if not exists laptop_notifications_user_laptop_unique_idx
  on public.laptop_notifications (user_id, laptop_id);

create index if not exists loan_requests_user_id_idx
  on public.loan_requests (user_id);
create index if not exists loan_requests_status_created_at_idx
  on public.loan_requests (status, created_at desc);
create index if not exists loan_requests_start_date_idx
  on public.loan_requests (start_date);

create index if not exists laptop_loan_requests_user_id_idx
  on public.laptop_loan_requests (user_id);
create index if not exists laptop_loan_requests_status_created_at_idx
  on public.laptop_loan_requests (status, created_at desc);
create index if not exists laptop_loan_requests_start_date_idx
  on public.laptop_loan_requests (start_date);

create index if not exists loan_items_loan_request_id_idx
  on public.loan_items (loan_request_id);
create index if not exists laptop_loan_items_loan_request_id_idx
  on public.laptop_loan_items (loan_request_id);

create index if not exists notifications_user_read_created_at_idx
  on public.notifications (user_id, read, created_at desc);
create index if not exists activity_feed_created_at_idx
  on public.activity_feed (created_at desc);
create index if not exists audit_log_created_at_idx
  on public.audit_log (created_at desc);
create index if not exists loan_templates_order_idx_idx
  on public.loan_templates (order_idx, created_at desc);

-- Keep updated_at correct even if the app forgets.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_loan_requests_updated_at on public.loan_requests;
create trigger set_loan_requests_updated_at
before update on public.loan_requests
for each row
execute function public.set_updated_at();

drop trigger if exists set_laptop_loan_requests_updated_at on public.laptop_loan_requests;
create trigger set_laptop_loan_requests_updated_at
before update on public.laptop_loan_requests
for each row
execute function public.set_updated_at();

commit;

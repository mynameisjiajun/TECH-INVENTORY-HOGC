begin;

alter table public.users
  add column if not exists telegram_handle text;

update public.users
set telegram_handle = lower('@' || btrim(telegram_handle, ' @'))
where telegram_handle is not null
  and btrim(telegram_handle) <> '';

create unique index if not exists users_telegram_handle_unique_idx
  on public.users (lower(telegram_handle))
  where telegram_handle is not null;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'guest_borrow_requests'
  ) then
    alter table public.guest_borrow_requests
      alter column telegram_handle drop not null;
  end if;
end
$$;

commit;
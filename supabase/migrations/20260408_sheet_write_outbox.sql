begin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.sheet_write_outbox (
  sheet_name text not null,
  cell text not null,
  value numeric not null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sheet_write_outbox_pkey primary key (sheet_name, cell),
  constraint sheet_write_outbox_value_nonnegative_check check (value >= 0)
);

create index if not exists sheet_write_outbox_updated_at_idx
  on public.sheet_write_outbox (updated_at asc);

drop trigger if exists set_sheet_write_outbox_updated_at on public.sheet_write_outbox;
create trigger set_sheet_write_outbox_updated_at
before update on public.sheet_write_outbox
for each row
execute function public.set_updated_at();

commit;
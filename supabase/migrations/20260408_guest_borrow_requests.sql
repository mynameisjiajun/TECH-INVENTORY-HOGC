begin;

create table if not exists public.guest_borrow_requests (
  id bigserial primary key,
  guest_name text not null,
  telegram_handle text not null,
  department text,
  email text,
  purpose text not null,
  loan_type text not null default 'temporary',
  start_date date not null,
  end_date date not null,
  items jsonb not null,
  status text not null default 'pending',
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guest_borrow_requests_loan_type_check check (loan_type = 'temporary'),
  constraint guest_borrow_requests_dates_check check (end_date >= start_date),
  constraint guest_borrow_requests_status_check check (status in ('pending', 'reviewed', 'approved', 'rejected')),
  constraint guest_borrow_requests_items_is_array_check check (jsonb_typeof(items) = 'array')
);

create index if not exists guest_borrow_requests_status_created_at_idx
  on public.guest_borrow_requests (status, created_at desc);

drop trigger if exists set_guest_borrow_requests_updated_at on public.guest_borrow_requests;
create trigger set_guest_borrow_requests_updated_at
before update on public.guest_borrow_requests
for each row
execute function public.set_updated_at();

commit;
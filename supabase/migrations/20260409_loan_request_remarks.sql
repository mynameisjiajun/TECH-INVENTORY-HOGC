begin;

alter table public.loan_requests
  add column if not exists remarks text;

alter table public.laptop_loan_requests
  add column if not exists remarks text;

alter table public.guest_borrow_requests
  add column if not exists remarks text;

commit;
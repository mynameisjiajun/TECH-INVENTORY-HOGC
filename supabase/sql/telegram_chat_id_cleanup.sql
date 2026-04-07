-- Preflight inspection: find duplicate or invalid telegram_chat_id values.
select
  telegram_chat_id,
  count(*) as duplicate_count,
  array_agg(id order by id) as user_ids
from public.users
where telegram_chat_id is not null
group by telegram_chat_id
having count(*) > 1
order by duplicate_count desc, telegram_chat_id;

select
  id,
  username,
  telegram_chat_id
from public.users
where telegram_chat_id is not null
  and btrim(telegram_chat_id) <> ''
  and btrim(telegram_chat_id) !~ '^[0-9]+$'
order by id;

-- Safe cleanup step 1:
-- Real Telegram chat IDs are numeric strings. Old registrations stored handles
-- here, so clear any non-numeric values before applying the uniqueness/index
-- migration. Users can relink Telegram from their Profile page afterward.
update public.users
set telegram_chat_id = null
where telegram_chat_id is not null
  and (
    btrim(telegram_chat_id) = ''
    or btrim(telegram_chat_id) !~ '^[0-9]+$'
  );

-- Safe cleanup step 2:
-- If the same numeric Telegram chat ID is attached to multiple users, keep it
-- on the oldest user row and clear it from the rest. This matches Telegram's
-- one-chat-to-one-user linking model.
with ranked_duplicates as (
  select
    id,
    telegram_chat_id,
    row_number() over (
      partition by telegram_chat_id
      order by created_at asc nulls last, id asc
    ) as row_num
  from public.users
  where telegram_chat_id is not null
)
update public.users as u
set telegram_chat_id = null
from ranked_duplicates as d
where u.id = d.id
  and d.row_num > 1;

-- Verification: this should return zero rows after cleanup.
select
  telegram_chat_id,
  count(*) as duplicate_count
from public.users
where telegram_chat_id is not null
group by telegram_chat_id
having count(*) > 1;

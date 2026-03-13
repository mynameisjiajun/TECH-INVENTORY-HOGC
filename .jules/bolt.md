## 2026-03-13 - [Avoid N+1 Database queries in SQLite apis]
**Learning:** Found an N+1 query problem where `activeLoans` was fetching its `loan_items` individually in a `for` loop `(for (const loan of activeLoans))`.
**Action:** Replace `for` loop queries with an `IN` clause `(WHERE li.loan_request_id IN (...))` to batch load items and then group them in-memory to prevent blocking the event loop and optimize SQLite operations on backends.## 2023-10-24 - Optimized N+1 queries using json_each
**Learning:** SQLite serverless limits parameters for `IN` queries. Instead of looping single SELECTs or hitting argument limits, joining over `json_each` is a massive performance win (5x faster) for fetching rows based on an array of IDs while circumventing parameter limit rules.
**Action:** Use `JOIN json_each(?)` with `JSON.stringify(ids)` for batch fetching arrays of data in Vercel/serverless environments.

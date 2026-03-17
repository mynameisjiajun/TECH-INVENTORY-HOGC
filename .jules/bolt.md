## 2026-03-13 - [Avoid N+1 Database queries in SQLite apis]
**Learning:** Found an N+1 query problem where `activeLoans` was fetching its `loan_items` individually in a `for` loop `(for (const loan of activeLoans))`.
**Action:** Replace `for` loop queries with an `IN` clause `(WHERE li.loan_request_id IN (...))` to batch load items and then group them in-memory to prevent blocking the event loop and optimize SQLite operations on backends.## 2024-05-18 - Avoid N+1 Queries with JSON_EACH and JOIN in Serverless
**Learning:** In Vercel serverless environments with SQLite, fetching data inside loops leads to N+1 queries. Using an `IN` clause works, but limits the number of parameters. Using `json_each` along with a `JOIN` performs substantially better than N+1 queries and avoids parameter limits entirely.
**Action:** When querying for multiple IDs in a serverless environment with SQLite, avoid looping. Instead, pass the list of IDs as a JSON string and query using `JOIN json_each(?)` to fetch everything in a single optimized query without running into parameter limits.

## 2026-03-15 - [Avoid Parameter Limits with JSON_EACH in SQLite]
**Learning:** Found an `IN (...)` clause array mapped with `?` placeholders for loading relation arrays `(WHERE li.loan_request_id IN (${placeholders}))` that could exceed the SQLite maximum parameter limit in Vercel serverless environments if dealing with many rows.
**Action:** Replace dynamic `IN` clauses parameterized with joined `?` string with `JOIN json_each(?) j ON ... = j.value` and pass `JSON.stringify(array)` to the statement variable to avoid SQLite maximum parameter limits and batch load items optimally without loops or scaling issues.

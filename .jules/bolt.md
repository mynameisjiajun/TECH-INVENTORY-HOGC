## 2026-03-13 - [Avoid N+1 Database queries in SQLite apis]
**Learning:** Found an N+1 query problem where `activeLoans` was fetching its `loan_items` individually in a `for` loop `(for (const loan of activeLoans))`.
**Action:** Replace `for` loop queries with an `IN` clause `(WHERE li.loan_request_id IN (...))` to batch load items and then group them in-memory to prevent blocking the event loop and optimize SQLite operations on backends.## 2024-05-18 - Avoid N+1 Queries with JSON_EACH and JOIN in Serverless
**Learning:** In Vercel serverless environments with SQLite, fetching data inside loops leads to N+1 queries. Using an `IN` clause works, but limits the number of parameters. Using `json_each` along with a `JOIN` performs substantially better than N+1 queries and avoids parameter limits entirely.
**Action:** When querying for multiple IDs in a serverless environment with SQLite, avoid looping. Instead, pass the list of IDs as a JSON string and query using `JOIN json_each(?)` to fetch everything in a single optimized query without running into parameter limits.
## 2025-03-17 - Prevent N+1 query issue when creating loan items
**Learning:** Found an N+1 query pattern where item availability checks and insertions were made inside a loop over the loan request items. Pre-fetching item data before the loop reduces the number of database roundtrips.
**Action:** Always batch queries or use map/reduce data structures before loop iterations when accessing the SQLite database to reduce latency in API routes.

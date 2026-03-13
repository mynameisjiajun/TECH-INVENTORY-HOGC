## 2026-03-13 - [Avoid N+1 Database queries in SQLite apis]
**Learning:** Found an N+1 query problem where `activeLoans` was fetching its `loan_items` individually in a `for` loop `(for (const loan of activeLoans))`.
**Action:** Replace `for` loop queries with an `IN` clause `(WHERE li.loan_request_id IN (...))` to batch load items and then group them in-memory to prevent blocking the event loop and optimize SQLite operations on backends.
## 2024-03-13 - Batch Loading Notifications & Items via JSON_EACH
**Learning:** For performance optimization, utilizing `JSON_EACH` in `better-sqlite3` to batch load relationships (like `loan_items` linked to multiple `loan_requests`) significantly cuts down execution time compared to querying in a loop, mitigating N+1 inefficiencies without generating dynamic massive string queries.
**Action:** Always favor batch queries outside of iterative loops, leveraging built-in JSON extensions to manage complex parameter arrays safely and efficiently in SQLite.

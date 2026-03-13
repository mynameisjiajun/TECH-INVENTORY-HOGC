## 2026-03-13 - [Avoid N+1 Database queries in SQLite apis]
**Learning:** Found an N+1 query problem where `activeLoans` was fetching its `loan_items` individually in a `for` loop `(for (const loan of activeLoans))`.
**Action:** Replace `for` loop queries with an `IN` clause `(WHERE li.loan_request_id IN (...))` to batch load items and then group them in-memory to prevent blocking the event loop and optimize SQLite operations on backends.

## 2024-06-18 - Fix N+1 Query in Loan Approval
**Learning:** Checking inventory levels for items within an approval loop caused N+1 database queries. Since Vercel serverless limits SQLite parameters and memory, doing an `IN` clause with a large parameter array is risky. Doing a `JOIN` to pre-fetch all storage items associated with a loan request upfront and storing them in a `Map` is significantly faster and more scalable.
**Action:** When performing validations or updates over an array of items (like loan items), pre-fetch all related data via a single `JOIN` query before the loop rather than executing individual `SELECT` queries for each item. This prevents N+1 bottlenecks.

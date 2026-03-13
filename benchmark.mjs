import Database from 'better-sqlite3';

const db = new Database(':memory:');

// Schema
db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, display_name TEXT);
  CREATE TABLE loan_requests (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, loan_type TEXT, end_date TEXT);
  CREATE TABLE storage_items (id INTEGER PRIMARY KEY, item TEXT);
  CREATE TABLE loan_items (loan_request_id INTEGER, item_id INTEGER, quantity INTEGER);
  CREATE TABLE notifications (id INTEGER PRIMARY KEY, user_id INTEGER, message TEXT, link TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

// Seed
db.exec(`INSERT INTO users (id, email, display_name) VALUES (1, 'test@example.com', 'Test User')`);
const today = new Date().toLocaleDateString('en-CA');
for (let i = 1; i <= 1000; i++) {
  db.exec(`INSERT INTO loan_requests (id, user_id, status, loan_type, end_date) VALUES (${i}, 1, 'approved', 'temporary', '2000-01-01')`);
  db.exec(`INSERT INTO storage_items (id, item) VALUES (${i}, 'Item ${i}')`);
  db.exec(`INSERT INTO loan_items (loan_request_id, item_id, quantity) VALUES (${i}, ${i}, 1)`);
}

// Data
const user = { id: 1 };
const overdueLoans = db.prepare("SELECT id, end_date FROM loan_requests WHERE user_id = 1").all();

function runUnoptimized() {
  const start = performance.now();
  let checked = 0;
  for (const loan of overdueLoans) {
    const existing = db
      .prepare(
        "SELECT id FROM notifications WHERE user_id = ? AND message LIKE '%overdue%' AND message LIKE ? AND created_at >= ?",
      )
      .get(user.id, `%#${loan.id}%`, today);
    if (!existing) {
      const loanItems = db
        .prepare(
          `SELECT li.quantity, si.item FROM loan_items li
           JOIN storage_items si ON li.item_id = si.id
           WHERE li.loan_request_id = ?`,
        )
        .all(loan.id);
      checked++;
    }
  }
  return performance.now() - start;
}

function runOptimized() {
  const start = performance.now();
  let checked = 0;

  const overdueNotifs = db.prepare(
    "SELECT message FROM notifications WHERE user_id = ? AND message LIKE '%overdue%' AND created_at >= ?"
  ).all(user.id, today);

  const loanIds = overdueLoans.map(l => l.id);
  const allItems = db.prepare(`
    SELECT li.loan_request_id, li.quantity, si.item
    FROM loan_items li
    JOIN storage_items si ON li.item_id = si.id
    JOIN json_each(?) je ON li.loan_request_id = je.value
  `).all(JSON.stringify(loanIds));

  const itemsByLoan = new Map();
  for (const item of allItems) {
    if (!itemsByLoan.has(item.loan_request_id)) itemsByLoan.set(item.loan_request_id, []);
    itemsByLoan.get(item.loan_request_id).push(item);
  }

  for (const loan of overdueLoans) {
    const existing = overdueNotifs.some(n => n.message.includes(`#${loan.id}`));
    if (!existing) {
      const loanItems = itemsByLoan.get(loan.id) || [];
      checked++;
    }
  }
  return performance.now() - start;
}

// Warmup
runUnoptimized();
runOptimized();

let t1 = 0;
let t2 = 0;
for(let i=0; i<5; i++) {
  t1 += runUnoptimized();
  t2 += runOptimized();
}

console.log('Unoptimized Avg:', t1 / 5, 'ms');
console.log('Optimized Avg:', t2 / 5, 'ms');

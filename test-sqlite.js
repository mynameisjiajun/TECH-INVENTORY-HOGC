const Database = require('better-sqlite3');
const db = new Database(':memory:');

db.exec(`
  CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT);
  INSERT INTO test (id, name) VALUES (1, 'A'), (2, 'B'), (3, 'C');
`);

const ids = [1, 3];
const rows = db.prepare(`
  SELECT t.* FROM json_each(?) j JOIN test t ON t.id = j.value
`).all(JSON.stringify(ids));

console.log(rows);

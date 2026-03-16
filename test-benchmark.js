const Database = require('better-sqlite3');
const db = new Database(':memory:');

db.exec(`
  CREATE TABLE storage_items (id INTEGER PRIMARY KEY, item TEXT, current INTEGER);
`);

// Insert 1000 items
const stmt = db.prepare('INSERT INTO storage_items (id, item, current) VALUES (?, ?, ?)');
for (let i = 1; i <= 1000; i++) {
  stmt.run(i, `Item ${i}`, i % 10 + 1); // Random stock from 1 to 10
}

const itemsToRequest = [];
for (let i = 1; i <= 50; i++) {
  itemsToRequest.push({ item_id: i * 2, quantity: 1 });
}

function benchmarkNPlus1() {
  const start = process.hrtime.bigint();
  for (let iter = 0; iter < 100; iter++) {
    for (const item of itemsToRequest) {
      const storageItem = db.prepare("SELECT * FROM storage_items WHERE id = ?").get(item.item_id);
      if (!storageItem) throw new Error("Item not found");
      if (storageItem.current < item.quantity) throw new Error("Not enough stock");
    }
  }
  const end = process.hrtime.bigint();
  return Number(end - start) / 1000000; // in milliseconds
}

function benchmarkIN() {
  const start = process.hrtime.bigint();
  for (let iter = 0; iter < 100; iter++) {
    const itemIds = itemsToRequest.map(i => i.item_id);
    const placeholders = itemIds.map(() => '?').join(',');
    const allStorageItems = db.prepare(`SELECT * FROM storage_items WHERE id IN (${placeholders})`).all(...itemIds);

    // Create map for easy access
    const storageItemMap = new Map();
    for (const si of allStorageItems) {
      storageItemMap.set(si.id, si);
    }

    for (const item of itemsToRequest) {
      const storageItem = storageItemMap.get(item.item_id);
      if (!storageItem) throw new Error("Item not found");
      if (storageItem.current < item.quantity) throw new Error("Not enough stock");
    }
  }
  const end = process.hrtime.bigint();
  return Number(end - start) / 1000000; // in milliseconds
}

function benchmarkJSON() {
  const start = process.hrtime.bigint();
  for (let iter = 0; iter < 100; iter++) {
    const itemIds = itemsToRequest.map(i => i.item_id);
    const allStorageItems = db.prepare(`SELECT t.* FROM json_each(?) j JOIN storage_items t ON t.id = j.value`).all(JSON.stringify(itemIds));

    // Create map for easy access
    const storageItemMap = new Map();
    for (const si of allStorageItems) {
      storageItemMap.set(si.id, si);
    }

    for (const item of itemsToRequest) {
      const storageItem = storageItemMap.get(item.item_id);
      if (!storageItem) throw new Error("Item not found");
      if (storageItem.current < item.quantity) throw new Error("Not enough stock");
    }
  }
  const end = process.hrtime.bigint();
  return Number(end - start) / 1000000; // in milliseconds
}

console.log("N+1 time (ms):", benchmarkNPlus1());
console.log("IN clause time (ms):", benchmarkIN());
console.log("JSON_EACH time (ms):", benchmarkJSON());

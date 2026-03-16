
const { ensureUsersRestored, getDb } = require('./lib/db/db');
const path = require('path');
const fs = require('fs');

// Mock process.env for local run if needed, but we have .env.local
// Next.js usually loads .env.local automatically in dev, but for a standalone script we might need to load it.
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

async function debug() {
  console.log('Starting debug script...');
  
  console.log('Initializing DB...');
  const db = getDb();
  console.log('DB initialized at:', db.name);
  
  console.log('Attempting to restore users from sheet...');
  console.log('This might hang if Google Sheets API is slow or blocked.');
  
  const start = Date.now();
  try {
    // We'll add a timeout manually here to see if it finishes
    const restorePromise = ensureUsersRestored();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 10000));
    
    await Promise.race([restorePromise, timeoutPromise]);
    console.log('Users restored successfully in', Date.now() - start, 'ms');
  } catch (err) {
    console.error('Error or Timeout during user restoration:', err.message);
  }
}

debug();

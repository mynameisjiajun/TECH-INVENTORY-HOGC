import fs from "fs";
import Database from "better-sqlite3";
import { resolve } from "path";

const dbPath = resolve(process.cwd(), ".data", "database.sqlite");
const db = new Database(dbPath);
const loans = db.prepare("SELECT * FROM loan_requests WHERE status = 'approved'").all();
console.log("Found approved loans to test:", loans.length);

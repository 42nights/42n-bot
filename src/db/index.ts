import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "bot.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

declare global {
  // eslint-disable-next-line no-var
  var __bot_db: Database.Database | undefined;
}

function openDb(): Database.Database {
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  return d;
}

export const db: Database.Database = globalThis.__bot_db ?? openDb();
if (!globalThis.__bot_db) globalThis.__bot_db = db;

export const PATHS = { DATA_DIR, DB_PATH };

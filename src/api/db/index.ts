import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { config } from "../config.ts";
import * as schema from "./schema/index.ts";

const sqlite = new Database(config.db.url);
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

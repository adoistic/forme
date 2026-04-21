import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import type { Database } from "./schema.js";
import { runMigrations } from "./migrations.js";
import { createLogger } from "../logger.js";

const logger = createLogger("db");

export interface CreateDbOptions {
  /** Path to the .sqlite file, or ":memory:" for in-memory testing. */
  filename: string;
  /** Whether to run migrations on open. Defaults to true. */
  migrate?: boolean;
}

export async function createDb(options: CreateDbOptions): Promise<Kysely<Database>> {
  const sqlite = new BetterSqlite3(options.filename);

  // Standard durability + concurrency knobs per SQLite best practice.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("temp_store = MEMORY");

  const db = new Kysely<Database>({
    dialect: new SqliteDialect({ database: sqlite }),
  });

  if (options.migrate !== false) {
    logger.info({ filename: options.filename }, "Running migrations on DB open");
    const result = await runMigrations(db);
    logger.info({ applied: result.applied }, "Migrations complete");
  }

  return db;
}

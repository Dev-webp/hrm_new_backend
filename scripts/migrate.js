// Migration runner: applies migrations/*.sql in order, tracked in schema_migrations.
// Usage: node scripts/migrate.js [--status] [--only=<file.sql>]
// Uses existing env config (PG_* / DATABASE_URL via middleware/db.js pool).
//
// Transaction ownership: THIS RUNNER owns the transaction. Migration files must
// NOT contain their own BEGIN/COMMIT — a COMMIT inside the file would silently
// commit the runner's transaction early. If a file contains BEGIN/COMMIT it is
// rejected unless --allow-tx is passed.
//
// Safety:
//  - refuses to run against 'deployingg' (production)
//  - pg advisory lock prevents concurrent runs
//  - checksum recorded on apply; mismatch on an already-applied file is reported
//    (the file is NOT rerun and its recorded checksum is NOT rewritten)
//  - stops on first failure; failed file is never recorded as applied
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { pool } from "../middleware/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const PRODUCTION_DB = "deployingg";
const ADVISORY_LOCK_KEY = 727301; // arbitrary constant for migration runs

// Files that must NEVER run through this runner.
const EXCLUDED = new Set([
  "031_fix_migration.sql",              // destructive DROP TABLE ... CASCADE
  "032_add_workflow_stages_and_seed.sql", // empty placeholder
]);

const checksum = (sql) => crypto.createHash("sha256").update(sql).digest("hex");
const hasTxControl = (sql) =>
  /^\s*(BEGIN|COMMIT|ROLLBACK|START TRANSACTION)\s*;?\s*$/im.test(sql);

async function ensureTracking(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum VARCHAR(64)
    )`);
}

function listMigrationFiles(only) {
  let files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !EXCLUDED.has(f));
  files.sort((a, b) => {
    const na = parseInt(a, 10), nb = parseInt(b, 10);
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });
  if (only) {
    if (!files.includes(only)) {
      console.error(`--only file not found or excluded: ${only}`);
      process.exit(1);
    }
    files = files.filter((f) => f === only);
  }
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const statusOnly = args.includes("--status");
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : null;
  const allowTx = args.includes("--allow-tx");

  const client = await pool.connect();
  try {
    const db = (await client.query("select current_database() d")).rows[0].d;
    console.log(`Connected to database: ${db}`);
    if (db === PRODUCTION_DB) {
      console.error(`REFUSING to run migrations against '${PRODUCTION_DB}' (production).`);
      process.exit(1);
    }

    // Prevent concurrent migration runs
    const lock = await client.query("select pg_try_advisory_lock($1) ok", [ADVISORY_LOCK_KEY]);
    if (!lock.rows[0].ok) {
      console.error("Another migration run is in progress. Aborting.");
      process.exit(1);
    }

    try {
      await ensureTracking(client);
      const appliedRows = await client.query("select name, checksum from schema_migrations");
      const applied = new Map(appliedRows.rows.map((r) => [r.name, r.checksum]));
      const files = listMigrationFiles(only);

      if (statusOnly) {
        for (const f of files) console.log(`${applied.has(f) ? "applied " : "pending "} ${f}`);
        return;
      }

      for (const file of files) {
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
        const sum = checksum(sql);

        if (applied.has(file)) {
          if (applied.get(file) && applied.get(file) !== sum) {
            console.warn(`checksum CHANGED (not rerun, not rewritten): ${file}`);
          }
          console.log(`skip (applied): ${file}`);
          continue;
        }

        if (hasTxControl(sql) && !allowTx) {
          console.error(`FAILED: ${file} contains BEGIN/COMMIT/ROLLBACK — runner owns transactions. Pass --allow-tx to override.`);
          process.exitCode = 1;
          break;
        }

        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query(
            "insert into schema_migrations (name, checksum) values ($1,$2)",
            [file, sum]
          );
          await client.query("COMMIT");
          console.log(`applied: ${file}`);
        } catch (err) {
          await client.query("ROLLBACK");
          console.error(`FAILED: ${file} -> ${err.message}`);
          process.exitCode = 1;
          break;
        }
      }
    } finally {
      await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

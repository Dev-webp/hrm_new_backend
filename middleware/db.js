import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;

const isProduction = process.env.NODE_ENV === "production";
const DB_STARTUP_RETRY_ATTEMPTS = Number(process.env.DB_STARTUP_RETRY_ATTEMPTS || 5);
const DB_STARTUP_RETRY_DELAY_MS = Number(process.env.DB_STARTUP_RETRY_DELAY_MS || 5000);
const DB_STATEMENT_TIMEOUT_MS = Number(process.env.PG_STATEMENT_TIMEOUT_MS || 60000);
const DB_QUERY_TIMEOUT_MS = Number(process.env.PG_QUERY_TIMEOUT_MS || 65000);

export const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false,
        max: Number(process.env.PG_POOL_MAX || 20),
        idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
        connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
        statement_timeout: DB_STATEMENT_TIMEOUT_MS,
        query_timeout: DB_QUERY_TIMEOUT_MS,
        application_name: process.env.PG_APPLICATION_NAME || "hrms-backend",
      }
    : {
        user: process.env.PG_USER,
        host: process.env.PG_HOST,
        database: process.env.PG_DATABASE,
        password: String(process.env.PG_PASSWORD),
        port: Number(process.env.PG_PORT),
        max: Number(process.env.PG_POOL_MAX || 20),
        idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
        connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 5000),
        statement_timeout: DB_STATEMENT_TIMEOUT_MS,
        query_timeout: DB_QUERY_TIMEOUT_MS,
        application_name: process.env.PG_APPLICATION_NAME || "hrms-backend",
      }
);

pool.on("error", (err) => {
  console.error("[DB_POOL_ERROR] Idle PostgreSQL client error:", {
    message: err.message,
    code: err.code,
    stack: err.stack,
  });
});

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyDatabaseConnection() {
  for (let attempt = 1; attempt <= DB_STARTUP_RETRY_ATTEMPTS; attempt += 1) {
    let client;
    try {
      client = await pool.connect();
      await client.query("SELECT 1");
      console.log("[DB_READY] Database connected successfully");
      return;
    } catch (err) {
      console.error("[DB_STARTUP_RETRY_FAILED]", {
        attempt,
        attempts: DB_STARTUP_RETRY_ATTEMPTS,
        message: err.message,
        code: err.code,
      });
      if (attempt < DB_STARTUP_RETRY_ATTEMPTS) {
        await sleep(DB_STARTUP_RETRY_DELAY_MS);
      }
    } finally {
      client?.release();
    }
  }

  console.error("[DB_STARTUP_DEGRADED] Database is not reachable after retries; server remains up for health checks and PM2 visibility.");
}

verifyDatabaseConnection().catch((err) => {
  console.error("[DB_STARTUP_CHECK_FAILED]", err);
});

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './middleware/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration(migrationFile) {
  const migrationPath = path.join(__dirname, 'migrations', migrationFile);

  try {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const client = await pool.connect();

    try {
      await client.query(sql);
      console.log(`[MIGRATION_SUCCESS] ${migrationFile} executed successfully`);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(`[MIGRATION_ERROR] ${migrationFile} failed:`, error.message);
    throw error;
  }
}

// Get migration file from command line argument
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('[MIGRATION_ERROR] Please provide migration file name as argument');
  console.error('Usage: node run-migration.js <migration-file.sql>');
  process.exit(1);
}

runMigration(migrationFile)
  .then(() => {
    console.log('[MIGRATION_COMPLETE] Migration process finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[MIGRATION_FAILED]', error);
    process.exit(1);
  });

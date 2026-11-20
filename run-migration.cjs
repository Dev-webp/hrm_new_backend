const { pool } = require('./middleware/db.js');
const fs = require('fs');

async function runMigration() {
  const client = await pool.connect();
  try {
    const migrationSQL = fs.readFileSync('./migrations/034_section_completion.sql', 'utf8');
    await client.query(migrationSQL);
    console.log('✅ Migration 034_section_completion.sql completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();

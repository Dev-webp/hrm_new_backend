import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'postgres',
  password: 'Aloneboysri@134',
  database: 'overseas'
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Connected to database');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', '034_employee_onboarding_details.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Running migration...');
    await client.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!');
    console.log('Tables created: employee_documents, employee_system_access, employee_department_setup');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();

import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'postgres',
  password: 'Aloneboysri@134',
  database: 'overseas'
});

async function fixMigration() {
  const client = await pool.connect();
  try {
    console.log('Connected to database');
    
    // Check if upload_date column exists in employee_documents
    const checkColumn = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'employee_documents' 
      AND column_name = 'upload_date'
    `);
    
    if (checkColumn.rows.length === 0) {
      console.log('Column upload_date does not exist, adding it...');
      await client.query(`
        ALTER TABLE employee_documents 
        ADD COLUMN IF NOT EXISTS upload_date DATE
      `);
      console.log('✅ Added upload_date column');
    } else {
      console.log('✅ upload_date column already exists');
    }
    
    // Verify the table structure
    const tableInfo = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'employee_documents' 
      ORDER BY ordinal_position
    `);
    
    console.log('\nCurrent employee_documents table structure:');
    tableInfo.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

fixMigration();

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

async function createAssetsTable() {
  const client = await pool.connect();
  try {
    console.log('Connected to database');
    
    // Create employee_assets table
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_assets (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        asset_name VARCHAR(100) NOT NULL,
        asset_type VARCHAR(50),
        tag_number VARCHAR(50),
        imei VARCHAR(50),
        phone_number VARCHAR(20),
        condition VARCHAR(50),
        status VARCHAR(20) DEFAULT 'not_assigned' CHECK (status IN ('assigned', 'returned', 'not_assigned')),
        notes TEXT,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ employee_assets table created');
    
    // Create employee_joining_formalities table
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_joining_formalities (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        formality_name VARCHAR(100) NOT NULL,
        formality_type VARCHAR(50),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'awaiting_signature', 'acknowledged')),
        notes TEXT,
        document_url TEXT,
        acknowledged_by INTEGER,
        acknowledged_at TIMESTAMPTZ,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ employee_joining_formalities table created');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

createAssetsTable();

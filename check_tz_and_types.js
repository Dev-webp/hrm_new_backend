import { pool } from './middleware/db.js';

async function checkTZAndTypes() {
  try {
    await pool.query('SET default_transaction_read_only = on');
    
    console.log('=== Column Types ===');
    const leaveColTypes = await pool.query(`
      SELECT column_name, data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_name = 'leave_requests' 
      AND column_name IN ('from_date', 'to_date')
    `);
    console.log('leave_requests date columns:', leaveColTypes.rows);
    
    const attColTypes = await pool.query(`
      SELECT column_name, data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_name = 'attendance_records' 
      AND column_name = 'date'
    `);
    console.log('attendance_records date column:', attColTypes.rows);
    
    console.log('\n=== Database Session Timezone ===');
    const dbTZ = await pool.query('SHOW timezone');
    console.log('DB timezone:', dbTZ.rows[0].TimeZone);
    
    console.log('\n=== Server Process Timezone ===');
    console.log('Process TZ:', process.env.TZ || 'Not set');
    console.log('Node default TZ:', Intl.DateTimeFormat().resolvedOptions().timeZone);
    
    console.log('\n=== Current Time in Different Zones ===');
    const now = new Date();
    console.log('UTC:', now.toISOString());
    console.log('Local:', now.toString());
    
    console.log('\n=== Leave 310 Raw Data ===');
    const leave310 = await pool.query(`
      SELECT id, from_date, to_date, leave_type, status, requested_days, created_at
      FROM leave_requests 
      WHERE id = 310
    `);
    console.log(JSON.stringify(leave310.rows[0], null, 2));
    
    console.log('\n=== Attendance Records for Leave 310 ===');
    const att310 = await pool.query(`
      SELECT id, user_id, date, status, leave_type, leave_status, created_at
      FROM attendance_records 
      WHERE leave_request_id = 310
      ORDER BY date
    `);
    console.log(JSON.stringify(att310.rows, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkTZAndTypes();

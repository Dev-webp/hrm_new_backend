import { pool } from './middleware/db.js';
import { calculatePayroll } from './routes/payrollService.js';

async function testPayroll() {
  try {
    // Set read-only mode to prevent any writes
    await pool.query('SET default_transaction_read_only = on');
    console.log('Read-only mode enabled');
    
    // Check DB timezone
    const tzResult = await pool.query('SHOW timezone');
    console.log('DB timezone:', tzResult.rows[0].TimeZone);
    
    // Check column types
    console.log('\n=== Column types ===');
    const leaveColTypes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'leave_requests' 
      AND column_name IN ('from_date', 'to_date')
    `);
    console.log('leave_requests date columns:', leaveColTypes.rows);
    
    const attColTypes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'attendance_records' 
      AND column_name = 'date'
    `);
    console.log('attendance_records date column:', attColTypes.rows);
    
    // A. October 2026, user 32, today "2026-09-28", sandwich OFF
    console.log('\n=== A. October 2026, user 32, sandwich OFF ===');
    const rA = await calculatePayroll(pool, 32, 2026, 10, { today: '2026-09-28', sandwichEnabled: false });
    console.log(JSON.stringify({
      pendingDays: rA.attendance.pendingDays,
      pendingDates: rA.attendance.pendingDates,
      absentDays: rA.attendance.absentDays,
      absentDates: rA.attendance.absentDates,
      formalLeaveCount: rA.attendance.formalLeaveCount,
      unpaid: rA.leave.unpaidLeaveDays,
      paidUsed: rA.leave.paidLeaveUsed,
      payable: rA.salary.payableDays,
      net: rA.salary.netPay,
    }, null, 2));
    
    // B. October 2026, user 32, today "2026-09-28", sandwich ON
    console.log('\n=== B. October 2026, user 32, sandwich ON ===');
    const rB = await calculatePayroll(pool, 32, 2026, 10, { today: '2026-09-28', sandwichEnabled: true });
    console.log(JSON.stringify({
      sandwichDates: rB.sandwich.results.filter(r => r.applied),
      unpaid: rB.leave.unpaidLeaveDays,
      paidUsed: rB.leave.paidLeaveUsed,
      payable: rB.salary.payableDays,
      net: rB.salary.netPay,
    }, null, 2));
    
    // C. November 2026, user 32, today "2026-09-28", sandwich ON
    console.log('\n=== C. November 2026, user 32, sandwich ON ===');
    const rC = await calculatePayroll(pool, 32, 2026, 11, { today: '2026-09-28', sandwichEnabled: true });
    console.log(JSON.stringify({
      sandwichDates: rC.sandwich.results.filter(r => r.applied),
      unpaid: rC.leave.unpaidLeaveDays,
      paidUsed: rC.leave.paidLeaveUsed,
      payable: rC.salary.payableDays,
      net: rC.salary.netPay,
    }, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testPayroll();

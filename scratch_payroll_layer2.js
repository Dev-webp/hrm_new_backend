import { pool } from './middleware/db.js';
import { calculatePayroll } from './routes/payrollService.js';

async function runLayer2Check() {
  try {
    console.log('=== LAYER 2 PAYROLL VERIFICATION ===\n');

    // October 2026, user 32, sandwich OFF
    console.log('--- October 2026, User 32, Sandwich OFF ---');
    const octOff = await calculatePayroll(pool, 32, 2026, 10, {
      today: '2026-09-28',
      sandwichEnabled: false,
    });
    console.log('Tally:');
    console.log('  pendingDays:', octOff.attendance.pendingDays);
    console.log('  absentDays:', octOff.attendance.absentDays);
    console.log('  formalLeaveCount:', octOff.attendance.formalLeaveCount);
    console.log('Leave:');
    console.log('  unpaidLeaveDays:', octOff.leave.unpaidLeaveDays);
    console.log('  paidLeaveUsed:', octOff.leave.paidLeaveUsed);
    console.log('  penaltyDays:', octOff.leave.penaltyDays);
    console.log('Salary:');
    console.log('  payableDays:', octOff.salary.payableDays);
    console.log('  penaltyDeduction:', octOff.salary.penaltyDeduction);
    console.log('  netPay:', octOff.salary.netPay);
    console.log('Sandwich dates:', octOff.sandwich.results);

    // October 2026, user 32, sandwich ON
    console.log('\n--- October 2026, User 32, Sandwich ON ---');
    const octOn = await calculatePayroll(pool, 32, 2026, 10, {
      today: '2026-09-28',
      sandwichEnabled: true,
    });
    console.log('Tally:');
    console.log('  pendingDays:', octOn.attendance.pendingDays);
    console.log('  absentDays:', octOn.attendance.absentDays);
    console.log('  formalLeaveCount:', octOn.attendance.formalLeaveCount);
    console.log('Leave:');
    console.log('  unpaidLeaveDays:', octOn.leave.unpaidLeaveDays);
    console.log('  paidLeaveUsed:', octOn.leave.paidLeaveUsed);
    console.log('  penaltyDays:', octOn.leave.penaltyDays);
    console.log('Salary:');
    console.log('  payableDays:', octOn.salary.payableDays);
    console.log('  penaltyDeduction:', octOn.salary.penaltyDeduction);
    console.log('  netPay:', octOn.salary.netPay);
    console.log('Sandwich dates:', octOn.sandwich.results);

    // November 2026, user 32, sandwich ON
    console.log('\n--- November 2026, User 32, Sandwich ON ---');
    const novOn = await calculatePayroll(pool, 32, 2026, 11, {
      today: '2026-09-28',
      sandwichEnabled: true,
    });
    console.log('Tally:');
    console.log('  pendingDays:', novOn.attendance.pendingDays);
    console.log('  absentDays:', novOn.attendance.absentDays);
    console.log('  formalLeaveCount:', novOn.attendance.formalLeaveCount);
    console.log('Leave:');
    console.log('  unpaidLeaveDays:', novOn.leave.unpaidLeaveDays);
    console.log('  paidLeaveUsed:', novOn.leave.paidLeaveUsed);
    console.log('  penaltyDays:', novOn.leave.penaltyDays);
    console.log('Salary:');
    console.log('  payableDays:', novOn.salary.payableDays);
    console.log('  penaltyDeduction:', novOn.salary.penaltyDeduction);
    console.log('  netPay:', novOn.salary.netPay);
    console.log('Sandwich dates:', novOn.sandwich.results);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

runLayer2Check();

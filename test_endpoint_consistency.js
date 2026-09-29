import { pool } from './middleware/db.js';
import { getAttendanceWithPolicy } from './utils/attendanceWithPolicy.js';

async function testEndpointConsistency() {
  try {
    console.log('=== ENDPOINT CONSISTENCY TEST FOR USER 41 ===\n');

    const userId = 41;
    const octStart = '2026-10-01';
    const octEnd = '2026-10-31';
    const novStart = '2026-11-01';
    const novEnd = '2026-11-30';

    // Test October 2026
    console.log('--- OCTOBER 2026 ---');
    const octResult = await getAttendanceWithPolicy(userId, octStart, octEnd);

    console.log('Total rows:', octResult.rows.length);
    console.log('Summary:', octResult.summary);

    // Find Oct 4
    const oct4 = octResult.rows.find(r => r.date === '2026-10-04');
    console.log('\nOct 4 record:', JSON.stringify(oct4, null, 2));

    if (oct4 && oct4.sandwich && oct4.sandwich.some(s => s.applied === true)) {
      console.log('✅ Oct 4 is penalized (applied: true)');
    } else {
      console.log('❌ Oct 4 is NOT penalized');
    }

    // Test November 2026
    console.log('\n--- NOVEMBER 2026 ---');
    const novResult = await getAttendanceWithPolicy(userId, novStart, novEnd);

    console.log('Total rows:', novResult.rows.length);
    console.log('Summary:', novResult.summary);

    // Find Nov 8
    const nov8 = novResult.rows.find(r => r.date === '2026-11-08');
    console.log('\nNov 8 record:', JSON.stringify(nov8, null, 2));

    if (nov8 && nov8.sandwich && nov8.sandwich.some(s => s.applied === true)) {
      console.log('✅ Nov 8 is penalized (applied: true)');
    } else {
      console.log('❌ Nov 8 is NOT penalized (expected based on current backend result)');
    }

    // Check for Fri+Sat+Sun pattern
    console.log('\n--- CHECKING FRI+SAT+SUN PATTERN ---');
    const friNov6 = novResult.rows.find(r => r.date === '2026-11-06');
    const satNov7 = novResult.rows.find(r => r.date === '2026-11-07');
    const sunNov8 = novResult.rows.find(r => r.date === '2026-11-08');

    console.log('Fri Nov 6:', friNov6 ? { status: friNov6.status, leave_type: friNov6.leave_type } : 'No record');
    console.log('Sat Nov 7:', satNov7 ? { status: satNov7.status, leave_type: satNov7.leave_type } : 'No record');
    console.log('Sun Nov 8:', nov8 ? { status: nov8.status, sandwich: nov8.sandwich } : 'No record');

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testEndpointConsistency();

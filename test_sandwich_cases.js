import { getAttendanceWithPolicy } from './utils/attendanceWithPolicy.js';

async function testSandwichCases() {
  try {
    console.log('=== SANDWICH POLICY TEST CASES ===\n');

    // Test 1: Wed-Thu-Fri-Sat + Mon leave (Sunday penalized)
    console.log('--- TEST 1: Wed-Thu-Fri-Sat + Mon leave (Sunday penalized) ---');
    // This would require creating a leave request covering these dates
    // For now, we'll test with existing data

    // Test 2: Fri + Sat leave (Sunday penalized - NEW RULE)
    console.log('\n--- TEST 2: Fri + Sat leave (Sunday penalized) ---');
    const novResult = await getAttendanceWithPolicy(41, '2026-11-01', '2026-11-30');
    const friNov6 = novResult.rows.find(r => r.date === '2026-11-06');
    const satNov7 = novResult.rows.find(r => r.date === '2026-11-07');
    const sunNov8 = novResult.rows.find(r => r.date === '2026-11-08');
    console.log('Fri Nov 6:', friNov6 ? { status: friNov6.status, leave_type: friNov6.leave_type } : 'No record');
    console.log('Sat Nov 7:', satNov7 ? { status: satNov7.status, leave_type: satNov7.leave_type } : 'No record');
    console.log('Sun Nov 8:', sunNov8 ? { status: sunNov8.status, sandwich: sunNov8.sandwich } : 'No record');
    if (sunNov8 && sunNov8.sandwich && sunNov8.sandwich.some(s => s.applied === true)) {
      console.log('✅ Sunday penalized (FRI_SAT_SUN_NON_WORKING)');
    } else {
      console.log('❌ Sunday NOT penalized');
    }

    // Test 3: Single Saturday with working Monday (SATURDAY_ALLOWANCE, no penalty)
    console.log('\n--- TEST 3: Single Saturday with working Monday (SATURDAY_ALLOWANCE) ---');
    // Need to find a case with single Saturday leave
    // For now, we'll check November 21 which is a Saturday
    const satNov21 = novResult.rows.find(r => r.date === '2026-11-21');
    const sunNov22 = novResult.rows.find(r => r.date === '2026-11-22');
    console.log('Sat Nov 21:', satNov21 ? { status: satNov21.status, leave_type: satNov21.leave_type } : 'No record');
    console.log('Sun Nov 22:', sunNov22 ? { status: sunNov22.status, sandwich: sunNov22.sandwich } : 'No record');
    if (sunNov22 && sunNov22.sandwich && sunNov22.sandwich.some(s => s.applied === false && s.reason === 'SATURDAY_ALLOWANCE')) {
      console.log('✅ Sunday gets SATURDAY_ALLOWANCE (no penalty)');
    } else if (sunNov22 && sunNov22.sandwich && sunNov22.sandwich.some(s => s.applied === false)) {
      console.log('⚠️ Sunday not penalized for different reason:', sunNov22.sandwich[0].reason);
    } else {
      console.log('⚠️ No sandwich data for this Sunday');
    }

    // Test 4: Holiday inside a leave block
    console.log('\n--- TEST 4: Holiday inside a leave block ---');
    const diwaliNov14 = novResult.rows.find(r => r.date === '2026-11-14');
    console.log('Nov 14 (Diwali):', diwaliNov14 ? { status: diwaliNov14.status, leave_type: diwaliNov14.leave_type, sandwich: diwaliNov14.sandwich } : 'No record');
    if (diwaliNov14 && diwaliNov14.sandwich && diwaliNov14.sandwich.some(s => s.reason === 'HOLIDAY_EXCLUDED')) {
      console.log('✅ Holiday excluded from sandwich policy');
    } else {
      console.log('⚠️ Holiday exclusion not found');
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testSandwichCases();

/**
 * AWI Detection Trigger Script
 * Run this script to trigger AWI detection for today
 * Can be scheduled via cron job or Windows Task Scheduler
 */

import { runDailyAWIDetection } from './services/awiDetectionService.js';

async function main() {
  try {
    console.log('🚀 Starting AWI Detection Trigger...');
    console.log('Time:', new Date().toLocaleString());
    
    const result = await runDailyAWIDetection();
    
    console.log('\n✅ Detection Completed!');
    console.log('📊 Results:');
    console.log(`  Date: ${result.date}`);
    console.log(`  Total Absent: ${result.total_absent}`);
    console.log(`  Cases Created: ${result.cases_created}`);
    console.log(`  Pending Cases: ${result.pending_cases}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Detection Failed:', error);
    process.exit(1);
  }
}

main();

/**
 * Late Login Report Generator
 *
 * This script generates a report on late login trends using existing
 * calculateMonthlySummary and evaluateLateLogin functions.
 *
 * Output:
 * - Monthly late count trend (last 12 months)
 * - Per-date detail for each late day
 * - Month-over-month delta
 * - Anomalies section
 */

import { pool } from "./middleware/db.js";
import {
  calculateMonthlySummary,
  evaluateLateLogin,
  formatDateStr,
} from "./utils/attendancePolicy.js";
import { promises as fs } from "fs";
import path from "path";

// Configuration
const USER_ID = null; // Set to a specific user ID (number) or null for all users
const MONTHS_BACK = 12; // Number of months to analyze

/**
 * Fetch holiday set for a date range
 */
async function fetchHolidaySetForDateRange(startDate, endDate) {
  const res = await pool.query(
    `SELECT TO_CHAR(date,'YYYY-MM-DD') AS date
     FROM company_holidays
     WHERE date BETWEEN $1::date AND $2::date`,
    [startDate, endDate]
  );
  return new Set(res.rows.map((r) => r.date));
}

// Time constants from attendancePolicy.js
const T_ON_TIME_GRACE_END = 10 * 3600 + 15 * 60; // 10:15 AM
const T_LATE_LOGIN_START = 10 * 3600 + 30 * 60; // 10:30 AM
const T_HALF_DAY_LOGIN_START = 14 * 3600 + 30 * 60; // 2:30 PM
const T_AFTERNOON_HALF_DAY_START = 12 * 3600; // 12:00 PM

/**
 * Fetch attendance logs for a user for a given date range
 */
async function fetchAttendanceLogs(userId, startDate, endDate) {
  const query = `
    SELECT
      TO_CHAR(date, 'YYYY-MM-DD') AS date,
      check_in_time AS office_in,
      check_out_time AS office_out,
      total_break_minutes,
      leave_type,
      leave_status,
      half_day_slot
    FROM attendance_records
    WHERE user_id = $1
      AND date BETWEEN $2 AND $3
    ORDER BY date ASC
  `;
  const result = await pool.query(query, [userId, startDate, endDate]);
  return result.rows;
}

/**
 * Fetch all active users
 */
async function fetchActiveUsers() {
  const query = `
    SELECT id, full_name, email, department, branch
    FROM users
    WHERE role != 'SUPER_ADMIN'
      AND COALESCE(status, 'active') = 'active'
    ORDER BY full_name ASC
  `;
  const result = await pool.query(query);
  return result.rows;
}

/**
 * Build logsByDate map from attendance records
 */
function buildLogsByDate(records) {
  const logsByDate = {};
  for (const record of records) {
    logsByDate[record.date] = record;
  }
  return logsByDate;
}

/**
 * Analyze a single month for a user
 */
async function analyzeMonth(userId, year, month) {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  // Fetch attendance records
  const records = await fetchAttendanceLogs(userId, startDate, endDate);
  const logsByDate = buildLogsByDate(records);

  // Fetch holidays
  const holidaySet = await fetchHolidaySetForDateRange(startDate, endDate);

  // Calculate monthly summary using existing function
  const summary = calculateMonthlySummary(logsByDate, year, month, holidaySet);

  // Collect per-date late details
  const lateDetails = [];
  for (const [dateStr, log] of Object.entries(logsByDate)) {
    if (!log) continue;

    const lateInfo = evaluateLateLogin(log);
    if (lateInfo.is_countable_late) {
      lateDetails.push({
        date: dateStr,
        office_in: log.office_in,
        is_within_grace: lateInfo.is_within_grace, // 10:15-10:29
        is_beyond_grace: lateInfo.is_beyond_grace, // 10:30-14:29
      });
    }
  }

  return {
    userId,
    year,
    month,
    late_count: summary.late_count,
    late_details: lateDetails,
  };
}

/**
 * Generate month-over-month delta
 */
function calculateDelta(currentMonth, previousMonth) {
  if (!previousMonth) {
    return { delta: null, direction: "no_previous_month" };
  }

  const delta = currentMonth.late_count - previousMonth.late_count;
  let direction = "flat";
  if (delta > 0) direction = "up";
  if (delta < 0) direction = "down";

  return { delta, direction };
}

/**
 * Detect anomalies in the data
 */
function detectAnomalies(userAnalysis) {
  const anomalies = [];

  for (const { userId, name, monthlyData, lateDetails } of userAnalysis) {
    // Check for duplicate logs for the same date
    const dateCounts = {};
    for (const { date } of lateDetails) {
      dateCounts[date] = (dateCounts[date] || 0) + 1;
    }
    for (const [date, count] of Object.entries(dateCounts)) {
      if (count > 1) {
        anomalies.push({
          type: "duplicate_late_logs",
          userId,
          name,
          detail: `User ${userId} (${name}) has ${count} late log entries for ${date}`,
        });
      }
    }

    // Check for unusual late counts (more than 20 in a month)
    for (const { year, month, late_count } of monthlyData) {
      if (late_count > 20) {
        anomalies.push({
          type: "high_late_count",
          userId,
          name,
          detail: `User ${userId} (${name}) has ${late_count} late days in ${year}-${String(month).padStart(2, "0")}`,
        });
      }
    }

    // Check for invalid office_in times
    for (const { date, office_in } of lateDetails) {
      if (!office_in) continue;
      const [hours, minutes] = office_in.split(":").map(Number);
      if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        anomalies.push({
          type: "invalid_time",
          userId,
          name,
          detail: `User ${userId} (${name}) has invalid office_in time "${office_in}" on ${date}`,
        });
      }
    }
  }

  return anomalies;
}

/**
 * Generate the full report
 */
async function generateReport() {
  console.log("=== LATE LOGIN REPORT GENERATION ===\n");

  // Get users to analyze
  let users;
  if (USER_ID) {
    const userResult = await pool.query(
      "SELECT id, full_name, email, department, branch FROM users WHERE id = $1",
      [USER_ID]
    );
    users = userResult.rows;
    if (users.length === 0) {
      console.error(`User ${USER_ID} not found`);
      return;
    }
  } else {
    users = await fetchActiveUsers();
  }

  console.log(`Analyzing ${users.length} user(s)...\n`);

  // Calculate date range (last 12 months)
  const today = new Date();
  const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const startDate = new Date(today.getFullYear(), today.getMonth() - MONTHS_BACK + 1, 1);

  const analysisResults = [];

  // Analyze each user
  for (const user of users) {
    console.log(`Processing user: ${user.full_name} (ID: ${user.id})`);

    const monthlyData = [];
    const allLateDetails = [];

    // Analyze each month
    for (let i = 0; i < MONTHS_BACK; i++) {
      const monthDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth() + 1;

      try {
        const monthData = await analyzeMonth(user.id, year, month);
        monthlyData.push(monthData);
        allLateDetails.push(...monthData.late_details);
      } catch (err) {
        console.error(`  Error analyzing ${year}-${String(month).padStart(2, "0")}:`, err.message);
      }
    }

    // Calculate month-over-month deltas
    const monthlyWithDeltas = monthlyData.map((current, index) => {
      const previous = monthlyData[index - 1] || null;
      const delta = calculateDelta(current, previous);
      return { ...current, delta };
    });

    analysisResults.push({
      userId: user.id,
      name: user.full_name,
      email: user.email,
      department: user.department,
      branch: user.branch,
      monthlyData: monthlyWithDeltas,
      lateDetails: allLateDetails,
    });
  }

  // Detect anomalies
  console.log("\nDetecting anomalies...");
  const anomalies = detectAnomalies(analysisResults);

  // Generate report
  const reportContent = generateMarkdownReport(analysisResults, anomalies);

  // Save report to file
  const reportPath = path.join(process.cwd(), "LATE_LOGIN_REPORT.md");
  await fs.writeFile(reportPath, reportContent, "utf-8");
  console.log(`\nReport saved to: ${reportPath}`);

  // Also save as CSV
  const csvContent = generateCSVReport(analysisResults);
  const csvPath = path.join(process.cwd(), "LATE_LOGIN_REPORT.csv");
  await fs.writeFile(csvPath, csvContent, "utf-8");
  console.log(`CSV saved to: ${csvPath}`);

  console.log("\n=== REPORT GENERATION COMPLETE ===");
}

/**
 * Generate markdown report
 */
function generateMarkdownReport(analysisResults, anomalies) {
  let md = "# Late Login Report\n\n";
  md += `Generated: ${new Date().toISOString()}\n`;
  md += `Users analyzed: ${analysisResults.length}\n`;
  md += `Analysis period: Last ${MONTHS_BACK} months\n\n`;

  // Anomalies section
  if (anomalies.length > 0) {
    md += "## Anomalies\n\n";
    for (const anomaly of anomalies) {
      md += `- **${anomaly.type}**: ${anomaly.detail}\n`;
    }
    md += "\n";
  }

  // Per-user summary
  md += "## Monthly Late Count Trend\n\n";

  for (const user of analysisResults) {
    md += `### ${user.name} (ID: ${user.id})\n`;
    md += `- Email: ${user.email}\n`;
    md += `- Department: ${user.department}\n`;
    md += `- Branch: ${user.branch}\n\n`;

    md += "| Year | Month | Late Count | Delta | Direction |\n";
    md += "|------|-------|------------|-------|----------|\n";

    for (const month of user.monthlyData) {
      const deltaDisplay = month.delta.delta !== null ? month.delta.delta : "N/A";
      const directionDisplay = month.delta.direction === "flat" && month.delta.delta === 0 ? "→" : 
                             month.delta.direction === "up" ? "↑" : 
                             month.delta.direction === "down" ? "↓" : "N/A";
      md += `| ${month.year} | ${String(month.month).padStart(2, "0")} | ${month.late_count} | ${deltaDisplay} | ${directionDisplay} |\n`;
    }

    md += "\n";
  }

  // Per-date details
  md += "## Per-Date Late Details\n\n";

  for (const user of analysisResults) {
    if (user.lateDetails.length === 0) {
      md += `### ${user.name} - No late days in analysis period\n\n`;
      continue;
    }

    md += `### ${user.name} (${user.lateDetails.length} late days)\n\n`;
    md += "| Date | Office In | Within Grace (10:15-10:29) | Beyond Grace (10:30-14:29) |\n";
    md += "|------|-----------|-------------------------------|----------------------------------|\n";

    for (const detail of user.lateDetails) {
      const withinGrace = detail.is_within_grace ? "✓" : "✗";
      const beyondGrace = detail.is_beyond_grace ? "✓" : "✗";
      md += `| ${detail.date} | ${detail.office_in} | ${withinGrace} | ${beyondGrace} |\n`;
    }

    md += "\n";
  }

  return md;
}

/**
 * Generate CSV report
 */
function generateCSVReport(analysisResults) {
  let csv = "user_id,name,email,department,branch,year,month,late_count,delta,delta_direction\n";

  for (const user of analysisResults) {
    for (const month of user.monthlyData) {
      const delta = month.delta.delta !== null ? month.delta.delta : "";
      const direction = month.delta.direction;
      csv += `${user.userId},"${user.name}","${user.email}","${user.department}","${user.branch}",${month.year},${month.month},${month.late_count},${delta},${direction}\n`;
    }
  }

  return csv;
}

// Run the report
generateReport().catch((err) => {
  console.error("Report generation failed:", err);
  process.exit(1);
});

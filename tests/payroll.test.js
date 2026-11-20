import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculatePayroll, persistPayslip } from "../routes/payrollService.js";

function makePayrollPool(joiningDate) {
  return {
    async query(sql) {
      if (sql.includes("FROM users WHERE id")) {
        return {
          rows: [{
            id: 7,
            full_name: "Test Employee",
            email: "test@example.com",
            department: "Sales",
            branch: "Hyderabad",
            monthly_salary: 30000,
            employee_code: "VJC007",
            joining_date: joiningDate,
            role: "EMPLOYEE",
          }],
        };
      }
      if (sql.includes("COALESCE(SUM(deduction_days)")) {
        return { rows: [{ total_deduction_days: 0 }] };
      }
      if (
        sql.includes("FROM company_holidays") ||
        sql.includes("FROM attendance_records") ||
        sql.includes("FROM employee_breaks") ||
        sql.includes("FROM leave_requests") ||
        sql.includes("FROM awi_cases")
      ) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

describe("payroll mid-month join clamp", () => {
  it("excludes dates before joining from absence and payable-day calculations", async () => {
    const fakePool = makePayrollPool("2026-07-15");
    const payroll = await calculatePayroll(fakePool, 7, 2026, 7);

    assert.equal(payroll.period.effectiveStartDate, "2026-07-15");
    assert.equal(payroll.calendar.preJoinExcludedDays, 14);
    assert.equal(payroll.calendar.activeDaysInMonth, 17);
    assert.ok(payroll.attendance.absentDates.every(date => date >= "2026-07-15"));
    assert.ok(payroll.salary.payableDays <= 17);
  });

  it("uses one monthly paid-leave day to cover an eligible absence and pay that day", async () => {
    const [eligiblePayroll, ineligiblePayroll] = await Promise.all([
      calculatePayroll(makePayrollPool("2026-01-01"), 7, 2026, 7),
      calculatePayroll(makePayrollPool("2026-07-15"), 7, 2026, 7),
    ]);

    assert.equal(eligiblePayroll.leave.eligible, true);
    assert.equal(eligiblePayroll.leave.paidLeaveUsed, 1);
    assert.equal(
      eligiblePayroll.leave.unpaidLeaveDays,
      eligiblePayroll.leave.totalAbsences - eligiblePayroll.leave.paidLeaveUsed
    );
    assert.equal(
      eligiblePayroll.salary.payableDays,
      ineligiblePayroll.salary.payableDays + 1
    );
  });
});

describe("payslip persistence", () => {
  it("uses one value expression per target column and matches all bind parameters", async () => {
    let insertSql;
    let insertParams;
    const client = {
      async query(sql, params) {
        if (sql.includes("SELECT incentives, deductions, tax, net_pay")) {
          return { rows: [] };
        }
        if (sql.includes("information_schema.columns")) return { rows: [] };
        if (sql.includes("INSERT INTO payslip_records")) {
          insertSql = sql;
          insertParams = params;
          return { rows: [{ id: 1 }] };
        }
        return { rows: [] };
      },
      release() {},
    };
    const fakePool = { async connect() { return client; } };
    const calc = {
      employee: { id: 7 },
      period: { monthStart: "2026-07-01" },
      attendance: { fullDays: 2, halfDays: 1, absentDays: 5, formalLeaveCount: 0 },
      leave: { unpaidLeaveDays: 6, paidLeaveUsed: 1, penaltyDays: 0 },
      salary: {
        monthlyCTC: 31000,
        earnedSalary: 0,
        payableDays: 4,
        awiDeductionDays: 0,
        lateLoginCount: 0,
        lateLoginPenalty: 0,
      },
      calendar: { totalDaysInMonth: 31, sundayCount: 4, holidayCount: 2, workingDaysCount: 27 },
      sandwich: { paidSundays: ["2026-07-05"], unpaidSundays: ["2026-07-12"] },
      breakdown: {},
    };

    await persistPayslip(fakePool, calc);

    const [, columns, values] = insertSql.match(
      /INSERT INTO payslip_records\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/
    );
    assert.equal(columns.split(",").length, 30);
    assert.equal(values.split(",").length, 30);
    assert.equal(insertParams.length, 29);
    assert.equal(Math.max(...Array.from(values.matchAll(/\$(\d+)/g), match => Number(match[1]))), 29);
    assert.deepEqual(insertParams.slice(19), [1, 1, 1, 2, 0, 0, 2, 4, 1, 4]);
  });
});

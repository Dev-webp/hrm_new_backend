import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculatePayroll } from "../routes/payrollService.js";

describe("payroll mid-month join clamp", () => {
  it("excludes dates before joining from absence and payable-day calculations", async () => {
    const fakePool = {
      async query(sql) {
        if (sql.includes("FROM users WHERE id")) {
          return {
            rows: [{
              id: 7,
              full_name: "New Employee",
              email: "new@example.com",
              department: "Sales",
              branch: "Hyderabad",
              monthly_salary: 31000,
              employee_code: "VJC007",
              joining_date: "2026-07-15",
              role: "EMPLOYEE",
            }],
          };
        }
        if (sql.includes("FROM company_holidays")) return { rows: [] };
        if (sql.includes("FROM attendance_records")) return { rows: [] };
        if (sql.includes("FROM leave_requests")) return { rows: [] };
        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    const payroll = await calculatePayroll(fakePool, 7, 2026, 7);

    assert.equal(payroll.period.effectiveStartDate, "2026-07-15");
    assert.equal(payroll.calendar.preJoinExcludedDays, 14);
    assert.equal(payroll.calendar.activeDaysInMonth, 17);
    assert.ok(payroll.attendance.absentDates.every(date => date >= "2026-07-15"));
    assert.ok(payroll.salary.payableDays <= 17);
  });
});

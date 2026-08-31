
import express from "express";
import { verifyToken, authorizeRoles } from "../middleware/auth.js";
import { pool } from "../middleware/db.js";

const router = express.Router();

/*
======================================================
ATTENDANCE STATUS SQL HELPERS
======================================================

Priority:

1. Approved Leave
2. Paid Leave / Unpaid Leave
3. Present / Working / Late
4. Half Day
5. Absent

IMPORTANT:
Approved leave always takes priority over attendance status.
*/


function approvedLeaveSql(leaveAlias = "l") {
  return `
    ${leaveAlias}.id IS NOT NULL
  `;
}


function livePresentSql(attendanceAlias = "a", leaveAlias = "l") {
  return `
    (
      ${leaveAlias}.id IS NULL
      AND
      (
        COALESCE(${attendanceAlias}.status, '') IN (
          'present',
          'full_day',
          'working',
          'in_progress',
          'late'
        )

        OR

        (
          ${attendanceAlias}.check_in_time IS NOT NULL

          AND COALESCE(${attendanceAlias}.status, '') NOT IN (
            'leave',
            'paid_leave',
            'unpaid_leave',
            'holiday',
            'absent',
            'half_day'
          )
        )
      )
    )
  `;
}


function liveHalfDaySql(attendanceAlias = "a", leaveAlias = "l") {
  return `
    (
      ${leaveAlias}.id IS NULL
      AND COALESCE(${attendanceAlias}.status, '') = 'half_day'
    )
  `;
}


function liveLeaveSql(attendanceAlias = "a", leaveAlias = "l") {
  return `
    (
      ${leaveAlias}.id IS NOT NULL

      OR

      (
        COALESCE(${attendanceAlias}.status, '') IN (
          'leave',
          'paid_leave',
          'unpaid_leave'
        )
      )
    )
  `;
}


function livePaidLeaveSql(attendanceAlias = "a", leaveAlias = "l") {
  return `
    (
      (
        ${leaveAlias}.id IS NOT NULL
        AND COALESCE(${leaveAlias}.leave_type, '') = 'paid_leave'
      )

      OR

      COALESCE(${attendanceAlias}.status, '') = 'paid_leave'

      OR

      COALESCE(${attendanceAlias}.leave_type, '') = 'paid_leave'
    )
  `;
}


function liveUnpaidLeaveSql(attendanceAlias = "a", leaveAlias = "l") {
  return `
    (
      (
        ${leaveAlias}.id IS NOT NULL
        AND COALESCE(${leaveAlias}.leave_type, '') = 'unpaid_leave'
      )

      OR

      COALESCE(${attendanceAlias}.status, '') = 'unpaid_leave'

      OR

      COALESCE(${attendanceAlias}.leave_type, '') = 'unpaid_leave'
    )
  `;
}


function liveAbsentSql(attendanceAlias = "a", leaveAlias = "l") {
  return `
    (
      ${leaveAlias}.id IS NULL

      AND

      (
        ${attendanceAlias}.user_id IS NULL
        OR COALESCE(${attendanceAlias}.status, '') = 'absent'
      )

      AND COALESCE(${attendanceAlias}.status, '') NOT IN (
        'leave',
        'paid_leave',
        'unpaid_leave',
        'holiday'
      )
    )
  `;
}


/*
======================================================
SUPER ADMIN DASHBOARD
======================================================
*/

router.get(
  "/admin-dashboard",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  (req, res) => {
    res.json({
      message: "Welcome Super Admin",
      stats: {
        employees: 240,
        managers: 12,
        departments: 8,
        payroll: "₹18,40,000",
      },
    });
  }
);


/*
======================================================
DASHBOARD SUMMARY

GET:

/api/dashboard/summary
?month=YYYY-MM
&branch=X
&today=YYYY-MM-DD
======================================================
*/

router.get(
  "/dashboard/summary",
  verifyToken,
  authorizeRoles(
    "SUPER_ADMIN",
    "OPERATIONAL_MANAGER",
    "MANAGER"
  ),

  async (req, res) => {
    try {

      const { month, branch, today } = req.query;

      if (!month || !today) {
        return res.status(400).json({
          message: "month and today required",
        });
      }


      /*
      ==================================================
      BRANCH ACCESS CONTROL
      ==================================================
      */

      const effectiveBranch =
        req.user.role === "MANAGER"
          ? req.user.branch
          : branch && branch !== "all"
          ? branch
          : null;


      /*
      ==================================================
      MONTH RANGE
      ==================================================
      */

      const [year, monthNumber] =
        month.split("-").map(Number);

      const monthStart = `${month}-01`;

      const lastDay =
        new Date(
          year,
          monthNumber,
          0
        ).getDate();

      const monthEnd =
        `${month}-${String(lastDay).padStart(2, "0")}`;


      /*
      ==================================================
      SAFE BRANCH FILTER
      ==================================================
      */

      const branchFilter = effectiveBranch
        ? `AND u.branch = '${effectiveBranch.replace(/'/g, "''")}'`
        : "";


      const deptBranchFilter = effectiveBranch
        ? `
          WHERE branch = 'All'
          OR branch = '${effectiveBranch.replace(/'/g, "''")}'
        `
        : "";


      /*
      ==================================================
      RUN ALL DASHBOARD QUERIES IN PARALLEL
      ==================================================
      */

      const [
        todayRows,
        monthKpi,
        leaveRows,
        deptRows,
        deptCountRows,
      ] = await Promise.all([


        /*
        ==================================================
        1. TODAY'S ATTENDANCE
        ==================================================

        IMPORTANT:

        Joins approved leave_requests.

        This prevents:

        Approved Paid Leave
        ↓
        No attendance record
        ↓
        Incorrectly counted as Absent ❌
        */

        pool.query(
          `
          SELECT

            /*
            -------------------------------
            PRESENT
            -------------------------------
            */

            COUNT(*) FILTER (
              WHERE ${livePresentSql("a", "l")}
            ) AS present,


            /*
            -------------------------------
            HALF DAY
            -------------------------------
            */

            COUNT(*) FILTER (
              WHERE ${liveHalfDaySql("a", "l")}
            ) AS half_day,


            /*
            -------------------------------
            ABSENT
            -------------------------------
            */

            COUNT(*) FILTER (
              WHERE ${liveAbsentSql("a", "l")}
            ) AS absent,


            /*
            -------------------------------
            ALL LEAVES
            -------------------------------
            */

            COUNT(*) FILTER (
              WHERE ${liveLeaveSql("a", "l")}
            ) AS leave,


            /*
            -------------------------------
            PAID LEAVE
            -------------------------------
            */

            COUNT(*) FILTER (
              WHERE ${livePaidLeaveSql("a", "l")}
            ) AS paid_leave,


            /*
            -------------------------------
            UNPAID LEAVE
            -------------------------------
            */

            COUNT(*) FILTER (
              WHERE ${liveUnpaidLeaveSql("a", "l")}
            ) AS unpaid_leave,


            /*
            -------------------------------
            LATE

            Late employee is also Present.
            -------------------------------
            */

            COUNT(*) FILTER (
              WHERE
                l.id IS NULL
                AND (
                  COALESCE(a.status, '') = 'late'

                  OR

                  (
                    a.check_in_time >= TIME '10:15:00'
                    AND a.check_in_time < TIME '10:30:00'
                  )
                )
            ) AS late,


            /*
            -------------------------------
            TOTAL ACTIVE EMPLOYEES
            -------------------------------
            */

            COUNT(u.id) AS total


          FROM users u


          /*
          -------------------------------
          ATTENDANCE
          -------------------------------
          */

          LEFT JOIN attendance_records a
            ON a.user_id = u.id
            AND a.date = $1


          /*
          -------------------------------
          APPROVED LEAVES

          Leave date range includes today.
          -------------------------------
          */

          LEFT JOIN leave_requests l
            ON l.user_id = u.id
            AND LOWER(l.status) = 'approved'
            AND $1::date
              BETWEEN l.from_date
              AND l.to_date


          WHERE
            u.role != 'SUPER_ADMIN'

            AND COALESCE(
              u.status,
              'active'
            ) = 'active'

          ${branchFilter}
          `,
          [today]
        ),


        /*
        ==================================================
        2. MONTH KPIs
        ==================================================
        */

        pool.query(
          `
          SELECT

            COUNT(DISTINCT user_id)
              AS total_employees,


            COALESCE(
              SUM(full_days + half_days),
              0
            ) AS total_present,


            COALESCE(
              SUM(late_days),
              0
            ) AS total_late,


            COALESCE(
              SUM(absent_days),
              0
            ) AS total_absent,


            COALESCE(
              SUM(break_exceeded_days),
              0
            ) AS total_exceeded,


            COALESCE(
              ROUND(AVG(avg_break_mins)),
              0
            ) AS avg_break


          FROM mv_monthly_attendance


          WHERE month_start = $1


          ${
            effectiveBranch
              ? `AND branch = $2`
              : ""
          }
          `,
          effectiveBranch
            ? [monthStart, effectiveBranch]
            : [monthStart]
        ),


        /*
        ==================================================
        3. PENDING LEAVE REQUESTS
        ==================================================
        */

        pool.query(
          `
          SELECT COUNT(*) AS pending

          FROM leave_requests l

          JOIN users u
            ON l.user_id = u.id

          WHERE
            LOWER(l.status) = 'pending'

            AND u.role != 'SUPER_ADMIN'

          ${branchFilter}
          `
        ),


        /*
        ==================================================
        4. DEPARTMENT ATTENDANCE
        ==================================================
        */

        pool.query(
          `
          SELECT

            u.department,


            COUNT(u.id) AS total,


            COUNT(*) FILTER (
              WHERE ${livePresentSql("a", "l")}
            ) AS present,


            COUNT(*) FILTER (
              WHERE ${liveHalfDaySql("a", "l")}
            ) AS half_day,


            COUNT(*) FILTER (
              WHERE ${liveAbsentSql("a", "l")}
            ) AS absent,


            COUNT(*) FILTER (
              WHERE ${liveLeaveSql("a", "l")}
            ) AS leave,


            COUNT(*) FILTER (
              WHERE ${livePaidLeaveSql("a", "l")}
            ) AS paid_leave,


            COUNT(*) FILTER (
              WHERE ${liveUnpaidLeaveSql("a", "l")}
            ) AS unpaid_leave


          FROM users u


          LEFT JOIN attendance_records a
            ON a.user_id = u.id
            AND a.date = $1


          LEFT JOIN leave_requests l
            ON l.user_id = u.id
            AND LOWER(l.status) = 'approved'
            AND $1::date
              BETWEEN l.from_date
              AND l.to_date


          WHERE
            u.role != 'SUPER_ADMIN'

            AND u.department IS NOT NULL

            AND COALESCE(
              u.status,
              'active'
            ) = 'active'

          ${branchFilter}


          GROUP BY u.department


          ORDER BY present DESC
          `,
          [today]
        ),


        /*
        ==================================================
        5. DEPARTMENT COUNT
        ==================================================
        */

        pool.query(
          `
          SELECT

            COUNT(*)::int AS total,


            COUNT(*) FILTER (
              WHERE status = 'active'
            )::int AS active


          FROM departments

          ${deptBranchFilter}
          `
        ),

      ]);


      /*
      ==================================================
      FORMAT RESPONSE
      ==================================================
      */

      const todayData =
        todayRows.rows[0] || {};


      res.json({

        /*
        ------------------------------------------
        TODAY
        ------------------------------------------
        */

        today: {
          present:
            Number(todayData.present || 0),

          half_day:
            Number(todayData.half_day || 0),

          absent:
            Number(todayData.absent || 0),

          leave:
            Number(todayData.leave || 0),

          paid_leave:
            Number(todayData.paid_leave || 0),

          unpaid_leave:
            Number(todayData.unpaid_leave || 0),

          late:
            Number(todayData.late || 0),

          total:
            Number(todayData.total || 0),
        },


        /*
        ------------------------------------------
        MONTH KPI
        ------------------------------------------
        */

        monthKpi:
          monthKpi.rows[0] || {},


        /*
        ------------------------------------------
        PENDING LEAVES
        ------------------------------------------
        */

        pendingLeaves:
          Number(
            leaveRows.rows[0]?.pending || 0
          ),


        /*
        ------------------------------------------
        DEPARTMENT COUNTS
        ------------------------------------------
        */

        departmentCount:
          Number(
            deptCountRows.rows[0]?.total || 0
          ),


        activeDepartmentCount:
          Number(
            deptCountRows.rows[0]?.active || 0
          ),


        /*
        ------------------------------------------
        DEPARTMENT BREAKDOWN
        ------------------------------------------
        */

        departments:
          deptRows.rows.map((row) => {

            const present =
              Number(row.present || 0);

            const halfDay =
              Number(row.half_day || 0);

            const absent =
              Number(row.absent || 0);

            const leave =
              Number(row.leave || 0);


            /*
            Attendance percentage:

            Present = 1
            Half Day = 0.5
            */

            const attendanceUnits =
              present + halfDay * 0.5;


            const availableWorkingPeople =
              present +
              halfDay +
              absent;


            return {

              name:
                row.department,

              total:
                Number(row.total || 0),

              present,

              half_day:
                halfDay,

              absent,

              leave,

              paid_leave:
                Number(
                  row.paid_leave || 0
                ),

              unpaid_leave:
                Number(
                  row.unpaid_leave || 0
                ),


              pct:
                availableWorkingPeople > 0
                  ? Math.round(
                      (
                        attendanceUnits /
                        availableWorkingPeople
                      ) * 100
                    )
                  : 0,

            };

          }),

      });

    } catch (err) {

      console.error(
        "dashboard/summary error:",
        err
      );


      res.status(500).json({
        message:
          err.message ||
          "Failed to load dashboard summary",
      });

    }

  }
);


/*
======================================================
MANAGER DASHBOARD
======================================================
*/

router.get(
  "/manager-dashboard",
  verifyToken,
  authorizeRoles("MANAGER"),
  (req, res) => {

    res.json({
      message: "Welcome Manager",

      stats: {
        teamMembers: 24,
        attendance: "96%",
        pendingLeaves: 4,
        tasks: 18,
      },
    });

  }
);


/*
======================================================
EMPLOYEE DASHBOARD
======================================================
*/

router.get(
  "/employee-dashboard",
  verifyToken,
  authorizeRoles("EMPLOYEE"),
  (req, res) => {

    res.json({
      message: "Welcome Employee",

      stats: {
        attendance: "98%",
        leaves: 10,
        salary: "₹45,000",
        tasks: 5,
      },
    });

  }
);


export default router;

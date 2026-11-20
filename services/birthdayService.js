import cron from "node-cron";
import { pool } from "../middleware/db.js";
import { sendLetterEmail } from "./emailService.js";

// Cron job runs every day at 12:00 AM (midnight)
const BIRTHDAY_CRON_SCHEDULE = "0 0 * * *";

let birthdayCronJob = null;

async function sendBirthdayWishes() {
  try {
    console.log("🎂 Checking for birthdays today...");

    const today = new Date();
    const month = today.getMonth() + 1; // JavaScript months are 0-indexed
    const day = today.getDate();

    // Find employees whose birthday is today
    const result = await pool.query(
      `SELECT 
        id, 
        full_name, 
        email, 
        date_of_birth,
        department,
        branch
       FROM users 
       WHERE EXTRACT(MONTH FROM date_of_birth) = $1 
         AND EXTRACT(DAY FROM date_of_birth) = $2
         AND status = 'active'
         AND email IS NOT NULL
         AND email != ''`,
      [month, day]
    );

    const birthdayEmployees = result.rows;

    if (birthdayEmployees.length === 0) {
      console.log("🎂 No birthdays today.");
      return;
    }

    console.log(`🎂 Found ${birthdayEmployees.length} birthday(s) today.`);

    // Send birthday email to each employee
    for (const employee of birthdayEmployees) {
      try {
        const age = today.getFullYear() - new Date(employee.date_of_birth).getFullYear();
        
        const subject = `🎂 Happy Birthday, ${employee.full_name}!`;
        const text = `Dear ${employee.full_name},

Wishing you a very Happy Birthday! 🎉🎂

On behalf of the entire VJC Overseas team, we want to take this moment to celebrate you today. May this special day bring you joy, happiness, and all the success you deserve.

We appreciate your hard work and dedication to the team. Here's to another year of achievements and wonderful memories!

Happy Birthday once again!

Best regards,
VJC Overseas Team
${employee.branch} - ${employee.department}`;

        await sendLetterEmail({
          to: employee.email,
          subject,
          text,
        });

        console.log(`✅ Birthday email sent to ${employee.full_name} (${employee.email})`);
      } catch (error) {
        console.error(`❌ Failed to send birthday email to ${employee.full_name}:`, error.message);
      }
    }

    console.log(`🎂 Birthday wishes completed for ${birthdayEmployees.length} employee(s).`);
  } catch (error) {
    console.error("❌ Error in birthday check:", error);
  }
}

export function startBirthdayScheduler() {
  if (birthdayCronJob) {
    console.log("⚠️ Birthday scheduler already running.");
    return;
  }

  console.log("🎂 Starting birthday scheduler...");
  console.log(`🎂 Schedule: Daily at 12:00 AM (${BIRTHDAY_CRON_SCHEDULE})`);

  // Run immediately on startup to check for today's birthdays
  sendBirthdayWishes();

  // Schedule daily check at 9:00 AM
  birthdayCronJob = cron.schedule(BIRTHDAY_CRON_SCHEDULE, () => {
    sendBirthdayWishes();
  });

  console.log("✅ Birthday scheduler started successfully.");
}

export function stopBirthdayScheduler() {
  if (birthdayCronJob) {
    birthdayCronJob.stop();
    birthdayCronJob = null;
    console.log("🎂 Birthday scheduler stopped.");
  }
}

// Export function to manually trigger birthday check (for testing)
export { sendBirthdayWishes };

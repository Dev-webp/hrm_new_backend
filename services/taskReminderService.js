import { pool } from "../middleware/db.js";
import cron from "node-cron";

// Configuration
const REMINDER_INTERVAL_MINUTES = 5; // Check every 5 minutes
const DEADLINE_REMINDER_HOURS = 1; // Remind 1 hour before deadline
const OVERDUE_ESCALATION_HOURS = [24, 48, 72]; // Escalate at 24h, 48h, 72h overdue

// Check and send reminders
async function checkAndSendReminders() {
  try {
    console.log("[Task Reminders] Checking for pending reminders...");
    
    // 1. Send deadline reminders (1 hour before ETA)
    await sendDeadlineReminders();
    
    // 2. Send overdue notifications
    await sendOverdueNotifications();
    
    // 3. Send escalations for long-overdue tasks
    await sendEscalations();
    
    console.log("[Task Reminders] Reminder check completed");
  } catch (error) {
    console.error("[Task Reminders] Error in reminder check:", error);
  }
}

// Send reminders 1 hour before deadline
async function sendDeadlineReminders() {
  const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
  const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
  
  const result = await pool.query(
    `SELECT 
      t.id, t.title, t.assignee_id, t.committed_eta,
      u.full_name, u.email
     FROM employee_tasks t
     JOIN users u ON t.assignee_id = u.id
     WHERE t.status NOT IN ('completed', 'overdue')
       AND t.committed_eta BETWEEN $1 AND $2
       AND NOT EXISTS (
         SELECT 1 FROM task_notifications tn 
         WHERE tn.task_id = t.id 
         AND tn.notification_type = 'deadline_reminder'
         AND tn.sent_at > NOW() - INTERVAL '1 hour'
       )`,
    [fiveMinutesFromNow, oneHourFromNow]
  );
  
  for (const task of result.rows) {
    await createNotification(task.id, task.assignee_id, 'deadline_reminder', {
      message: `Task "${task.title}" is due in 1 hour`,
      task_title: task.title,
      deadline: task.committed_eta
    });
    
    console.log(`[Task Reminders] Deadline reminder sent for task ${task.id} to user ${task.assignee_id}`);
  }
}

// Send overdue notifications
async function sendOverdueNotifications() {
  const result = await pool.query(
    `SELECT 
      t.id, t.title, t.assignee_id, t.committed_eta,
      u.full_name, u.email
     FROM employee_tasks t
     JOIN users u ON t.assignee_id = u.id
     WHERE t.committed_eta < NOW()
       AND t.status NOT IN ('completed', 'overdue')
       AND NOT EXISTS (
         SELECT 1 FROM task_notifications tn 
         WHERE tn.task_id = t.id 
         AND tn.notification_type = 'overdue'
         AND tn.sent_at > NOW() - INTERVAL '1 day'
       )`
  );
  
  for (const task of result.rows) {
    // Notify employee
    await createNotification(task.id, task.assignee_id, 'overdue', {
      message: `Task "${task.title}" is overdue`,
      task_title: task.title,
      deadline: task.committed_eta
    });
    
    // Mark task as overdue
    await pool.query(
      "UPDATE employee_tasks SET status = 'overdue', updated_at = NOW() WHERE id = $1",
      [task.id]
    );
    
    console.log(`[Task Reminders] Overdue notification sent for task ${task.id}`);
  }
}

// Send escalations for long-overdue tasks
async function sendEscalations() {
  for (const hours of OVERDUE_ESCALATION_HOURS) {
    const overdueSince = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    const result = await pool.query(
      `SELECT 
        t.id, t.title, t.assignee_id, t.committed_eta,
        u.full_name, u.email
       FROM employee_tasks t
       JOIN users u ON t.assignee_id = u.id
       WHERE t.committed_eta < $1
         AND t.status = 'overdue'
         AND NOT EXISTS (
           SELECT 1 FROM task_notifications tn 
           WHERE tn.task_id = t.id 
           AND tn.notification_type = 'escalation'
           AND tn.metadata->>'hours' = $2
         )`,
      [overdueSince, hours.toString()]
    );
    
    for (const task of result.rows) {
      // Log escalation for admin review
      await createNotification(task.id, task.assignee_id, 'escalation', {
        message: `Task "${task.title}" is ${hours} hours overdue - requires attention`,
        task_title: task.title,
        assignee: task.full_name,
        hours_overdue: hours,
        deadline: task.committed_eta
      });
      
      console.log(`[Task Reminders] Escalation sent for task ${task.id} (${hours}h overdue)`);
    }
  }
}

// Create notification record
async function createNotification(taskId, userId, notificationType, metadata) {
  await pool.query(
    `INSERT INTO task_notifications (task_id, user_id, notification_type, metadata, delivery_status)
     VALUES ($1, $2, $3, $4, 'sent')`,
    [taskId, userId, notificationType, JSON.stringify(metadata)]
  );
}

// Start the reminder scheduler
let reminderCronJob = null;

export function startTaskReminderScheduler() {
  if (reminderCronJob) {
    console.log("[Task Reminders] Scheduler already running");
    return;
  }
  
  console.log(`[Task Reminders] Starting scheduler (runs every ${REMINDER_INTERVAL_MINUTES} minutes)`);
  
  // Run immediately on start
  checkAndSendReminders();
  
  // Schedule to run every N minutes
  reminderCronJob = cron.schedule(`*/${REMINDER_INTERVAL_MINUTES} * * * *`, () => {
    checkAndSendReminders();
  });
  
  console.log("[Task Reminders] Scheduler started successfully");
}

// Stop the reminder scheduler
export function stopTaskReminderScheduler() {
  if (reminderCronJob) {
    reminderCronJob.stop();
    reminderCronJob = null;
    console.log("[Task Reminders] Scheduler stopped");
  }
}

// Manual trigger for testing
export async function triggerReminderCheck() {
  await checkAndSendReminders();
  return { message: "Reminder check completed" };
}

import { pool } from "../middleware/db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  try {
    console.log("🚀 Starting tasks schema migration...");
    
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, "../migrations/create_tasks_schema.sql");
    const migrationSQL = fs.readFileSync(migrationPath, "utf8");
    
    // Execute the migration
    await pool.query(migrationSQL);
    
    console.log("✅ Tasks schema migration completed successfully!");
    console.log("📊 Created tables:");
    console.log("   - employee_tasks");
    console.log("   - task_audit_history");
    console.log("   - task_comments");
    console.log("   - task_reminders");
    console.log("🔧 Created triggers and functions:");
    console.log("   - update_task_updated_at()");
    console.log("   - update_task_completed_at()");
    console.log("   - mark_overdue_tasks()");
    console.log("   - log_task_change()");
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

runMigration();

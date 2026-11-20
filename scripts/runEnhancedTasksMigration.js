import { pool } from "../middleware/db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  console.log("🚀 Starting enhanced tasks schema migration...");
  
  try {
    const migrationPath = path.join(__dirname, "../migrations/enhance_tasks_schema.sql");
    const sql = fs.readFileSync(migrationPath, "utf8");
    
    await pool.query(sql);
    
    console.log("✅ Enhanced tasks schema migration completed successfully!");
    console.log("📊 Added/Updated:");
    console.log("   - task_attachments table");
    console.log("   - task_deadline_history table");
    console.log("   - task_notifications table");
    console.log("   - Additional columns in employee_tasks");
    console.log("   - Enhanced audit logging triggers");
    
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();

// socketManager.js  (UPDATED — drop-in replacement for your existing file)
// Changes:
//   + exports getIO() for use in activityLogger.js
//   + tracks online users per branch
//   + emits "online_users" count on connect/disconnect
//   + listens for "fetch_activity_logs" event

import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { pool } from "./middleware/db.js";

let io;

// ── Online user registry: socketId → { userId, full_name, branch, role } ──────
const onlineUsers = new Map();

// ── Exported getter so activityLogger.js can emit without circular imports ────
export function getIO() {
  return io;
}

export function initSocket(server) {
  io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] },
    // Prevent memory leak from ping accumulation
    pingTimeout:  60000,
    pingInterval: 25000,
  });

  // ── Auth middleware ────────────────────────────────────────────────────────
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  // ── Connection ─────────────────────────────────────────────────────────────
  io.on("connection", (socket) => {
    const { role, branch, id: userId, full_name } = socket.user;

    // Join role & branch rooms
    socket.join(`role:${role}`);
    if (branch) socket.join(`branch:${branch}`);
    if (userId) socket.join(`user:${userId}`);

    // Track online
    onlineUsers.set(socket.id, { userId, full_name, branch, role });
    broadcastOnlineCount();

    console.log(`🔌 Connected: ${full_name} [${role}]`);

    // ── Fetch notifications (unchanged) ──────────────────────────────────────
    socket.on("fetch_notifications", async ({ limit = 100 } = {}) => {
      try {
        let query = `
          SELECT n.*, u.full_name as user_name, u.branch
          FROM notifications n
          LEFT JOIN users u ON n.user_id = u.id
          WHERE 1=1
        `;
        const params = [];
        let idx = 1;

        if (role === "MANAGER") {
          query += ` AND (n.target_role='MANAGER' OR n.target_role='BOTH') AND u.branch=$${idx}`;
          params.push(branch); idx++;
        } else if (role === "SUPER_ADMIN") {
          query += ` AND (n.target_role='SUPER_ADMIN' OR n.target_role='BOTH')`;
        } else if (role === "EMPLOYEE") {
          query += ` AND n.target_role='EMPLOYEE' AND n.user_id=$${idx}`;
          params.push(userId); idx++;
        }

        const countResult = await pool.query(
          `SELECT COUNT(*) AS count FROM (${query}) scoped_notifications WHERE is_read = false`,
          params
        );
        query += ` ORDER BY n.created_at DESC LIMIT $${idx}`;
        params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));

        const result = await pool.query(query, params);
        socket.emit("notifications_list", result.rows);
        socket.emit("unread_count", { count: Number(countResult.rows[0]?.count || 0) });
      } catch (err) {
        console.error("❌ fetch_notifications:", err);
      }
    });

    // ── Fetch recent activity logs (initial page load) ───────────────────────
    socket.on("fetch_activity_logs", async ({ limit = 50, branch: reqBranch } = {}) => {
      try {
        let query = `
          SELECT * FROM activity_logs
          WHERE 1=1
        `;
        const params = [];
        let idx = 1;

        if (role === "MANAGER") {
          // Managers see own branch + system-wide
          query += ` AND (branch=$${idx} OR branch='all')`;
          params.push(branch); idx++;
        } else if (reqBranch && reqBranch !== "all") {
          query += ` AND (branch=$${idx} OR branch='all')`;
          params.push(reqBranch); idx++;
        }

        query += ` ORDER BY timestamp DESC LIMIT $${idx}`;
        params.push(Math.min(Number(limit) || 50, 200));

        const result = await pool.query(query, params);
        socket.emit("activity_logs_list", result.rows);
      } catch (err) {
        console.error("❌ fetch_activity_logs:", err);
      }
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      onlineUsers.delete(socket.id);
      broadcastOnlineCount();
      console.log(`❌ Disconnected: ${full_name}`);
    });
  });

  console.log("✅ Socket.io initialized (activityLogs + onlineUsers)");
  return io;
}

// ── Broadcast online user counts to SUPER_ADMIN ──────────────────────────────
function broadcastOnlineCount() {
  if (!io) return;
  const users = [...onlineUsers.values()];
  const payload = {
    total: users.length,
    byBranch: users.reduce((acc, u) => {
      acc[u.branch ?? "all"] = (acc[u.branch ?? "all"] || 0) + 1;
      return acc;
    }, {}),
  };
  io.to("role:SUPER_ADMIN").emit("online_users", payload);
}

// ── Notification emitter (unchanged API) ─────────────────────────────────────
export async function emitNotification({
  userId, actionType, description, relatedId = null,
  targetRole = "SUPER_ADMIN", branch = null,
}) {
  try {
    const result = await pool.query(
      `INSERT INTO notifications (user_id,action_type,description,related_id,target_role)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [userId, actionType, description, relatedId, targetRole]
    );
    const notif = { ...result.rows[0], user_name: "", branch };

    if (targetRole === "SUPER_ADMIN" || targetRole === "BOTH") {
      io?.to("role:SUPER_ADMIN").emit("new_notification", notif);
    }
    if ((targetRole === "MANAGER" || targetRole === "BOTH") && branch) {
      io?.to(`branch:${branch}`).emit("new_notification", notif);
    }
    if (targetRole === "EMPLOYEE") {
      io?.to(`user:${userId}`).emit("new_notification", notif);
    }
  } catch (err) {
    console.error("❌ emitNotification error:", err);
  }
}

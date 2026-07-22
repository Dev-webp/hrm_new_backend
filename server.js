import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import http from "http";
import compression from "compression";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { verifyToken } from "./middleware/auth.js";
import { pool } from "./middleware/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, ".env"),
});

import authRoutes from "./routes/authRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import departmentRoutes from "./routes/departmentRoutes.js";
import branchRoutes from "./routes/branchRoutes.js";
import attendanceRoutes, { finalizeForgottenCheckoutsBeforeToday } from "./routes/attendanceRoutes.js";
import breaksRoutes from "./routes/breaksRoutes.js";
import payrollRoutes from "./routes/payrollRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import leaveRoutes from "./routes/leaveRoutes.js";
import managerRoutes from "./routes/managerRoutes.js";
import employeeSelfRoutes from "./routes/employeeSelfRoutes.js";
import employeeLeaveRoutes from "./routes/employeeLeaveRoutes.js";
import holidayRoutes from "./routes/holidays.js";
import analysisRoutes from "./routes/analysisRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import activityRoutes from "./routes/activityRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import offerLetterRoutes from "./routes/offerLetterRoutes.js";
import letterRoutes from "./routes/letterRoutes.js";
import { initSocket } from "./socketManager.js";

const app = express();
let httpServer;
let shuttingDown = false;

app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
app.use(helmet());

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true,
}));

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "2mb" }));

app.use((req, res, next) => {
  const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 90000);
  req.setTimeout(requestTimeoutMs);
  res.setTimeout(requestTimeoutMs, () => {
    if (!res.headersSent) {
      res.status(503).json({ message: "Request timed out" });
    }
  });
  next();
});

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on("finish", () => {
    if (res.statusCode >= 400) {
      console.error("[API_FAILED]", {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        userId: req.user?.id || null,
      });
    }
  });
  next();
});

app.get("/", (_req, res) => {
  res.send("HRMS Backend successfully connected and running");
});

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: "degraded",
      message: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.use("/uploads", verifyToken, express.static(path.join(__dirname, "uploads")));
app.use(compression({ threshold: 1024 }));

const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please slow down" },
});
app.use("/api/", apiLimiter);

app.use("/api", authRoutes);
app.use("/api", employeeRoutes);
app.use("/api", departmentRoutes);
app.use("/api", branchRoutes);
app.use("/api", attendanceRoutes);
app.use("/api", breaksRoutes);
app.use("/api", payrollRoutes);
app.use("/api", dashboardRoutes);
app.use("/api", leaveRoutes);
app.use("/api", managerRoutes);
app.use("/api", employeeSelfRoutes);
app.use("/api", employeeLeaveRoutes);
app.use("/api", holidayRoutes);
app.use("/api", analysisRoutes);
app.use("/api", notificationRoutes);
app.use("/api", profileRoutes);
app.use("/api/activity-logs", activityRoutes);
app.use("/api/offer-letters", offerLetterRoutes);
app.use("/api/letters", letterRoutes);

app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, _next) => {
  const status = err.statusCode || err.status || 500;
  console.error("[EXPRESS_ERROR]", {
    method: req.method,
    path: req.originalUrl,
    status,
    userId: req.user?.id || null,
    message: err.message,
    stack: err.stack,
  });

  if (res.headersSent) return;
  res.status(status).json({
    message: status >= 500 && process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message,
  });
});

httpServer = http.createServer(app);
httpServer.requestTimeout = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 95000);
httpServer.headersTimeout = Number(process.env.HTTP_HEADERS_TIMEOUT_MS || 100000);
httpServer.keepAliveTimeout = Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS || 65000);
initSocket(httpServer);

const forgottenCheckoutIntervalMs = Number(
  process.env.FORGOTTEN_CHECKOUT_INTERVAL_MS || 60 * 60 * 1000
);
let forgottenCheckoutJobRunning = false;
setInterval(async () => {
  if (forgottenCheckoutJobRunning) {
    console.warn("[FORGOTTEN_CHECKOUT_SKIPPED] Previous job is still running");
    return;
  }
  forgottenCheckoutJobRunning = true;
  try {
    await finalizeForgottenCheckoutsBeforeToday();
  } catch (err) {
    console.error("[FORGOTTEN_CHECKOUT_FAILED]", err);
  } finally {
    forgottenCheckoutJobRunning = false;
  }
}, forgottenCheckoutIntervalMs).unref?.();

setInterval(() => {
  const memory = process.memoryUsage();
  console.log("[PROCESS_MEMORY]", {
    rssMb: Math.round(memory.rss / 1024 / 1024),
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
    externalMb: Math.round(memory.external / 1024 / 1024),
    uptimeSec: Math.round(process.uptime()),
  });
}, Number(process.env.MEMORY_LOG_INTERVAL_MS || 5 * 60 * 1000)).unref?.();

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`[SERVER_READY] Server running on http://localhost:${PORT}`);
});

async function gracefulShutdown(reason, error = null) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error("[SHUTDOWN_START]", {
    reason,
    message: error?.message,
    stack: error?.stack,
  });

  const forceExitTimer = setTimeout(() => {
    console.error("[SHUTDOWN_FORCE_EXIT] Graceful shutdown timed out");
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS || 15000));
  forceExitTimer.unref?.();

  try {
    await new Promise((resolve) => {
      if (!httpServer?.listening) return resolve();
      httpServer.close((closeErr) => {
        if (closeErr) console.error("[HTTP_SERVER_CLOSE_FAILED]", closeErr);
        resolve();
      });
    });
    await pool.end();
    console.error("[SHUTDOWN_COMPLETE]");
    process.exit(error ? 1 : 0);
  } catch (shutdownErr) {
    console.error("[SHUTDOWN_FAILED]", shutdownErr);
    process.exit(1);
  }
}

process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT_EXCEPTION]", err);
  gracefulShutdown("uncaughtException", err);
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error("[UNHANDLED_REJECTION]", err);
  gracefulShutdown("unhandledRejection", err);
});

process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM");
});

process.on("SIGINT", () => {
  gracefulShutdown("SIGINT");
});

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import http from "http";
import compression from "compression";          // ✅ NEW
import rateLimit from "express-rate-limit";    // ✅ NEW

// ─────────────────────────────────────────────
// Load ENV
// ─────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, ".env"),
});

// ─────────────────────────────────────────────
// Route Imports
// ─────────────────────────────────────────────

import authRoutes from "./routes/authRoutes.js";
import employeeRoutes from "./routes/employeeRoutes.js";
import branchRoutes from "./routes/branchRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import breaksRoutes from "./routes/breaksRoutes.js";
import payrollRoutes from "./routes/payrollRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import leaveRoutes from "./routes/leaveRoutes.js";
import managerRoutes from "./routes/managerRoutes.js";
import employeeSelfRoutes from "./routes/employeeSelfRoutes.js";
import employeeLeaveRoutes from "./routes/employeeLeaveRoutes.js";
import holidayRoutes from "./routes/holidays.js";
import analysisRoutes from "./routes/analysisRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";   // ✅ NEW
import activityRoutes from "./routes/activityRoutes.js";


import offerLetterRoutes from "./routes/offerLetterRoutes.js";// ─────────────────────────────────────────────
// Socket Manager
// ─────────────────────────────────────────────

import { initSocket } from "./socketManager.js";

// ─────────────────────────────────────────────
// App Init
// ─────────────────────────────────────────────

const app = express();

// ─────────────────────────────────────────────
// Middleware (ORDER MATTERS!)
// ─────────────────────────────────────────────

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true
}));

app.use(express.json());
app.get("/", (req, res) => {
  res.send("✅ HRMS Backend successfully connected and running");
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Gzip compression – compress responses larger than 1KB
app.use(compression({ threshold: 1024 }));

// Rate limiting – prevents API abuse / runaway frontend polling
const apiLimiter = rateLimit({
  windowMs: 60_000,          // 1 minute
  max: 300,                  // max 300 requests per minute per IP
  standardHeaders: true,     // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,      // Disable `X-RateLimit-*` headers
  message: { message: "Too many requests, please slow down" }
});
app.use("/api/", apiLimiter);

// Static files (frontend)

// ─────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────


app.use("/api", authRoutes);
app.use("/api", employeeRoutes);
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
app.use("/api/activity-logs", activityRoutes);
app.use("/api/offer-letters", offerLetterRoutes);
// ─────────────────────────────────────────────
// Frontend Routes
// ─────────────────────────────────────────────



// ─────────────────────────────────────────────
// Create HTTP Server (required for Socket.IO)
// ─────────────────────────────────────────────

const httpServer = http.createServer(app);

// ─────────────────────────────────────────────
// Initialize Socket.IO
// ─────────────────────────────────────────────

initSocket(httpServer);

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────



const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server Running on ${PORT}`);
});
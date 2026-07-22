import express from "express";
import { verifyToken } from "../middleware/auth.js";
import controller from "../controllers/letterController.js";
const router = express.Router();
for (const [path, type] of [["offer", "OFFER"], ["experience", "EXPERIENCE_RELIEVING"]]) {
  router.get(`/${path}`, verifyToken, (req,res,next) => controller.get(type,req,res,next));
  router.post(`/${path}/preview`, verifyToken, (req,res,next) => controller.preview(type,req,res,next));
  router.post(`/${path}/generate`, verifyToken, (req,res,next) => controller.generate(type,req,res,next));
  router.post(`/${path}/download`, verifyToken, (req,res,next) => controller.download(type,req,res,next));
  router.post(`/${path}/send-email`, verifyToken, (req,res,next) => controller.sendEmail(type,req,res,next));
}
export default router;

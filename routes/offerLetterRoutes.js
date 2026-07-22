import express from "express";

import controller from "../controllers/offerLetterController.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

router.post("/", verifyToken, controller.create);

router.get("/", verifyToken, controller.getAll);

router.get("/:id/download", verifyToken, controller.downloadPdf);

router.get("/:id/preview", verifyToken, controller.preview);

router.post("/:id/send-email", verifyToken, controller.sendEmail);

router.put("/:id/accept", verifyToken, controller.acceptOffer);

router.get("/:id", verifyToken, controller.getById);

router.put("/:id", verifyToken, controller.update);

export default router;

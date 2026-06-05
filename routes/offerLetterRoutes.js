import express from "express";
import controller from "../controllers/offerLetterController.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

router.post("/", verifyToken, controller.create);
router.get("/", verifyToken, controller.getAll);

router.post("/:id/generate-pdf", verifyToken, controller.generatePdf);
router.get("/:id/download", verifyToken, controller.downloadPdf);

router.put("/:id/send", verifyToken, controller.sendOffer);
router.put("/:id/accept", verifyToken, controller.acceptOffer);

router.get("/:id", verifyToken, controller.getById);
export default router;
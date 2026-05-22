import express from "express";
import {
  getCapitalHistoryController,
  saveCapitalSnapshotController,
  saveCurrentCapitalSnapshotController,
} from "../controllers/capitalHistory.controller.js";

const router = express.Router();

router.get("/capital-history", getCapitalHistoryController);
router.post("/capital-history", saveCapitalSnapshotController);
router.post("/capital-history/current", saveCurrentCapitalSnapshotController);

export default router;

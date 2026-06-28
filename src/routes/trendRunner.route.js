import express from "express";
import {
  closePosition,
  deletePosition,
  getAssets,
  getCapital,
  getOpenBalances,
  getPositions,
  getSignals,
  ignoreSignal,
  openPositionFromSignal,
  refreshOpen,
  registerPushToken,
  scanClose,
  scanOpen,
  sendTestPush,
  seedAssets,
  updatePosition,
} from "../controllers/trendRunner.controller.js";

const router = express.Router();

router.post("/assets/seed", seedAssets);
router.get("/assets", getAssets);

router.get("/signals", getSignals);
router.post("/signals/:id/ignore", ignoreSignal);
router.post("/signals/:id/open", openPositionFromSignal);

router.get("/positions", getPositions);
router.put("/positions/:id", updatePosition);
router.put("/positions/:id/close", closePosition);
router.delete("/positions/:id", deletePosition);

router.post("/scan/open", scanOpen);
router.post("/scan/open/refresh", refreshOpen);
router.post("/scan/close", scanClose);

router.post("/push-token", registerPushToken);
router.post("/push-test", sendTestPush);
router.get("/capital", getCapital);
router.get("/balances/open", getOpenBalances);

export default router;

import express from "express";
import {
  createListenKey,
  keepAliveListenKey,
  getAllBalancesController,
  getFlexibleEarnOnlyController,
} from "../controllers/binance.controller.js";

const router = express.Router();

router.post("/create-listen-key", createListenKey);
router.put("/keep-alive-listen-key", keepAliveListenKey);
router.get("/balances", getAllBalancesController); // 👈 aquí agregamos
router.get("/earn/flexible", getFlexibleEarnOnlyController);

export default router;

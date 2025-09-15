import express from "express";
import {
  createListenKey,
  keepAliveListenKey,
  getAllBalancesController,
} from "../controllers/binance.controller.js";

const router = express.Router();

router.post("/create-listen-key", createListenKey);
router.put("/keep-alive-listen-key", keepAliveListenKey);
router.get("/balances", getAllBalancesController); // 👈 aquí agregamos

export default router;

// routes/configInfo.routes.js
import express from "express";
import {
  getAllConfigInfo,
  getConfigInfoById,
  createConfigInfo,
  updateConfigInfo,
  deleteConfigInfo,
  getConfigInfoByName,
  updateUsdtPrices,
} from "../controllers/configInfo.controller.js";

const router = express.Router();

router.get("/config-info", getAllConfigInfo);
router.put("/config-info/usdt/prices", updateUsdtPrices);
router.get("/config-info/:id", getConfigInfoById);
router.get("/config-info/name/:name", getConfigInfoByName);
router.post("/config-info", createConfigInfo);
router.put("/config-info/:id", updateConfigInfo);
router.delete("/config-info/:id", deleteConfigInfo);


export default router;

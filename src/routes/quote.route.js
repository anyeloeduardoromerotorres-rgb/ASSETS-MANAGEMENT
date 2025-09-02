import { Router } from "express";
import { createQuote } from "../controllers/quote.controller.js";

const router = Router();

// 📌 Crear un nuevo quote
router.post("/quote", createQuote);

export default router;

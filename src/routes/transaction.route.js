import express from "express";
import {
  createTransaction,
  closeTransaction,
  getTransactions,
  getTransactionById,
  deleteTransaction,
} from "../controllers/transaction.controller.js";

const router = express.Router();

// 📌 Crear nueva transacción (apertura)
router.post("/", createTransaction);

// 📌 Cerrar transacción existente
router.put("/:id/close", closeTransaction);

// 📌 Obtener todas las transacciones
router.get("/", getTransactions);

// 📌 Obtener transacción por ID
router.get("/:id", getTransactionById);

// 📌 Eliminar transacción
router.delete("/:id", deleteTransaction);

export default router;

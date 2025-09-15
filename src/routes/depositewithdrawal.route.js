import { Router } from "express";
import { 
  getDepositeWithdrawal,
  postDepositeWithdrawal,
  deleteDepositeWithdrawal,
  putDepositeWithdrawal,
  getAllDepositeWithdrawals // 👈 lo agregamos
} from "../controllers/depositewithdrawal.controller.js";

const router = Router();

// 👇 Nueva ruta para obtener TODAS las transacciones
router.get("/depositewithdrawal", getAllDepositeWithdrawals);

router.get("/depositewithdrawal/:id", getDepositeWithdrawal);
router.post("/depositewithdrawal", postDepositeWithdrawal);
router.delete("/depositewithdrawal/:id", deleteDepositeWithdrawal);
router.put("/depositewithdrawal/:id", putDepositeWithdrawal);

export default router;


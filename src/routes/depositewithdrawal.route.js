import { Router } from "express";
import { getDepositeWithdrawal, postDepositeWithdrawal, deleteDepositeWithdrawal, putDepositeWithdrawal } from "../controllers/depositewithdrawal.controller.js";

const router = Router();

router.get("/depositewithdrawal/:id", getDepositeWithdrawal);
router.post("/depositewithdrawal", postDepositeWithdrawal);
router.delete("/depositewithdrawal/:id", deleteDepositeWithdrawal);
router.put("/depositewithdrawal/:id", putDepositeWithdrawal);

export default router;

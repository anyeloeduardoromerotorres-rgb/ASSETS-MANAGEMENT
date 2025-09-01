import { Router } from "express";
import {getExchange, postExchange, deleteExchange, putExchange} from '../controllers/exchange.controller.js'

const router  = Router();

router.get('/exchange/:id', getExchange)
router.post('/exchange', postExchange)
router.delete('/exchange/:id', deleteExchange)
router.put('/exchange/:id', putExchange)



export default router 
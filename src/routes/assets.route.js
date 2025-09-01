import { Router } from "express";
import {getAssets, postAssets, deleteAssets, putAssets} from '../controllers/asset.controller.js'

const router  = Router();

router.get('/assets/:id', getAssets)
router.post('/assets', postAssets)
router.delete('/assets/:id', deleteAssets)
router.put('/assets/:id', putAssets)



export default router 
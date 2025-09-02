import { Router } from "express";
import {getAssets, createAsset, deleteAssets, putAssets} from '../controllers/asset.controller.js'

const router  = Router();

router.get('/assets/:id', getAssets)
router.post('/assets', createAsset)
router.delete('/assets/:id', deleteAssets)
router.put('/assets/:id', putAssets)



export default router 
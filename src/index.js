

import app from "./app.js"
import {connectdb} from './db.js'
import dotenv from "dotenv";
import cron from "node-cron";
import Asset from "./models/asset.model.js";
import { updateAssetCandles } from "./scripts/updateAssets.js";
dotenv.config(); 



connectdb();



const PORT = process.env.PORT || 3000;


app.get("/ping", (req, res) => {
  res.json({ message: "pong 🏓" });
});

// Iniciar servidor
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 Servidor escuchando en http://0.0.0.0:${PORT}`);
});





(async () => {
  const assets = await Asset.find();
  for (const asset of assets) {
    await updateAssetCandles(asset._id);
  }
})();

// Ejecutar todos los días a las 00:10 UTC (10 minutos después del cierre de la vela diaria)
cron.schedule("10 0 * * *", async () => {
  console.log("⏰ Actualizando velas diarias...");
  const assets = await Asset.find();
  for (const asset of assets) {
    await updateAssetCandles(asset._id);
  }
});




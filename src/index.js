import app from "./app.js";
import { connectdb } from "./db.js";
import dotenv from "dotenv";
import dns from "node:dns";
import cron from "node-cron";
import mongoose from "mongoose";
import Asset from "./models/asset.model.js";
import { updateAssetCandles } from "./scripts/updateAssets.js";

dotenv.config();

dns.setServers(["8.8.8.8", "1.1.1.1"]);

await connectdb();

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor escuchando en http://0.0.0.0:${PORT}`);
});

async function updateAllAssetCandles(reason) {
  try {
    console.log(`[candles] Iniciando actualizacion (${reason})...`);

    // Trae todos los assets configurados en MongoDB para actualizar sus velas.
    const assets = await Asset.find();
    console.log(`[candles] Assets encontrados: ${assets.length}`);

    // Si no hay assets, imprime informacion de diagnostico para confirmar
    // a que base de datos y coleccion esta conectado el servidor.
    if (assets.length === 0) {
      console.warn(
        `[candles] No hay documentos en ${mongoose.connection.name}.${Asset.collection.name}`
      );

      // Lista las colecciones disponibles y sus conteos para detectar rapido
      // si los datos estan en otra coleccion o si la app apunta a otra DB.
      const collections = await mongoose.connection.db.listCollections().toArray();
      const collectionCounts = await Promise.all(
        collections.map(async ({ name }) => ({
          name,
          count: await mongoose.connection.db.collection(name).countDocuments(),
        }))
      );
      console.warn("[candles] Conteos por coleccion:", collectionCounts);
    }

    // Actualiza cada asset uno por uno para evitar demasiadas llamadas externas
    // simultaneas y dejar logs claros por simbolo.
    for (const asset of assets) {
      console.log(`[candles] Actualizando ${asset.symbol} (${asset._id})...`);
      await updateAssetCandles(asset._id);
      console.log(`[candles] Finalizado ${asset.symbol}`);
    }

    console.log(`[candles] Actualizacion completada (${reason}).`);
  } catch (err) {
    // Evita que un fallo en la actualizacion detenga el servidor completo.
    console.error(`[candles] Error en actualizacion (${reason}):`, err.message);
  }
}

// Se ejecuta una vez cuando inicia el servidor.
updateAllAssetCandles("startup");

// Se ejecuta todos los dias a las 00:10 UTC, despues del cierre de la vela diaria.
cron.schedule("10 0 * * *", () => {
  updateAllAssetCandles("cron diario");
});

import Asset from "../models/asset.model.js";
import Exchange from "../models/exchange.model.js";
import CloseHistory from "../models/pairHistorical.model.js";
import { getCandlesWithStats } from "../scripts/fetchHistoricalMaxMin.js";
import { calculateSlope } from "../scripts/linearRegression.js";

export const getAssets = (req, res) => res.send("getAsset");

// 📌 Crear un nuevo Asset junto con su historial de cierres
export const createAsset = async (req, res) => {
  try {

    
    const { symbol, exchange, initialInvestment, type } = req.body;
    

    // 🔹 Validar exchange (buscar por nombre)
    const exchangeDoc = await Exchange.findOne({ name: exchange });
    if (!exchangeDoc) {
      return res.status(404).json({ error: "Exchange no encontrado" });
    }
    // 🔹 Obtener velas y estadísticas
    const { candles, high, low } = await getCandlesWithStats(symbol, 7, type);

    // 🔹 Crear Asset (sin base ni quote en el documento)
    const asset = new Asset({
      symbol,
      exchange: exchangeDoc._id, // 👈 guardamos el ObjectId
      initialInvestment,       
      maxPriceSevenYear: high,
      minPriceSevenYear: low,
      slope: null, // lo calculamos luego
      type
    });

    await asset.save();

    // 🔹 Guardar historial de cierres
    let closeHistory = new CloseHistory({
      symbol: asset._id,
      historicalData: [
        {
          timeFrame: "1d",
          candles: candles.map((c) => ({
            closeTime: new Date(c.closeTime),
            close: c.close,
          })),
        },
      ],
    });

    await closeHistory.save();

    // 👇 populate para mostrar el nombre del símbolo en lugar del ObjectId
    closeHistory = await closeHistory.populate("symbol", "symbol");

    // 🔹 Calcular pendiente y actualizar asset
    const slope = await calculateSlope(asset._id);
    asset.slope = slope;
    await asset.save();

    res.status(201).json({
      message: "✅ Asset, CloseHistory y slope creados con éxito",
      asset,
      closeHistory,
    });
  } catch (error) {
    console.error("❌ Error en createAsset:", error.message);
    res.status(500).json({ error: error.message });
  }
};

export const deleteAssets = (req, res) => res.send("deleteAsset");
export const putAssets = (req, res) => res.send("putAsset");

import Asset from "../models/asset.model.js";
import Exchange from "../models/exchange.model.js";
import CloseHistory from "../models/pairHistorical.model.js";
import { parseSymbol } from "../utils/parseSymbol.js";

// 🔹 Funciones que ya tienes en utils
import { getAllBalances } from "../scripts/fetchBalanceBinance.js";
import { getCandlesWithStats, getAllDailyCandles, getHighLowLastYears } from "../scripts/fetchHistoricalMaxMin.js";
import { calculateSlope } from "../scripts/linearRegression.js"; // 👈 importar función

export const getAssets = (req, res) => res.send('getAsset')
// 📌 Crear un nuevo Asset junto con su historial de cierres


export const createAsset = async (req, res) => {
  console.log('estoy aqui');
  try {
    const { symbol, exchange, initialInvestment } = req.body;

    // 🔹 Validar exchange
    const exchangeDoc = await Exchange.findOne({ name: exchange });
    if (!exchangeDoc) {
      return res.status(404).json({ error: "Exchange no encontrado" });
    }

    // 🔹 Separar base y quote
    const { base, quote } = await parseSymbol(symbol);

    // 🔹 Validar balances
    const balances = await getAllBalances();
    const balanceForSymbol = balances.find(b => b.asset === base);

    let currentBalance = 0;
    if (balanceForSymbol) {
      const parsed = parseFloat(balanceForSymbol.amount);
      currentBalance = isNaN(parsed) ? 0 : parsed;
    }

    // 🔹 Obtener velas y estadísticas
    const { candles, high, low } = await getCandlesWithStats(symbol);
        console.log('me gustaria estar aqui');


    // 🔹 Crear Asset (slope aún vacío)
    const asset = new Asset({
      symbol,
      base,
      quote,
      exchange: exchangeDoc._id,
      currentBalance,
      initialInvestment,
      maxPriceSevenYear: high,
      minPriceSevenYear: low,
      slope: null, // lo calculamos luego
    });

    await asset.save();

    // 🔹 Guardar historial de cierres
    const closeHistory = new CloseHistory({
      symbol: asset._id,
      historicalData: [
        {
          timeFrame: "1d",
          candles: candles.map(c => ({
            closeTime: new Date(c.closeTime),
            close: c.close,
          })),
        },
      ],
    });

    await closeHistory.save();

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
export const deleteAssets = (req, res) => res.send('deleteAsset')
export const putAssets = (req, res) => res.send('putAsset')

// {
//   "symbol": "BTCUSDT",
//   "exchange": "BINANCE",
//   "initialInvestment": { 
//     "USDT": 673.50,
//     "USD": 653.03,
//     "BTC": 0.00198856
//   }
// }
import Asset from "../models/asset.model.js";
import CloseHistory from "../models/pairHistorical.model.js";
import { getAllDailyCandles, getHighLowLastYears } from "../scripts/fetchHistoricalMaxMin.js";

export async function updateAssetCandles(assetId) {
  try {
    // 1️⃣ Traer el asset con su historial
    const asset = await Asset.findById(assetId);
    if (!asset) throw new Error("Asset no encontrado");

    const history = await CloseHistory.findOne({ symbol: assetId });
    if (!history) throw new Error("Historial no encontrado");

    // 2️⃣ Ver última fecha que tienes guardada
    const lastClose = history.historicalData[0]?.candles.at(-1)?.closeTime || null;

    // 3️⃣ Llamar a Binance desde la última fecha (o desde el inicio)
    const newCandles = await getAllDailyCandles(asset.symbol, lastClose);

    if (newCandles.length === 0) {
      console.log(`✅ No hay nuevas velas para ${asset.symbol}`);
      return;
    }

    // 4️⃣ Agregar nuevas velas al historial
    history.historicalData[0].candles.push(...newCandles);
    await history.save();

    // 5️⃣ Recalcular high/low últimos 7 años
    const { high, low } = getHighLowLastYears(history.historicalData[0].candles, 7);

    let updated = false;

    if (high > asset.maxPriceSevenYear) {
      asset.maxPriceSevenYear = high;
      updated = true;
    }

    // solo calcular low si hay más de 7 años de data
    const sevenYearsAgo = Date.now() - 7 * 365 * 24 * 60 * 60 * 1000;
    const oldestCandle = history.historicalData[0].candles[0].closeTime;

    if (oldestCandle.getTime() <= sevenYearsAgo && low < asset.minPriceSevenYear) {
      asset.minPriceSevenYear = low;
      updated = true;
    }

    if (updated) await asset.save();

    console.log(`🔄 ${asset.symbol} actualizado con nuevas velas`);

  } catch (err) {
    console.error("❌ Error en updateAssetCandles:", err.message);
  }
}

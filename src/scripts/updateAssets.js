// services/updateAssetCandles.js
import Asset from "../models/asset.model.js";
import CloseHistory from "../models/pairHistorical.model.js";
import { getAllDailyCandles, getHighLowLastYears } from "../scripts/fetchHistoricalMaxMin.js";
import { fetchUsdPenFullHistory } from "../utils/fetchUsdPenFullHistory.js";
import { calculateSlope } from "./linearRegression.js";
import { getStockHistory } from "../utils/fetchFromYahoo.js";

export async function updateAssetCandles(assetId) {
  try {
    // 1️⃣ Traer el asset con su historial
    const asset = await Asset.findById(assetId);
    if (!asset) throw new Error("Asset no encontrado");

    const history = await CloseHistory.findOne({ symbol: assetId });
    if (!history) throw new Error("Historial no encontrado");

    // 2️⃣ Ver última fecha que tienes guardada
    const lastClose = history.historicalData[0]?.candles.at(-1)?.closeTime || null;

    if (asset.symbol !== "USDTUSD") {
      if (!lastClose) {
        console.log(`⚠️ No hay velas guardadas aún para ${asset.symbol}, descargando todo...`);
      } else {
        // fecha de la última vela que deberíamos tener (ayer UTC)
        const todayUtc = new Date();
        const yesterdayUtc = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate() - 1));

        if (new Date(lastClose).getTime() >= yesterdayUtc.getTime()) {
          console.log(`✅ ${asset.symbol} ya está actualizado hasta la última vela diaria`);
          return;
        }
      }
    }

    let newCandles = [];

    // 3️⃣ Descargar nuevas velas según tipo
    if (asset.type === "fiat" && asset.symbol === "USDPEN") {
      // 🔹 USDPEN: exchangerate.host
      const startDate = lastClose ? new Date(lastClose) : undefined;
      const historyData = await fetchUsdPenFullHistory(startDate);

      newCandles = historyData.map(d => ({
        closeTime: d.closeTime,
        close: d.close,
        high: d.high,
        low: d.low,
      }));

      console.log(`📊 USDPEN: ${newCandles.length} velas nuevas`);
    } else if (asset.type === "crypto" && asset.exchange?.toString() === "68b36f95ea61fd89d70c8d98") {
      // 🔹 Criptos: Binance
      newCandles = await getAllDailyCandles(asset.symbol, lastClose);
      console.log(`📊 ${asset.symbol}: ${newCandles.length} velas nuevas desde Binance`);
    } else if (asset.type === "stock") {
      // 🔹 Stocks: Yahoo Finance
      const allCandles = await getStockHistory(asset.symbol);

      newCandles = lastClose
        ? allCandles.filter(c => new Date(c.closeTime) > new Date(lastClose))
        : allCandles;

      console.log(`📊 ${asset.symbol}: ${newCandles.length} velas nuevas desde Yahoo Finance`);
    } else if (asset.type === "fiat" && asset.symbol === "USDTUSD") {
      // 🔹 USDTUSD: lo dejamos fijo en 1
      console.log(`✅ ${asset.symbol}: es par estable, no requiere actualización de velas`);
      return;
    } else {
      console.log(`⚠️ ${asset.symbol}: tipo de asset no soportado`);
      return;
    }

    // 4️⃣ Guardar nuevas velas
    if (newCandles.length > 0) {
      history.historicalData[0].candles.push(...newCandles);
      await history.save();

      // 5️⃣ Recalcular high/low últimos 7 años
      const { high, low } = getHighLowLastYears(history.historicalData[0].candles, 7);

      let updated = false;

      if (high > asset.maxPriceSevenYear) {
        asset.maxPriceSevenYear = high;
        updated = true;
      }

      const sevenYearsAgo = Date.now() - 7 * 365 * 24 * 60 * 60 * 1000;
      const oldestCandle = history.historicalData[0].candles[0].closeTime;

      if (new Date(oldestCandle).getTime() <= sevenYearsAgo && low < asset.minPriceSevenYear) {
        asset.minPriceSevenYear = low;
        updated = true;
      }

      // 6️⃣ Recalcular slope anualizado
      try {
        const slope = await calculateSlope(asset._id);
        asset.slope = parseFloat(slope.toFixed(2)); // 🔹 redondeado a 2 decimales
        updated = true;
        console.log(`📈 ${asset.symbol}: slope actualizado a ${asset.slope}% anual`);
      } catch (err) {
        console.error(`❌ Error calculando slope para ${asset.symbol}:`, err.message);
      }

      if (updated) await asset.save();

      console.log(`🔄 ${asset.symbol} actualizado con ${newCandles.length} velas nuevas`);
    } else {
      console.log(`✅ No hay nuevas velas para ${asset.symbol}`);
    }
  } catch (err) {
    console.error("❌ Error en updateAssetCandles:", err.message);
  }
}



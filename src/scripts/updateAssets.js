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

    let upToDate = false;
    if (asset.symbol !== "USDTUSD") {
      if (!lastClose) {
        console.log(`⚠️ No hay velas guardadas aún para ${asset.symbol}, descargando todo...`);
      } else {
        const todayUtc = new Date();
        const yesterdayUtc = new Date(
          Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate() - 1)
        );

        if (new Date(lastClose).getTime() >= yesterdayUtc.getTime()) {
          console.log(`✅ ${asset.symbol} ya está actualizado hasta la última vela diaria`);
          upToDate = true;
        }
      }
    }

    let newCandles = [];
    let forceRecalculate = false;

    // 3️⃣ Descargar nuevas velas según tipo
    if (asset.type === "fiat" && asset.symbol === "USDPEN") {
      // 🔹 USDPEN: histórico diario desde Yahoo Finance
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
    } else if (asset.type === "commodity") {
      // 🔹 Commodities: Yahoo Finance (o símbolo equivalente)
      const allCandles = await getStockHistory(asset.symbol);

      newCandles = lastClose
        ? allCandles.filter(c => new Date(c.closeTime) > new Date(lastClose))
        : allCandles;

      console.log(`📊 ${asset.symbol}: ${newCandles.length} velas nuevas (commodity)`);
    } else if (asset.type === "fiat" && asset.symbol === "USDTUSD") {
      // 🔹 USDTUSD: las velas se alimentan desde la app (config info)
      console.log(
        `ℹ️ ${asset.symbol}: se utilizarán las velas existentes del historial para recalcular métricas`
      );
      upToDate = true;
      forceRecalculate = true;
    } else {
      console.log(`⚠️ ${asset.symbol}: tipo de asset no soportado`);
      return;
    }

    let savedCandles = false;

    // 4️⃣ Guardar nuevas velas
    if (newCandles.length > 0) {
      history.historicalData[0].candles.push(...newCandles);
      await history.save();
      savedCandles = true;
      console.log(`🔄 ${asset.symbol} actualizado con ${newCandles.length} velas nuevas`);
    } else {
      if (!upToDate) {
        console.log(`✅ No hay nuevas velas para ${asset.symbol}`);
      }
    }

    const allCandles = history.historicalData[0]?.candles ?? [];

    if (allCandles.length === 0) {
      console.warn(`⚠️ ${asset.symbol}: no se encontraron velas en historial para calcular high/low`);
      return;
    }

    // 5️⃣ Recalcular high/low últimos 7 años
    const { high, low } = getHighLowLastYears(allCandles, 7);

    let updated = false;

    if (high != null && (asset.maxPriceSevenYear == null || high > asset.maxPriceSevenYear)) {
      asset.maxPriceSevenYear = high;
      updated = true;
    }

    const rawOldest = allCandles[0]?.closeTime ?? null;
    const oldestCandle =
      rawOldest instanceof Date ? rawOldest : rawOldest ? new Date(rawOldest) : null;
    const sevenYearsAgo = Date.now() - 7 * 365 * 24 * 60 * 60 * 1000;
    const hasSevenYears = oldestCandle ? oldestCandle.getTime() <= sevenYearsAgo : false;

    if (
      low != null &&
      (asset.minPriceSevenYear == null || (hasSevenYears && low < asset.minPriceSevenYear))
    ) {
      asset.minPriceSevenYear = low;
      updated = true;
    }

    // 6️⃣ Recalcular slope anualizado cuando hay nuevas velas o no existe aún
    if (savedCandles || forceRecalculate || asset.slope == null) {
      try {
        const slope = await calculateSlope(asset._id);
        asset.slope = parseFloat(slope.toFixed(2)); // 🔹 redondeado a 2 decimales
        updated = true;
        console.log(`📈 ${asset.symbol}: slope actualizado a ${asset.slope}% anual`);
      } catch (err) {
        console.error(`❌ Error calculando slope para ${asset.symbol}:`, err.message);
      }
    }

    if (updated) {
      await asset.save();
    }
  } catch (err) {
    console.error("❌ Error en updateAssetCandles:", err.message);
  }
}

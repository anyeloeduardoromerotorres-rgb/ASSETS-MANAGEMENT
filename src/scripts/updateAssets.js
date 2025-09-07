import Asset from "../models/asset.model.js";
import CloseHistory from "../models/pairHistorical.model.js";
import { getAllDailyCandles, getHighLowLastYears } from "../scripts/fetchHistoricalMaxMin.js";
import { fetchUsdPenFullHistory } from "../utils/fetchUsdPenFullHistory.js";

export async function updateAssetCandles(assetId) {
  try {
    // 1️⃣ Traer el asset con su historial
    const asset = await Asset.findById(assetId);
    if (!asset) throw new Error("Asset no encontrado");

    const history = await CloseHistory.findOne({ symbol: assetId });
    if (!history) throw new Error("Historial no encontrado");

    // 2️⃣ Ver última fecha que tienes guardada
    const lastClose = history.historicalData[0]?.candles.at(-1)?.closeTime || null;

    if (asset.symbol !== "USDTUSD"){
      if (!lastClose) {
        console.log(`⚠️ No hay velas guardadas aún para ${asset.symbol}, descargando todo...`);
      } else {
        // 3️⃣ Calcular la fecha de la última vela diaria que deberíamos tener (ayer en UTC)
        const todayUtc = new Date();
        const yesterdayUtc = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate() - 1));

        if (new Date(lastClose).getTime() >= yesterdayUtc.getTime()) {
          console.log(`✅ ${asset.symbol} ya está actualizado hasta la última vela diaria`);
          return;
        }
      }
    }
    let newCandles = [];

    if (asset.symbol === "USDPEN") {
      // 🔹 Lógica especial para USDPEN (exchangerate.host)
      const historyData = await fetchUsdPenFullHistory();

      // convertir a formato velas
      const allCandles = historyData.map(d => ({
        closeTime: new Date(d.date),
        close: d.rate,
      }));

      if (!lastClose) {
        // primera vez: guardar todo
        newCandles = allCandles;
      } else {
        // solo añadir lo que falte después de lastClose
        newCandles = allCandles.filter(c => new Date(c.closeTime) > new Date(lastClose));
      }

      console.log(`📊 USDPEN: ${newCandles.length} velas nuevas desde exchangerate.host`);
    } else if (asset.exchange === "68b36f95ea61fd89d70c8d98"){
      // 🔹 Para otros pares (Binance)
      newCandles = await getAllDailyCandles(asset.symbol, lastClose);
      console.log(`📊 ${asset.symbol}: ${newCandles.length} velas nuevas desde Binance`);
    }

    if (newCandles.length === 0) {
      console.log(`✅ No hay nuevas velas para ${asset.symbol}`);
      return;
    }

    // 5️⃣ Agregar nuevas velas al historial
    history.historicalData[0].candles.push(...newCandles);
    await history.save();

    // 6️⃣ Recalcular high/low últimos 7 años
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

    if (updated) await asset.save();

    console.log(`🔄 ${asset.symbol} actualizado con ${newCandles.length} velas nuevas`);
  } catch (err) {
    console.error("❌ Error en updateAssetCandles:", err.message);
  }
}



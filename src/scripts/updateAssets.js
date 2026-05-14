// services/updateAssetCandles.js
import Asset from "../models/asset.model.js";
import CloseHistory from "../models/pairHistorical.model.js";
import { getHighLowLastYears } from "../scripts/fetchHistoricalMaxMin.js";
import { calculateSlope } from "./linearRegression.js";
import { checkAssetUpToDate } from "./checkAssetUpToDate.js";
import { fetchNewCandles } from "./fetchNewCandles.js";
import { saveCandles } from "./saveCandles.js";

export async function updateAssetCandles(assetId) {
  try {
    // 1️⃣ Traer el asset con su historial
    const asset = await Asset.findById(assetId);
    if (!asset) throw new Error("Asset no encontrado");

    const history = await CloseHistory.findOne({ symbol: assetId });
    if (!history) throw new Error("Historial no encontrado");

    // 2️⃣ Ver última fecha que tienes guardada
    const lastClose = history.historicalData[0]?.candles.at(-1)?.closeTime || null;

    // 🔍 Verificar si el asset ya está actualizado para evitar descargas innecesarias
    let upToDate = checkAssetUpToDate(asset, lastClose);

    let newCandles = [];
    let forceRecalculate = false;

    // 3️⃣ Descargar nuevas velas según tipo
    const fetchResult = await fetchNewCandles(asset.type, asset.symbol, lastClose, asset.exchange);
    newCandles = fetchResult.newCandles;
    // Nota: upToDate ya se verificó arriba, pero para USDTUSD se sobrescribe
    if (fetchResult.upToDate) upToDate = true;
    if (fetchResult.forceRecalculate) forceRecalculate = true;

    let savedCandles = false;

    // 4️⃣ Guardar nuevas velas
    savedCandles = await saveCandles(history, newCandles, asset.symbol, upToDate);

    // 🔄 Obtener todas las velas del historial (incluyendo las recién guardadas) para cálculos posteriores
    const allCandles = history.historicalData[0]?.candles ?? [];

    if (allCandles.length === 0) {
      console.warn(`⚠️ ${asset.symbol}: no se encontraron velas en historial para calcular high/low`);
      return;
    }

    // 5️⃣ Recalcular high/low últimos 7 años
    const { high, low, details } = getHighLowLastYears(allCandles, 7);

    let updated = false;

    if (high != null && asset.high !== high) {
      asset.high = high;
      updated = true;
    }

    if (low != null && asset.low !== low) {
      asset.low = low;
      updated = true;
    }

    if (details && JSON.stringify(asset.priceRangeSevenYearDetails) !== JSON.stringify(details)) {
      asset.priceRangeSevenYearDetails = details;
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

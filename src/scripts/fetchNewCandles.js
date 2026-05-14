import { getAllDailyCandles } from "../scripts/fetchHistoricalMaxMin.js";
import { fetchUsdPenFullHistory } from "../utils/fetchUsdPenFullHistory.js";
import { getStockHistory } from "../utils/fetchFromYahoo.js";

export async function fetchNewCandles(assetType, assetSymbol, lastClose, assetExchange) {
  let newCandles = [];
  let upToDate = false;
  let forceRecalculate = false;

  if (assetType === "fiat" && assetSymbol === "USDPEN") {
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
  } else if (assetType === "crypto" && assetExchange?.toString() === "68b36f95ea61fd89d70c8d98") {
    // 🔹 Criptos: Binance
    newCandles = await getAllDailyCandles(assetSymbol, lastClose);
    console.log(`📊 ${assetSymbol}: ${newCandles.length} velas nuevas desde Binance`);
  } else if (assetType === "stock") {
    // 🔹 Stocks: Yahoo Finance
    const allCandles = await getStockHistory(assetSymbol);

    newCandles = lastClose
      ? allCandles.filter(c => new Date(c.closeTime) > new Date(lastClose))
      : allCandles;

    console.log(`📊 ${assetSymbol}: ${newCandles.length} velas nuevas desde Yahoo Finance`);
  } else if (assetType === "commodity") {
    // 🔹 Commodities: Yahoo Finance (o símbolo equivalente)
    const allCandles = await getStockHistory(assetSymbol);

    newCandles = lastClose
      ? allCandles.filter(c => new Date(c.closeTime) > new Date(lastClose))
      : allCandles;

    console.log(`📊 ${assetSymbol}: ${newCandles.length} velas nuevas (commodity)`);
  } else if (assetType === "fiat" && assetSymbol === "USDTUSD") {
    // 🔹 USDTUSD: las velas se alimentan desde la app (config info)
    console.log(
      `ℹ️ ${assetSymbol}: se utilizarán las velas existentes del historial para recalcular métricas`
    );
    upToDate = true;
    forceRecalculate = true;
  } else {
    console.log(`⚠️ ${assetSymbol}: tipo de asset no soportado`);
    return { newCandles: [], upToDate: false, forceRecalculate: false };
  }

  return { newCandles, upToDate, forceRecalculate };
}
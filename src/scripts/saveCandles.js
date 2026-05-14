export async function saveCandles(history, newCandles, assetSymbol, upToDate) {
  let savedCandles = false;

  if (newCandles.length > 0) {
    history.historicalData[0].candles.push(...newCandles);
    await history.save();
    savedCandles = true;
    console.log(`🔄 ${assetSymbol} actualizado con ${newCandles.length} velas nuevas`);
  } else {
    if (!upToDate) {
      console.log(`✅ No hay nuevas velas para ${assetSymbol}`);
    }
  }

  return savedCandles;
}
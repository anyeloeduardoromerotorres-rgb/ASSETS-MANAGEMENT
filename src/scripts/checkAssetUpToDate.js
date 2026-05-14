export function checkAssetUpToDate(asset, lastClose) {
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

  return upToDate;
}

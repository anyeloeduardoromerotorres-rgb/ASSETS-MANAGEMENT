import axios from "axios";

const USDPEN_YAHOO_SYMBOL = "PEN=X";
const ONE_DAY_SECONDS = 24 * 60 * 60;

const toNumber = (value, fallback) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const buildYahooUrl = startDate => {
  const base = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    USDPEN_YAHOO_SYMBOL
  )}`;
  const interval = "1d";

  if (!startDate) {
    return `${base}?interval=${interval}&range=max`;
  }

  const fromDate = new Date(startDate);
  if (Number.isNaN(fromDate.getTime())) {
    return `${base}?interval=${interval}&range=max`;
  }

  // Avanzamos un día para evitar duplicar la última vela ya almacenada
  const period1 = Math.floor(fromDate.getTime() / 1000) + ONE_DAY_SECONDS;
  const period2 = Math.floor(Date.now() / 1000) + ONE_DAY_SECONDS;

  if (period1 >= period2) {
    return null;
  }

  return `${base}?interval=${interval}&period1=${period1}&period2=${period2}`;
};

/**
 * Trae el histórico diario USD→PEN usando Yahoo Finance.
 * Yahoo no requiere API key y provee datos desde 2005 aprox.
 *
 * @param {Date} [startDate] - fecha de la última vela conocida (se traerán días posteriores)
 * @returns {Promise<Array<{ closeTime: Date, close: number, high: number, low: number }>>}
 */
export async function fetchUsdPenFullHistory(startDate) {
  const url = buildYahooUrl(startDate);

  if (!url) {
    return [];
  }

  try {
    const res = await axios.get(url);
    const result = res.data?.chart?.result?.[0];

    if (!result || !Array.isArray(result.timestamp)) {
      console.warn("⚠️ Respuesta inesperada al obtener USD→PEN desde Yahoo Finance");
      return [];
    }

    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0] ?? {};
    const closes = quote.close ?? [];
    const highs = quote.high ?? [];
    const lows = quote.low ?? [];

    const candles = timestamps.map((ts, idx) => {
      const close = toNumber(closes[idx], NaN);
      if (!Number.isFinite(close)) return null;

      const high = toNumber(highs[idx], close);
      const low = toNumber(lows[idx], close);

      return {
        closeTime: new Date(ts * 1000),
        close,
        high,
        low,
      };
    });

    return candles.filter(Boolean).sort((a, b) => a.closeTime - b.closeTime);
  } catch (err) {
    console.error("❌ Error obteniendo histórico USD→PEN desde Yahoo Finance:", err.message);
    return [];
  }
}

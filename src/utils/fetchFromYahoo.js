import axios from "axios";

const toNumber = (value, fallback) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/**
 * Obtiene el histórico diario de un símbolo desde Yahoo Finance
 * @param {string} symbol - Ej: "^GSPC" para S&P 500, "AAPL" para Apple
 * @returns {Promise<Array<{closeTime: Date, close: number, high: number, low: number}>>}
 */
export async function getStockHistory(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=max`;

    const res = await axios.get(url);
    const result = res.data?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp)) {
      console.warn("⚠️ Respuesta inesperada al obtener histórico Yahoo para", symbol);
      return [];
    }

    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0] ?? {};
    const closes = quote.close ?? [];
    const highs = quote.high ?? [];
    const lows = quote.low ?? [];

    const history = timestamps
      .map((ts, idx) => {
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
      })
      .filter(Boolean)
      .sort((a, b) => a.closeTime - b.closeTime);

    return history;
  } catch (error) {
    console.error("❌ Error obteniendo datos desde Yahoo:", error.message);
    return [];
  }
}

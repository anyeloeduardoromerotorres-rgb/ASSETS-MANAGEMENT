import axios from "axios";

/**
 * Obtiene el histórico diario de un símbolo desde Yahoo Finance
 * @param {string} symbol - Ej: "^GSPC" para S&P 500, "AAPL" para Apple
 * @returns {Promise<Array<{closeTime: Date, close: number, high: number, low: number}>>}
 */
export async function getStockHistory(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=max`;

    const res = await axios.get(url);
    const result = res.data.chart.result[0];
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];

    const history = timestamps.map((t, i) => ({
      closeTime: new Date(t * 1000), // 👈 ahora es Date, como esperan tus otras funciones
      close: quotes.close[i],
      high: quotes.high[i],
      low: quotes.low[i],
    }));

    return history;
  } catch (error) {
    console.error("❌ Error obteniendo datos:", error.message);
    return [];
  }
}

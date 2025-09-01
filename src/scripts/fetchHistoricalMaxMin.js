// candlesService.js
import axios from "axios";
import { getBinanceBaseUrl } from "../utils/binance.utils.js";

// 1️⃣ Traer todas las velas diarias
export async function getAllDailyCandles(symbol) {
  const baseUrl = await getBinanceBaseUrl();
  const url = `${baseUrl}api/v3/klines`;

  const interval = "1d";
  const now = Date.now();
  const limit = 1000;
  let allCandles = [];
  let fetchStart = 0;

  while (true) {
    const response = await axios.get(url, {
      params: { symbol, interval, startTime: fetchStart, limit },
    });

    const candles = response.data.map(c => ({
      closeTime: new Date(c[6]),
      close: parseFloat(c[4]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
    }));

    if (candles.length === 0) break;

    allCandles = allCandles.concat(candles);

    fetchStart = candles[candles.length - 1].closeTime.getTime() + 1;
    if (fetchStart >= now) break;
  }

  return allCandles;
}

// 2️⃣ Calcular máximo y mínimo de los últimos X años
export function getHighLowLastYears(candles, years = 7) {
  const now = Date.now();
  const cutoff = now - years * 365 * 24 * 60 * 60 * 1000;

  const filtered = candles.filter(c => c.closeTime.getTime() >= cutoff);

  const high = Math.max(...filtered.map(c => c.high));
  const low = Math.min(...filtered.map(c => c.low));

  return { high, low };
}

// 3️⃣ Wrapper: devuelve todas las velas + high/low últimos X años
export async function getCandlesWithStats(symbol, years = 7) {
  const candles = await getAllDailyCandles(symbol);
  const { high, low } = getHighLowLastYears(candles, years);

  return {
    symbol,
    candles, // todas las velas (con closeTime, close, high, low)
    stats: {
      years,
      high,
      low,
    },
  };
}


//USO
// const data = await getCandlesWithStats("BTCUSDT", 7);

// console.log("Total velas:", data.candles.length);
// console.log("Máximo en 7 años:", data.stats.high);
// console.log("Mínimo en 7 años:", data.stats.low);

// // Ejemplo de acceso al precio de cierre y fecha de la primera vela
// console.log("Primera vela:", data.candles[0].closeTime, data.candles[0].close);
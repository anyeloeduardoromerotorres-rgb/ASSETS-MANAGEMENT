// candlesService.js
import axios from "axios";
import { getBinanceBaseUrl } from "../utils/binance.utils.js";
import { fetchUsdPenFullHistory } from "../utils/fetchUsdPenFullHistory.js";
import {getStockHistory} from '../utils/fetchFromYahoo.js'
 
// 1️⃣ Traer todas las velas diarias
export async function getAllDailyCandles(symbol, startTime = 0) {
  const baseUrl = await getBinanceBaseUrl();
  const url = `${baseUrl}api/v3/klines`;

  const interval = "1d";
  const now = Date.now();
  const limit = 1000;
  let allCandles = [];

  // 👇 Si es Date, conviértelo; si es null, usa 0
  let fetchStart = startTime instanceof Date 
    ? startTime.getTime() + 1 
    : (startTime || 0);

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

    // avanzar el puntero para la próxima página
    fetchStart = candles[candles.length - 1].closeTime.getTime() + 1;
    if (fetchStart >= now) break;
  }

  return allCandles;
}


// ✅ Función robusta: sirve tanto para velas diarias de cripto como para acciones con menos sesiones
export function getHighLowLastYears(candles, years = 7) {
  const now = Date.now();
  const cutoff = now - years * 365 * 24 * 60 * 60 * 1000;

  // Filtramos solo las velas desde la fecha de corte
  const filtered = candles.filter(c => c.closeTime.getTime() >= cutoff);

  if (filtered.length === 0) {
    return { high: null, low: null }; // No hay datos disponibles
  }

  let highs = filtered.map(c => (c.high ?? c.close)).filter(v => v != null && !Number.isNaN(v));
  let lows  = filtered.map(c => (c.low ?? c.close)).filter(v => v != null && !Number.isNaN(v));

  if (highs.length === 0) {
    highs = filtered.map(c => c.close).filter(v => v != null && !Number.isNaN(v));
  }

  if (lows.length === 0) {
    lows = filtered.map(c => c.close).filter(v => v != null && !Number.isNaN(v));
  }

  const high = highs.length ? Math.max(...highs) : null;
  const low  = lows.length ? Math.min(...lows) : null;

  return { high, low };
}


// 🔹 Wrapper: devuelve todas las velas + high/low últimos X años
export async function getCandlesWithStats(symbol, years, type) {
  let candles = [];

  if (symbol === "USDPEN") {
    // 👉 Usar exchangerate.host para este par
    candles = await fetchUsdPenFullHistory();
  } else if (type === "crypto"){
    // 👉 Usar Binance para el resto de pares
    candles = await getAllDailyCandles(symbol);
  } else if (type === "stock"){
    // 👉 Usar yahoo para stocks
    candles = await getStockHistory(symbol);
  }

  const { high, low } = getHighLowLastYears(candles, years);

  return {
    candles, // todas las velas (con closeTime, close, high, low)
    high,
    low,
  };
}


//USO
// const data = await getCandlesWithStats("BTCUSDT", 7);

// console.log("Total velas:", data.candles.length);
// console.log("Máximo en 7 años:", data.stats.high);
// console.log("Mínimo en 7 años:", data.stats.low);

// // Ejemplo de acceso al precio de cierre y fecha de la primera vela
// console.log("Primera vela:", data.candles[0].closeTime, data.candles[0].close);

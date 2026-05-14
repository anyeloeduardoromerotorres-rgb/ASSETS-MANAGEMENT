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
  // Fecha actual en milisegundos.
  const now = Date.now();

  // Fecha limite hacia atras. Por defecto toma 7 anios de 365 dias.
  const cutoff = now - years * 365 * 24 * 60 * 60 * 1000;
  const drawdownCutoff = now - 5 * 365 * 24 * 60 * 60 * 1000;

  // Nos quedamos solo con las velas cuya fecha de cierre cae dentro del rango.
  const filtered = candles.filter(c => c.closeTime.getTime() >= cutoff);
  const drawdownCandles = candles
    .filter(c => c.closeTime.getTime() >= drawdownCutoff)
    .sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime());

  if (filtered.length === 0) {
    // Si no hay datos en ese rango, devolvemos null para ambos valores.
    return { high: null, low: null };
  }

  // Para estas metricas usamos el precio de cierre guardado en closehistories.
  const highCandles = filtered
    .map(c => ({
      closeTime: c.closeTime,
      close: c.close,
      value: c.close,
    }))
    .filter(c => c.value != null && !Number.isNaN(c.value));

  // Math.max necesita al menos un valor. Si no hay valores validos, devolvemos null.
  const highCandle = highCandles.reduce(
    (max, candle) => (max == null || candle.value > max.value ? candle : max),
    null
  );
  const high = highCandle?.value ?? null;

  if (high == null) {
    return { high: null, low: null };
  }

  // Para el low ya no usamos el minimo directo.
  // Calculamos la mayor caida porcentual desde maximos dentro de los ultimos 5 anios.
  let runningHigh = null;
  let runningHighCandle = null;
  let maxDrawdownPercent = 0;
  let maxDrawdownMaxCandle = null;
  let maxDrawdownMinCandle = null;

  for (const candle of drawdownCandles) {
    const candleHigh = candle.close;
    const candleLow = candle.close;

    if (candleHigh == null || Number.isNaN(candleHigh)) {
      continue;
    }

    if (runningHigh == null || candleHigh > runningHigh) {
      runningHigh = candleHigh;
      runningHighCandle = candle;
    }

    if (runningHigh <= 0 || candleLow == null || Number.isNaN(candleLow)) {
      continue;
    }

    const drawdownPercent = (runningHigh - candleLow) / runningHigh;

    if (drawdownPercent > maxDrawdownPercent) {
      maxDrawdownPercent = drawdownPercent;
      maxDrawdownMaxCandle = runningHighCandle;
      maxDrawdownMinCandle = candle;
    }
  }

  // Aplicamos esa mayor caida al high calculado con la ventana principal.
  const low = high * (1 - maxDrawdownPercent);

  // Resultado final usado por el resto del backend para guardar o mostrar estadisticas.
  return {
    high,
    low,
    details: {
      high: {
        closeTime: highCandle.closeTime,
        close: highCandle.close,
      },
      lowCalculation: {
        max: maxDrawdownMaxCandle
          ? {
              closeTime: maxDrawdownMaxCandle.closeTime,
              close: maxDrawdownMaxCandle.close,
            }
          : null,
        min: maxDrawdownMinCandle
          ? {
              closeTime: maxDrawdownMinCandle.closeTime,
              close: maxDrawdownMinCandle.close,
            }
          : null,
        drawdownPercent: maxDrawdownPercent,
      },
    },
  };
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

  const { high, low, details } = getHighLowLastYears(candles, years);

  return {
    candles, // todas las velas (con closeTime, close, high, low)
    high,
    low,
    details,
  };
}


//USO
// const data = await getCandlesWithStats("BTCUSDT", 7);

// console.log("Total velas:", data.candles.length);
// console.log("Máximo en 7 años:", data.stats.high);
// console.log("Mínimo en 7 años:", data.stats.low);

// // Ejemplo de acceso al precio de cierre y fecha de la primera vela
// console.log("Primera vela:", data.candles[0].closeTime, data.candles[0].close);

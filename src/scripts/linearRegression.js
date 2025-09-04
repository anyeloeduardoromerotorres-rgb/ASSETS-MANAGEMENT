// services/linearRegression.js
import CloseHistory from "../models/pairHistorical.model.js";

/**
 * Calcula la pendiente (slope) de la recta ajustada por mínimos cuadrados
 * usando los precios de cierre de un activo.
 *
 * @param {String} symbolId - ID del asset (ObjectId en CloseHistory.symbol)
 * @returns {Number} pendiente de la regresión lineal
 */
export async function calculateSlope(symbolId) {
  // 1️⃣ Buscar historial en la base
  const history = await CloseHistory.findOne({ symbol: symbolId });
  if (!history) {
    throw new Error("Historial no encontrado para este symbol");
  }

  // 2️⃣ Tomar las velas diarias
  const candles = history.historicalData[0]?.candles || [];
  if (candles.length === 0) {
    throw new Error("No hay datos de velas para calcular pendiente");
  }

  // 3️⃣ Transformar datos en pares (x, y)
  // x será el índice de cada día, y el precio de cierre
  const x = candles.map((_, i) => i);
  const y = candles.map(c => c.close);

  const n = x.length;

  // 4️⃣ Calcular sumatorias
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);

  // 5️⃣ Fórmula de la pendiente en regresión lineal
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  return slope;
}

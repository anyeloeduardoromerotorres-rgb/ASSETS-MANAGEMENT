// services/linearRegression.js
import CloseHistory from "../models/pairHistorical.model.js";

/**
 * Calcula el rendimiento anualizado (en %) usando regresión lineal
 * sobre log(precio de cierre).
 *
 * @param {String} symbolId - ID del asset (ObjectId en CloseHistory.symbol)
 * @returns {Number} rendimiento anual en %
 */
export async function calculateSlope(symbolId) {
  // 1️⃣ Buscar historial en la base
  const history = await CloseHistory.findOne({ symbol: symbolId });
  if (!history) {
    throw new Error("Historial no encontrado para este symbol");
  }

  // 2️⃣ Tomar las velas
  const candles = history.historicalData[0]?.candles || [];
  if (candles.length === 0) {
    throw new Error("No hay datos de velas para calcular pendiente");
  }

  // 3️⃣ Base temporal: usar días reales desde la primera vela
  const start = new Date(candles[0].closeTime).getTime();
  const x = candles.map(c =>
    (new Date(c.closeTime).getTime() - start) / (1000 * 60 * 60 * 24) // días reales
  );
  const y = candles.map(c => Math.log(c.close));

  const n = x.length;

  // 4️⃣ Calcular sumatorias
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);

  // 5️⃣ Fórmula de la pendiente en regresión lineal (tasa continua por día)
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // 6️⃣ Convertir a % anual compuesto
  const annualizedReturn = (Math.exp(slope * 252) - 1) * 100;

  return annualizedReturn;
}



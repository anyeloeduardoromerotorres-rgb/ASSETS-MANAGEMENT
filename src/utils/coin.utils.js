import Coin from "../models/coin.model.js";

/**
 * Busca el id de CoinGecko a partir de un symbol (ej: "BTC" → "bitcoin")
 * @param {string} symbol - Símbolo de la moneda (ej: BTC, eth, usdt)
 * @returns {Promise<string|null>} id oficial de CoinGecko o null si no existe
 */
export async function getCoinGeckoId(symbol) {
  if (!symbol) {
    throw new Error("⚠️ No se proporcionó un símbolo.");
  }

  const coin = await Coin.findOne({ symbol: symbol.toLowerCase() });

  if (!coin) {
    throw new Error(`⚠️ Moneda con símbolo "${symbol}" no encontrada en la base de datos.`);
  }

  console.log("CoinGecko ID:", coin.id);
  return coin.id;
}


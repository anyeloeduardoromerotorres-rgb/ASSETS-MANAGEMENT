// spotBalance.js
import axios from "axios";
import { getBinanceBaseUrl, getBinanceHeaders, signQuery } from "../utils/binance.utils.js";

export async function getSpotBalances() {
  try {
    const baseUrl = await getBinanceBaseUrl();

    // firmamos la query sin repetir código
    const query = signQuery();
    const url = `${baseUrl}api/v3/account?${query}`;

    const response = await axios.get(url, { headers: getBinanceHeaders() });

    const balancesSpot = response.data.balances
      .filter(b => parseFloat(b.free) > 0)
      .filter(b => !b.asset.startsWith("LD"))
      .map(b => ({
        asset: b.asset,
        amount: parseFloat(b.free),
      }));
      
    return balancesSpot;
  } catch (error) {
    console.error("❌ Error en getSpotBalances:", error.message);
    return [];
  }
}

export async function getFlexibleEarnBalances() {
  try {
    const baseUrl = await getBinanceBaseUrl();

    const query = signQuery();
    const url = `${baseUrl}sapi/v1/simple-earn/flexible/position?${query}`;

    const response = await axios.get(url, { headers: getBinanceHeaders() });

    if (!response.data || !response.data.rows) {
      throw new Error("Respuesta inválida de Binance Earn Flexible");
    }

    const balanceEarn = response.data.rows
      .filter(b => parseFloat(b.totalAmount) > 0)
      .map(b => ({
        asset: b.asset,
        amount: parseFloat(b.totalAmount),
      }));

      
      return balanceEarn
  } catch (error) {
    console.error("❌ Error en getFlexibleEarnBalances:", error.message);
    return [];
  }
}

// 🔹 Funcion combinada
export async function getAllBalances() {
  try {
    const [spot, earn] = await Promise.all([
      getSpotBalances(),
      getFlexibleEarnBalances(),
    ]);

    // combinamos balances sumando por asset
    const balancesMap = new Map();

    [...spot, ...earn].forEach(b => {
      if (balancesMap.has(b.asset)) {
        balancesMap.set(b.asset, {
          asset: b.asset,
          amount: balancesMap.get(b.asset).amount + b.amount,
        });
      } else {
        balancesMap.set(b.asset, b);
      }
    });

    return Array.from(balancesMap.values());
  } catch (error) {
    console.error("❌ Error en getAllBalances:", error.message);
    return [];
  }
}




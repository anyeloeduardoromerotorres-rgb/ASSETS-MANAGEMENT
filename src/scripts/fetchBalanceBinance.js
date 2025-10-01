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

    // Paginación amplia para no perder assets (por defecto devuelve size=10)
    const rows = [];
    let current = 1;
    const size = 100; // Binance allowlist: 1-100
    while (true) {
      const query = signQuery({ current, size });
      const url = `${baseUrl}sapi/v1/simple-earn/flexible/position?${query}`;
      const response = await axios.get(url, { headers: getBinanceHeaders() });
      const pageRows = response?.data?.rows ?? [];
      rows.push(...pageRows);
      if (!pageRows.length || pageRows.length < size) break;
      current += 1;
    }

    const balanceEarn = rows
      .filter(b => parseFloat(b.totalAmount) > 0)
      .map(b => ({ asset: b.asset, amount: parseFloat(b.totalAmount) }));

    return balanceEarn;
  } catch (error) {
    if (error?.response?.status === 400) {
      console.info("ℹ️ Flexible Earn API devolvió 400 (sin posiciones o parámetros fuera de rango)");
    } else {
      console.error("❌ Error en getFlexibleEarnBalances:", error.message);
    }
    return [];
  }
}

export async function getLockedEarnBalances() {
  try {
    const baseUrl = await getBinanceBaseUrl();

    const rows = [];
    let current = 1;
    const size = 100; // Binance allowlist: 1-100
    while (true) {
      const query = signQuery({ current, size });
      const url = `${baseUrl}sapi/v1/simple-earn/locked/position?${query}`;
      const response = await axios.get(url, { headers: getBinanceHeaders() });
      const pageRows = response?.data?.rows ?? [];
      rows.push(...pageRows);
      if (!pageRows.length || pageRows.length < size) break;
      current += 1;
    }

    const balanceLocked = rows
      .filter(b => parseFloat(b.totalAmount) > 0)
      .map(b => ({ asset: b.asset, amount: parseFloat(b.totalAmount) }));

    return balanceLocked;
  } catch (error) {
    if (error?.response?.status === 400) {
      console.info("ℹ️ Locked Earn API devolvió 400 (sin posiciones o parámetros fuera de rango)");
    } else {
      console.error("❌ Error en getLockedEarnBalances:", error.message);
    }
    return [];
  }
}

// 🔹 Funcion combinada
export async function getAllBalances() {
  try {
    const [spot, earnFlexible, earnLocked] = await Promise.all([
      getSpotBalances(),
      getFlexibleEarnBalances(),
      getLockedEarnBalances(),
    ]);

    // combinamos balances sumando por asset
    const balancesMap = new Map();

    [...spot, ...earnFlexible, ...earnLocked].forEach(b => {
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

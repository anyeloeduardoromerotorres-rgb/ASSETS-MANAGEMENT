// controllers/binance.controller.js
import axios from "axios";
import { getBinanceBaseUrl, getBinanceHeaders } from "../utils/binance.utils.js";
import { getAllBalances, getFlexibleEarnBalances } from "../scripts/fetchBalanceBinance.js";
import ConfigInfo from "../models/configInfo.model.js";

export async function createListenKey(req, res) {
  try {
    const baseUrl = await getBinanceBaseUrl();

    const response = await axios.post(`${baseUrl}api/v3/userDataStream`, null, {
      headers: getBinanceHeaders(),
    });

    res.json({ listenKey: response.data.listenKey });
  } catch (error) {
    console.error("Error creando listenKey:", error.response?.data || error.message);
    res.status(500).json({ error: "No se pudo crear el listenKey" });
  }
}

// controllers/binance.controller.js (agregamos)
export async function keepAliveListenKey(req, res) {
  try {
    const { listenKey } = req.body;
    if (!listenKey) return res.status(400).json({ error: "listenKey es requerido" });

    const baseUrl = await getBinanceBaseUrl();

    await axios.put(`${baseUrl}api/v3/userDataStream?listenKey=${listenKey}`, null, {
      headers: getBinanceHeaders(),
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("Error manteniendo listenKey vivo:", error.response?.data || error.message);
    res.status(500).json({ error: "No se pudo renovar el listenKey" });
  }
}

// ✅ NO guarda nada en DB, solo hace request a Binance y responde
export async function getAllBalancesController(req, res) {
  try {
    // 1️⃣ Obtener balances combinados (spot + earn)
    const balances = await getAllBalances();

    // 2️⃣ Obtener documentos de configuración relevantes
    const configs = await ConfigInfo.find({
      name: { $in: ["lastPriceUsdtSell", "totalUSD", "totalPen"] },
    });

    // Convertir en objeto para fácil acceso
    const configMap = {};
    configs.forEach((doc) => (configMap[doc.name] = doc.total));

    const lastUsdtPrice = configMap["lastPriceUsdtSell"] ?? 1;
    const totalUSD = configMap["totalUSD"] ?? 0;
    const totalPEN = configMap["totalPen"] ?? 0;

    // 3️⃣ Obtener precios spot de Binance
    const pricesRes = await axios.get("https://api.binance.com/api/v3/ticker/price");
    const prices = {};
    pricesRes.data.forEach((p) => {
      prices[p.symbol] = parseFloat(p.price);
    });

    // 4️⃣ Enriquecer balances con total en USD
    const enrichedBalances = balances.map((b) => {
      const total = b.amount;
      let usdValue = 0;

      if (b.asset === "USDT") {
        usdValue = total * lastUsdtPrice;
      } else if (prices[`${b.asset}USDT`]) {
        usdValue = total * prices[`${b.asset}USDT`];
      } else if (prices[`${b.asset}BUSD`]) {
        usdValue = total * prices[`${b.asset}BUSD`];
      }

      return {
        asset: b.asset,
        total,
        usdValue,
      };
    });

    // 5️⃣ Devolver balances + totales globales
    res.json({
      balances: enrichedBalances,
      totals: {
        usd: totalUSD,
        pen: totalPEN,
      },
    });
  } catch (error) {
    console.error("❌ Error en getAllBalancesController:", error.message);
    res.status(500).json({ error: "No se pudo obtener balances de Binance" });
  }
}

// 🔎 Solo Flexible Earn (para diagnóstico)
export async function getFlexibleEarnOnlyController(req, res) {
  try {
    const rows = await getFlexibleEarnBalances();
    // rows ya viene como [{ asset, amount }], pero puede contener activos repetidos si Binance devuelve varias filas por asset.
    const map = new Map();
    for (const r of rows) {
      const prev = map.get(r.asset) || 0;
      map.set(r.asset, prev + (Number(r.amount) || 0));
    }
    const balances = Array.from(map.entries()).map(([asset, amount]) => ({ asset, amount }));
    res.json({
      source: "flexible",
      positionsCount: rows.length,
      assetsCount: balances.length,
      balances,
    });
  } catch (error) {
    console.error("❌ Error en getFlexibleEarnOnlyController:", error.message);
    res.status(500).json({ error: "No se pudo obtener Flexible Earn" });
  }
}

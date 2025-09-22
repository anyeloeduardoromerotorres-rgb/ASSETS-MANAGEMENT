// controllers/configInfo.controller.js
import ConfigInfo from "../models/configInfo.model.js";
import Asset from "../models/asset.model.js";
import CloseHistory from "../models/pairHistorical.model.js";

const toUtcMidnight = (value = new Date()) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const isSameDay = (a, b) => toUtcMidnight(new Date(a)).getTime() === toUtcMidnight(new Date(b)).getTime();

const updateConfigTotal = async (names, total) => {
  for (const name of names) {
    const updated = await ConfigInfo.findOneAndUpdate({ name }, { total }, { new: true });
    if (updated) return updated;
  }
  return null;
};

// ✅ Obtener todas las configuraciones
export async function getAllConfigInfo(req, res) {
  try {
    const configs = await ConfigInfo.find();
    res.json(configs);
  } catch (error) {
    console.error("❌ Error obteniendo ConfigInfo:", error.message);
    res.status(500).json({ error: "No se pudo obtener la configuración" });
  }
}

// ✅ Obtener una configuración por ID
export async function getConfigInfoById(req, res) {
  try {
    const { id } = req.params;
    const config = await ConfigInfo.findById(id);
    if (!config) return res.status(404).json({ error: "ConfigInfo no encontrada" });
    res.json(config);
  } catch (error) {
    console.error("❌ Error obteniendo ConfigInfo:", error.message);
    res.status(500).json({ error: "No se pudo obtener la configuración" });
  }
}

// ✅ Obtener configuración por name
export async function getConfigInfoByName(req, res) {
  try {
    const { name } = req.params;
    const config = await ConfigInfo.findOne({ name });
    if (!config) return res.status(404).json({ error: "ConfigInfo no encontrada" });
    res.json(config);
  } catch (error) {
    console.error("❌ Error obteniendo ConfigInfo por nombre:", error.message);
    res.status(500).json({ error: "No se pudo obtener la configuración" });
  }
}


// ✅ Crear nueva configuración
export async function createConfigInfo(req, res) {
  try {
    const { name, description, total } = req.body;
    const newConfig = await ConfigInfo.create({ name, description, total });
    res.status(201).json(newConfig);
  } catch (error) {
    console.error("❌ Error creando ConfigInfo:", error.message);
    res.status(500).json({ error: "No se pudo crear la configuración" });
  }
}

// ✅ Actualizar configuración
export async function updateConfigInfo(req, res) {
  try {
    const { id } = req.params;
    const updatedConfig = await ConfigInfo.findByIdAndUpdate(id, req.body, {
      new: true,
    });
    if (!updatedConfig) return res.status(404).json({ error: "ConfigInfo no encontrada" });
    res.json(updatedConfig);
  } catch (error) {
    console.error("❌ Error actualizando ConfigInfo:", error.message);
    res.status(500).json({ error: "No se pudo actualizar la configuración" });
  }
}

export async function updateUsdtPrices(req, res) {
  try {
    const rawBuy = Number(req.body?.buyPrice);
    const rawSell = Number(req.body?.sellPrice);

    if (!Number.isFinite(rawBuy) || !Number.isFinite(rawSell)) {
      return res.status(400).json({ error: "Valores inválidos para compra/venta USDT" });
    }

    const [buyConfig, sellConfig] = await Promise.all([
      updateConfigTotal(["PrecioCompraUSDT", "lastPriceUsdtBuy"], rawBuy),
      updateConfigTotal(["PrecioVentaUSDT", "lastPriceUsdtSell"], rawSell),
    ]);

    if (!buyConfig || !sellConfig) {
      return res.status(404).json({ error: "ConfigInfo de compra/venta USDT no encontrada" });
    }

    const usdtAsset = await Asset.findOne({ symbol: "USDTUSD" });
    if (!usdtAsset) {
      return res.status(404).json({ error: "Asset USDTUSD no encontrado" });
    }

    let closeHistory = await CloseHistory.findOne({ symbol: usdtAsset._id });

    if (!closeHistory) {
      closeHistory = new CloseHistory({
        symbol: usdtAsset._id,
        historicalData: [{ timeFrame: "1d", candles: [] }],
      });
    }

    let dailyHistory = closeHistory.historicalData.find(tf => tf.timeFrame === "1d");
    if (!dailyHistory) {
      dailyHistory = closeHistory.historicalData.create({ timeFrame: "1d", candles: [] });
      closeHistory.historicalData.push(dailyHistory);
    }

    const closeTime = toUtcMidnight();
    const average = (rawBuy + rawSell) / 2;

    const candleIndex = dailyHistory.candles.findIndex(c => isSameDay(c.closeTime, closeTime));
    if (candleIndex >= 0) {
      dailyHistory.candles[candleIndex].close = average;
      dailyHistory.candles[candleIndex].closeTime = closeTime;
    } else {
      dailyHistory.candles.push({ closeTime, close: average });
    }

    dailyHistory.candles.sort((a, b) => new Date(a.closeTime) - new Date(b.closeTime));

    await closeHistory.save();

    res.json({
      message: candleIndex >= 0 ? "Vela USDTUSD actualizada" : "Vela USDTUSD creada",
      buyConfig,
      sellConfig,
      candle: { closeTime, close: average },
    });
  } catch (error) {
    console.error("❌ Error actualizando precios USDT:", error.message);
    res.status(500).json({ error: "No se pudieron actualizar los precios USDT" });
  }
}

// ✅ Eliminar configuración
export async function deleteConfigInfo(req, res) {
  try {
    const { id } = req.params;
    const deleted = await ConfigInfo.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "ConfigInfo no encontrada" });
    res.json({ message: "ConfigInfo eliminada correctamente" });
  } catch (error) {
    console.error("❌ Error eliminando ConfigInfo:", error.message);
    res.status(500).json({ error: "No se pudo eliminar la configuración" });
  }
}

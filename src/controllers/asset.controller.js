import Asset from "../models/asset.model.js";
import Exchange from "../models/exchange.model.js";
import CloseHistory from "../models/pairHistorical.model.js";
import ConfigInfo from "../models/configInfo.model.js";
import { getCandlesWithStats } from "../scripts/fetchHistoricalMaxMin.js";
import { calculateSlope } from "../scripts/linearRegression.js";

// GET /assets
export const getAssets = async (req, res) => {
  try {
    const assets = await Asset.find(); // trae todos
    return res.status(200).json(assets); // devolvemos array directamente
  } catch (err) {
    console.error("❌ Error al traer assets:", err);
    res.status(500).json({ message: "Error al traer assets", error: err.message });
  }
};

// 📌 Crear un nuevo Asset junto con su historial de cierres
export const createAsset = async (req, res) => {
  try {
    const { symbol, exchange, initialInvestment, type, currentBalance } = req.body;

    const exchangeDoc = await Exchange.findOne({ name: exchange });
    if (!exchangeDoc) {
      return res.status(404).json({ error: "Exchange no encontrado" });
    }

    const parsedCurrentBalance = Number(currentBalance);
    if (!Number.isFinite(parsedCurrentBalance) || parsedCurrentBalance < 0) {
      return res.status(400).json({ error: "currentBalance inválido" });
    }

    const { candles, high, low } = await getCandlesWithStats(symbol, 7, type);

    const asset = new Asset({
      symbol,
      exchange: exchangeDoc._id,
      initialInvestment,
      maxPriceSevenYear: high,
      minPriceSevenYear: low,
      slope: null,
      totalCapitalWhenLastAdded: 200,
      type,
    });

    await asset.save();

    // 🔹 Guardar historial de cierres
    let closeHistory = new CloseHistory({
      symbol: asset._id,
      historicalData: [
        {
          timeFrame: "1d",
          candles: candles.map((c) => ({
            closeTime: new Date(c.closeTime),
            close: c.close,
          })),
        },
      ],
    });

    await closeHistory.save();

    // 👇 populate para mostrar el nombre del símbolo en lugar del ObjectId
    closeHistory = await closeHistory.populate("symbol", "symbol");

    // 🔹 Calcular pendiente y actualizar asset
    const slope = await calculateSlope(asset._id);
    asset.slope = slope;
    await asset.save();

    const nonFiatAssets = await Asset.find({ _id: { $ne: asset._id }, type: { $ne: "fiat" } });
    const totalOtherCapitals = nonFiatAssets.reduce(
      (sum, doc) => sum + (Number(doc.totalCapitalWhenLastAdded) || 0),
      0
    );

    const newAssetCapital = 200;
    const amountToSplit = parsedCurrentBalance - totalOtherCapitals;
    const divisor = nonFiatAssets.length;
    const adjustment = divisor > 0 ? (amountToSplit - newAssetCapital) / divisor : 0;

    await Promise.all(
      nonFiatAssets.map(async other => {
        const currentValue = Number(other.totalCapitalWhenLastAdded) || 0;
        other.totalCapitalWhenLastAdded = currentValue + adjustment;
        await other.save();
      })
    );

    await ConfigInfo.findOneAndUpdate(
      { name: "TotalUltimoActivoCreado" },
      { total: parsedCurrentBalance },
      { upsert: true, new: true }
    );

    res.status(201).json({
      message: "✅ Asset, CloseHistory y slope creados con éxito",
      asset,
      closeHistory,
    });
  } catch (error) {
    console.error("❌ Error en createAsset:", error.message);
    res.status(500).json({ error: error.message });
  }
};

export const deleteAssets = async (req, res) => {
  try {
    const { id } = req.params;

    const asset = await Asset.findById(id);
    if (!asset) {
      return res.status(404).json({ error: "Asset no encontrado" });
    }

    await CloseHistory.deleteMany({ symbol: asset._id });
    await asset.deleteOne();

    return res.json({ message: "Asset eliminado correctamente", assetId: id });
  } catch (error) {
    console.error("❌ Error eliminando asset:", error.message);
    return res.status(500).json({ error: "No se pudo eliminar el asset" });
  }
};

export const putAssets = async (req, res) => {
  try {
    const { id } = req.params;
    const asset = await Asset.findById(id);

    if (!asset) {
      return res.status(404).json({ error: "Asset no encontrado" });
    }

    let hasUpdates = false;

    if (Object.prototype.hasOwnProperty.call(req.body, "initialInvestment")) {
      const value = req.body.initialInvestment;

      if (value === null) {
        asset.initialInvestment = null;
        hasUpdates = true;
      } else if (typeof value === "number") {
        asset.initialInvestment = value;
        hasUpdates = true;
      } else if (typeof value === "string") {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          return res
            .status(400)
            .json({ error: "initialInvestment debe ser un número válido" });
        }
        asset.initialInvestment = parsed;
        hasUpdates = true;
      } else if (typeof value === "object") {
        asset.initialInvestment = value;
        asset.markModified("initialInvestment");
        hasUpdates = true;
      } else {
        return res
          .status(400)
          .json({ error: "initialInvestment debe ser un número u objeto" });
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "minPriceSevenYear")) {
      const value = req.body.minPriceSevenYear;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return res
          .status(400)
          .json({ error: "minPriceSevenYear debe ser un número válido mayor o igual a 0" });
      }
      asset.minPriceSevenYear = parsed;
      hasUpdates = true;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "maxPriceSevenYear")) {
      const value = req.body.maxPriceSevenYear;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res
          .status(400)
          .json({ error: "maxPriceSevenYear debe ser un número válido mayor a 0" });
      }
      asset.maxPriceSevenYear = parsed;
      hasUpdates = true;
    }

    if (
      asset.minPriceSevenYear != null &&
      asset.maxPriceSevenYear != null &&
      asset.minPriceSevenYear > asset.maxPriceSevenYear
    ) {
      return res
        .status(400)
        .json({ error: "minPriceSevenYear no puede ser mayor que maxPriceSevenYear" });
    }

    if (!hasUpdates) {
      return res
        .status(400)
        .json({ error: "No se proporcionaron campos válidos para actualizar" });
    }

    await asset.save();

    return res.json(asset);
  } catch (err) {
    console.error("❌ Error actualizando asset:", err.message);
    return res.status(500).json({ error: "No se pudo actualizar el asset" });
  }
};

import Asset from "../models/asset.model.js";
import Exchange from "../models/exchange.model.js";
import CloseHistory from "../models/pairHistorical.model.js";
import ConfigInfo from "../models/configInfo.model.js";
import { getCandlesWithStats } from "../scripts/fetchHistoricalMaxMin.js";
import { calculateSlope } from "../scripts/linearRegression.js";

const roundToEight = value => Number(Number(value).toFixed(8));
const CASH_LIKE_SYMBOLS = new Set(["SHV"]);

const isCashLikeSymbol = symbol =>
  CASH_LIKE_SYMBOLS.has(String(symbol ?? "").toUpperCase());

const calculateCapitalFromPercentage = (percentage, total) => {
  const parsedPercentage = Number(percentage);
  const parsedTotal = Number(total);

  if (
    !Number.isFinite(parsedPercentage) ||
    !Number.isFinite(parsedTotal) ||
    parsedPercentage < 0 ||
    parsedTotal <= 0
  ) {
    return 0;
  }

  return roundToEight((parsedTotal * parsedPercentage) / 100);
};

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
    const {
      symbol,
      exchange,
      initialInvestment,
      type,
      totalCapitalWhenLastAdded,
      allocationPercentage,
      assets: assetsAllocationPercentages = [],
    } = req.body;
    const normalizedSymbol = String(symbol ?? "").toUpperCase();
    const requiresAllocation = type !== "fiat" && !isCashLikeSymbol(normalizedSymbol);

    const exchangeDoc = await Exchange.findOne({ name: exchange });
    if (!exchangeDoc) {
      return res.status(404).json({ error: "Exchange no encontrado" });
    }

    const parsedTotalCapitalWhenLastAdded = Number(totalCapitalWhenLastAdded);
    if (!Number.isFinite(parsedTotalCapitalWhenLastAdded) || parsedTotalCapitalWhenLastAdded < 0) {
      return res.status(400).json({ error: "totalCapitalWhenLastAdded invalido" });
    }

    const parsedAllocationPercentage = Number(allocationPercentage);
    if (
      requiresAllocation &&
      (!Number.isFinite(parsedAllocationPercentage) ||
        parsedAllocationPercentage < 0 ||
        parsedAllocationPercentage > 100)
    ) {
      return res.status(400).json({ error: "allocationPercentage debe ser un numero entre 0 y 100" });
    }

    if (!Array.isArray(assetsAllocationPercentages)) {
      return res.status(400).json({ error: "assets debe ser un arreglo" });
    }

    const nonFiatAssets = (await Asset.find({ type: { $ne: "fiat" } })).filter(
      asset => !isCashLikeSymbol(asset.symbol)
    );
    const percentageByAssetId = new Map();
    const existingAssetIds = new Set(nonFiatAssets.map(asset => asset._id.toString()));

    for (const assetAllocation of assetsAllocationPercentages) {
      const assetId = assetAllocation?._id;
      const parsedPercentage = Number(assetAllocation?.allocationPercentage);

      if (!assetId) {
        return res.status(400).json({ error: "Cada asset debe incluir _id" });
      }

      if (!existingAssetIds.has(assetId.toString())) {
        return res.status(400).json({ error: "La lista contiene un asset invalido" });
      }

      if (!Number.isFinite(parsedPercentage) || parsedPercentage < 0 || parsedPercentage > 100) {
        return res.status(400).json({ error: "Cada porcentaje debe estar entre 0 y 100" });
      }

      percentageByAssetId.set(assetId.toString(), roundToEight(parsedPercentage));
    }

    for (const existingAsset of nonFiatAssets) {
      if (!percentageByAssetId.has(existingAsset._id.toString())) {
        return res.status(400).json({
          error: `Falta porcentaje para el activo ${existingAsset.symbol}`,
        });
      }
    }

    const existingPercentageTotal = Array.from(percentageByAssetId.values()).reduce(
      (sum, value) => sum + value,
      0
    );
    const percentageTotal = roundToEight(
      existingPercentageTotal + (requiresAllocation ? parsedAllocationPercentage : 0)
    );

    if (Math.abs(percentageTotal - 100) > 0.000001) {
      return res.status(400).json({ error: "La suma de porcentajes debe ser 100" });
    }

    const { candles, high, low, details } = await getCandlesWithStats(symbol, 7, type);

    const newAssetAllocationPercentage =
      requiresAllocation ? roundToEight(parsedAllocationPercentage) : 0;
    const newAssetTotalCapitalWhenLastAdded =
      requiresAllocation
        ? calculateCapitalFromPercentage(
            newAssetAllocationPercentage,
            parsedTotalCapitalWhenLastAdded
          )
        : 0;

    const asset = new Asset({
      symbol,
      exchange: exchangeDoc._id,
      initialInvestment,
      high,
      low,
      priceRangeSevenYearDetails: details,
      slope: null,
      type,
    });

    if (type !== "fiat") {
      asset.allocationPercentage = newAssetAllocationPercentage;
      asset.totalCapitalWhenLastAdded = newAssetTotalCapitalWhenLastAdded;
    }

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

    await Promise.all(
      nonFiatAssets.map(async other => {
        const updatedPercentage = percentageByAssetId.get(other._id.toString());
        other.allocationPercentage = updatedPercentage;
        other.totalCapitalWhenLastAdded = calculateCapitalFromPercentage(
          updatedPercentage,
          parsedTotalCapitalWhenLastAdded
        );
        await other.save();
      })
    );

    if (requiresAllocation) {
      await ConfigInfo.findOneAndUpdate(
        { name: "TotalUltimoActivoCreado" },
        { total: parsedTotalCapitalWhenLastAdded },
        { upsert: true, new: true }
      );
    }

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

    if (Object.prototype.hasOwnProperty.call(req.body, "low")) {
      const value = req.body.low;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return res
          .status(400)
          .json({ error: "low debe ser un numero valido mayor o igual a 0" });
      }
      asset.low = parsed;
      hasUpdates = true;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "high")) {
      const value = req.body.high;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return res
          .status(400)
          .json({ error: "high debe ser un numero valido mayor a 0" });
      }
      asset.high = parsed;
      hasUpdates = true;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "allocationPercentage")) {
      if (asset.type === "fiat" || isCashLikeSymbol(asset.symbol)) {
        return res
          .status(400)
          .json({ error: "allocationPercentage no aplica para assets fiat o cash-like" });
      }

      const value = req.body.allocationPercentage;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        return res
          .status(400)
          .json({ error: "allocationPercentage debe ser un numero entre 0 y 100" });
      }
      asset.allocationPercentage = Number(parsed.toFixed(8));
      hasUpdates = true;
    }

    if (
      asset.low != null &&
      asset.high != null &&
      asset.low > asset.high
    ) {
      return res
        .status(400)
        .json({ error: "low no puede ser mayor que high" });
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


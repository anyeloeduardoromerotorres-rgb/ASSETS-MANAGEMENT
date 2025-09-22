import Transaction from "../models/transaction.model.js";
import Asset from "../models/asset.model.js";
import ConfigInfo from "../models/configInfo.model.js";

const KNOWN_QUOTES = ["USDT", "USDC", "BUSD", "BTC", "ETH", "USD", "PEN"];

const splitSymbol = symbol => {
  if (typeof symbol !== "string" || symbol.length === 0) {
    return { baseAsset: symbol ?? "", quoteAsset: "USD" };
  }

  for (const quote of KNOWN_QUOTES) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return {
        baseAsset: symbol.slice(0, symbol.length - quote.length),
        quoteAsset: quote,
      };
    }
  }

  return { baseAsset: symbol, quoteAsset: "USD" };
};

const extractHoldingAmount = initialInvestment => {
  if (initialInvestment == null) return 0;
  if (typeof initialInvestment === "number") return initialInvestment;
  if (typeof initialInvestment === "object") {
    if (typeof initialInvestment.amount === "number") return initialInvestment.amount;
    if (typeof initialInvestment.USD === "number") return initialInvestment.USD;
  }
  return 0;
};

const applyHoldingAmount = (initialInvestment, amount) => {
  const rounded = Number(amount.toFixed(8));
  if (initialInvestment == null) {
    return { amount: rounded };
  }
  if (typeof initialInvestment === "number") {
    return rounded;
  }
  if (typeof initialInvestment === "object") {
    return { ...initialInvestment, amount: rounded };
  }
  return { amount: rounded };
};

const adjustConfigTotal = async (names, delta) => {
  if (!Number.isFinite(delta) || delta === 0) return null;
  const doc = await ConfigInfo.findOne({ name: { $in: names } });
  if (!doc) return null;
  const updatedTotal = Number((doc.total + delta).toFixed(8));
  doc.total = updatedTotal;
  await doc.save();
  return doc;
};

/**
 * Helper: calcula profit % y total en fiat
 */
function calculateProfit(transaction) {
  if (
    transaction.closeValueFiat != null &&
    transaction.openValueFiat != null
  ) {
    const grossProfit = transaction.closeValueFiat - transaction.openValueFiat;
    const totalFees = (transaction.openFee || 0) + (transaction.closeFee || 0);
    const netProfit = grossProfit - totalFees;

    transaction.profitTotalFiat = netProfit;
    transaction.profitPercent =
      (netProfit / transaction.openValueFiat) * 100;
  }
}

/**
 * Crear nueva transacción (abrir posición)
 */
export async function createTransaction(req, res) {
  try {
    const {
      asset,
      type = "long",
      fiatCurrency = "USDT",
      openDate,
      openPrice,
      amount,
      quantity,
      openValueFiat,
      openFee,
    } = req.body;

    const normalizedAmount = amount ?? quantity;
    const parsedPrice = Number(openPrice);
    const parsedAmount = Number(normalizedAmount);
    const parsedOpenValue = Number(openValueFiat);
    const parsedFee = Number(openFee ?? 0) || 0;
    const openDateValue = openDate ? new Date(openDate) : new Date();
    const normalizedFiatCurrency =
      typeof fiatCurrency === "string" && fiatCurrency.trim().length > 0
        ? fiatCurrency.trim().toUpperCase()
        : "USDT";
    const normalizedType =
      typeof type === "string" && type.toLowerCase() === "short" ? "short" : "long";

    if (
      !asset ||
      !Number.isFinite(parsedPrice) ||
      parsedPrice <= 0 ||
      !Number.isFinite(parsedAmount) ||
      parsedAmount <= 0 ||
      !Number.isFinite(parsedOpenValue) ||
      parsedOpenValue <= 0 ||
      Number.isNaN(openDateValue.getTime())
    ) {
      return res.status(400).json({
        error:
          "Faltan datos obligatorios o contienen valores inválidos: asset, type, fiatCurrency, openDate, openPrice, amount, openValueFiat",
      });
    }

    const tx = new Transaction({
      asset,
      type: normalizedType,
      fiatCurrency: normalizedFiatCurrency,
      openDate: openDateValue,
      openPrice: parsedPrice,
      amount: parsedAmount,
      openValueFiat: parsedOpenValue,
      openFee: parsedFee,
      status: "open",
    });

    await tx.save();

    try {
      const assetDoc = await Asset.findById(asset);

      if (assetDoc) {
        const { baseAsset, quoteAsset } = splitSymbol(assetDoc.symbol);
        const isLong = normalizedType === "long";
        const baseDelta = isLong ? parsedAmount : -parsedAmount;
        const quoteDelta = isLong ? -parsedOpenValue : parsedOpenValue;

        const baseAssetUpper = (baseAsset || "").toUpperCase();
        const quoteAssetUpper = (quoteAsset || "").toUpperCase();

        if (baseAssetUpper === "USD") {
          await adjustConfigTotal(["totalUSD"], baseDelta);
        } else if (baseAssetUpper === "PEN") {
          await adjustConfigTotal(["totalPen", "totalPEN"], baseDelta);
        } else if (assetDoc.type === "stock" || baseAssetUpper === assetDoc.symbol) {
          const currentAmount = extractHoldingAmount(assetDoc.initialInvestment);
          const newAmount = Math.max(0, currentAmount + baseDelta);
          assetDoc.initialInvestment = applyHoldingAmount(assetDoc.initialInvestment, newAmount);
          await assetDoc.save();
        }

        if (quoteAssetUpper === "USD") {
          await adjustConfigTotal(["totalUSD"], quoteDelta);
        } else if (quoteAssetUpper === "PEN") {
          await adjustConfigTotal(["totalPen", "totalPEN"], quoteDelta);
        }
      }
    } catch (adjustErr) {
      console.error("❌ Error actualizando balances tras la transacción:", adjustErr.message);
    }

    res.status(201).json(tx);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}


/**
 * Cerrar transacción existente
 */
export async function closeTransaction(req, res) {
  try {
    const { id } = req.params;
    const tx = await Transaction.findById(id);
    if (!tx) return res.status(404).json({ error: "Transacción no encontrada" });

    if (tx.status === "closed")
      return res.status(400).json({ error: "La transacción ya está cerrada" });

    // Actualizar datos de cierre
    const closeDateValue = req.body.closeDate ? new Date(req.body.closeDate) : new Date();
    const closePrice = Number(req.body.closePrice);
    const closeValueFiat = Number(req.body.closeValueFiat);
    const closeFee = Number(req.body.closeFee ?? 0) || 0;

    if (
      !Number.isFinite(closePrice) ||
      closePrice <= 0 ||
      !Number.isFinite(closeValueFiat) ||
      closeValueFiat <= 0
    ) {
      return res.status(400).json({
        error: "closePrice y closeValueFiat deben ser números válidos",
      });
    }

    tx.closeDate = closeDateValue;
    tx.closePrice = closePrice;
    tx.closeValueFiat = closeValueFiat;
    tx.closeFee = closeFee;

    tx.status = "closed";

    // Calcular profit
    calculateProfit(tx);

    await tx.save();

    try {
      const assetDoc = await Asset.findById(tx.asset);

      if (assetDoc) {
        const { baseAsset, quoteAsset } = splitSymbol(assetDoc.symbol);
        const baseAssetUpper = baseAsset?.toUpperCase?.() ?? baseAsset;
        const quoteAssetUpper = quoteAsset?.toUpperCase?.() ?? quoteAsset;
        const tradeAmount = tx.amount;
        const netQuote = closeValueFiat;

        let baseDelta = 0;
        let quoteDelta = 0;

        if (tx.type === "long") {
          baseDelta = -tradeAmount;
          quoteDelta = netQuote;
        } else {
          baseDelta = tradeAmount;
          quoteDelta = -netQuote;
        }

        if (baseAssetUpper === "USD") {
          await adjustConfigTotal(["totalUSD"], baseDelta);
        } else if (baseAssetUpper === "PEN") {
          await adjustConfigTotal(["totalPen", "totalPEN"], baseDelta);
        } else if (assetDoc.type === "stock" || baseAssetUpper === assetDoc.symbol?.toUpperCase?.()) {
          const currentAmount = extractHoldingAmount(assetDoc.initialInvestment);
          const newAmount = Math.max(0, currentAmount + baseDelta);
          assetDoc.initialInvestment = applyHoldingAmount(assetDoc.initialInvestment, newAmount);
          await assetDoc.save();
        }

        if (quoteAssetUpper === "USD") {
          await adjustConfigTotal(["totalUSD"], quoteDelta);
        } else if (quoteAssetUpper === "PEN") {
          await adjustConfigTotal(["totalPen", "totalPEN"], quoteDelta);
        }
      }
    } catch (adjustErr) {
      console.error("❌ Error actualizando balances tras cerrar transacción:", adjustErr.message);
    }

    res.json(tx);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * Obtener todas las transacciones
 */
export async function getTransactions(req, res) {
  try {
    const txs = await Transaction.find().populate("asset");
    res.json(txs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Obtener transacción por ID
 */
export async function getTransactionById(req, res) {
  try {
    const { id } = req.params;
    const tx = await Transaction.findById(id).populate("asset");
    if (!tx) return res.status(404).json({ error: "Transacción no encontrada" });
    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Eliminar transacción
 */
export async function deleteTransaction(req, res) {
  try {
    const { id } = req.params;
    const tx = await Transaction.findByIdAndDelete(id);
    if (!tx) return res.status(404).json({ error: "Transacción no encontrada" });

    res.json({ message: "Transacción eliminada correctamente" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

import axios from "axios";
import Transaction from "../models/transaction.model.js";
import Asset from "../models/asset.model.js";
import ConfigInfo from "../models/configInfo.model.js";

const KNOWN_QUOTES = ["USDT", "USDC", "BUSD", "BTC", "ETH", "USD", "PEN"];

const USDT_RATE_KEYS = [
  "PrecioVentaUSDT",
  "lastPriceUsdtSell",
  "PrecioCompraUSDT",
  "lastPriceUsdtBuy",
];

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

async function getUsdtUsdRate() {
  try {
    const docs = await ConfigInfo.find({ name: { $in: USDT_RATE_KEYS } });
    for (const key of USDT_RATE_KEYS) {
      const doc = docs.find(item => item.name === key && Number.isFinite(item.total) && item.total > 0);
      if (doc) {
        return doc.total;
      }
    }
  } catch (err) {
    console.error("❌ Error obteniendo tipo de cambio USDT/USD:", err.message);
  }
  return 1;
}

async function getBinanceTickerPrice(symbol) {
  try {
    const response = await axios.get("https://api.binance.com/api/v3/ticker/price", {
      params: { symbol },
    });
    const price = parseFloat(response?.data?.price);
    if (Number.isFinite(price) && price > 0) {
      return price;
    }
  } catch (err) {
    console.error(`Error obteniendo precio para ${symbol}:`, err.message);
  }
  return null;
}

async function getBnbUsdtPrice() {
  return getBinanceTickerPrice("BNBUSDT");
}

async function getAssetUsdPrice(code, cache, usdtUsdRate) {
  if (typeof code !== "string" || code.trim().length === 0) return null;
  const asset = code.trim().toUpperCase();
  cache.assetUsdPrices = cache.assetUsdPrices ?? {};
  if (typeof cache.assetUsdPrices[asset] === "number") {
    return cache.assetUsdPrices[asset];
  }

  const quoteOrder = ["USDT", "BUSD", "USDC", "USD"];
  for (const quote of quoteOrder) {
    const symbol = `${asset}${quote}`;
    const quotePrice = await getBinanceTickerPrice(symbol);
    if (quotePrice && quotePrice > 0) {
      const quoteUsdRate = quote === "USD" ? 1 : usdtUsdRate;
      if (quoteUsdRate) {
        const usdPrice = Number((quotePrice * quoteUsdRate).toFixed(8));
        cache.assetUsdPrices[asset] = usdPrice;
        return usdPrice;
      }
    }
  }

  return null;
}

async function convertFeeToUsd(amount, currency, cache = {}) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const code = typeof currency === "string" && currency.trim().length > 0 ? currency.trim().toUpperCase() : "USD";
  if (code === "USD") {
    return Number(amount.toFixed(8));
  }

  if (!cache.usdtUsdRate) {
    cache.usdtUsdRate = await getUsdtUsdRate();
  }
  const usdtUsdRate = Number.isFinite(cache.usdtUsdRate) && cache.usdtUsdRate > 0 ? cache.usdtUsdRate : 1;

  if (code === "USDT" || code === "USDC" || code === "BUSD") {
    return Number((amount * usdtUsdRate).toFixed(8));
  }

  if (code === "BNB") {
    if (!cache.bnbUsdtPrice) {
      cache.bnbUsdtPrice = await getBnbUsdtPrice();
    }
    const bnbUsdtPrice = Number.isFinite(cache.bnbUsdtPrice) && cache.bnbUsdtPrice > 0 ? cache.bnbUsdtPrice : null;
    if (bnbUsdtPrice) {
      return Number((amount * bnbUsdtPrice * usdtUsdRate).toFixed(8));
    }
  }

  const assetUsdPrice = await getAssetUsdPrice(code, cache, usdtUsdRate);
  if (assetUsdPrice) {
    return Number((amount * assetUsdPrice).toFixed(8));
  }

  // fallback: devolver monto original si no se pudo convertir
  return Number(amount.toFixed(8));
}

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
      openFeeCurrency,
    } = req.body;

    const normalizedAmount = amount ?? quantity;
    const parsedPrice = Number(openPrice);
    const parsedAmount = Number(normalizedAmount);
    const parsedOpenValue = Number(openValueFiat);
    const rawFee = Number(openFee ?? 0);
    const normalizedFee = Number.isFinite(rawFee) && rawFee > 0 ? rawFee : 0;
    const feeCurrencyCode =
      typeof openFeeCurrency === "string" && openFeeCurrency.trim().length > 0
        ? openFeeCurrency.trim().toUpperCase()
        : "USD";
    const feeConversionCache = {};
    const convertedOpenFee =
      normalizedFee > 0 ? await convertFeeToUsd(normalizedFee, feeCurrencyCode, feeConversionCache) : 0;
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
      openFee: convertedOpenFee,
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
    const rawCloseFee = Number(req.body.closeFee ?? 0);
    const normalizedCloseFee = Number.isFinite(rawCloseFee) && rawCloseFee > 0 ? rawCloseFee : 0;
    const closeFeeCurrency =
      typeof req.body.closeFeeCurrency === "string" && req.body.closeFeeCurrency.trim().length > 0
        ? req.body.closeFeeCurrency.trim().toUpperCase()
        : "USD";
    const closeFeeConversionCache = {};
    const closeFee =
      normalizedCloseFee > 0
        ? await convertFeeToUsd(normalizedCloseFee, closeFeeCurrency, closeFeeConversionCache)
        : 0;

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



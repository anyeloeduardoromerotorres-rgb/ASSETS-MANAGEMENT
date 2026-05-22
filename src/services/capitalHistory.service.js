import axios from "axios";
import CapitalHistory from "../models/capitalHistory.model.js";
import Asset from "../models/asset.model.js";
import ConfigInfo from "../models/configInfo.model.js";
import { getAllBalances } from "../scripts/fetchBalanceBinance.js";

const DEFAULT_TIME_ZONE = "America/Lima";

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatDateKey = (date = new Date(), timeZone = DEFAULT_TIME_ZONE) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
};

const isValidDateKey = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));

export const normalizeDateKey = value => {
  if (isValidDateKey(value)) return String(value);
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return formatDateKey(parsed);
  }
  return formatDateKey();
};

export const dateFromDateKey = dateKey => new Date(`${dateKey}T00:00:00.000Z`);

export async function upsertCapitalSnapshot({
  totalUsd,
  dateKey,
  source = "server",
  breakdown = {},
}) {
  const parsedTotal = Number(totalUsd);
  if (!Number.isFinite(parsedTotal) || parsedTotal < 0) {
    throw new Error("totalUsd debe ser un numero valido mayor o igual a cero");
  }

  const normalizedDateKey = normalizeDateKey(dateKey);
  const update = {
    dateKey: normalizedDateKey,
    date: dateFromDateKey(normalizedDateKey),
    totalUsd: parsedTotal,
    source,
    breakdown,
  };

  try {
    return await CapitalHistory.findOneAndUpdate(
      { dateKey: normalizedDateKey },
      update,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return CapitalHistory.findOneAndUpdate({ dateKey: normalizedDateKey }, update, {
      new: true,
    }).lean();
  }
}

export async function getCapitalHistory({ from, to } = {}) {
  const query = {};

  if (from || to) {
    query.date = {};
    if (from) {
      query.date.$gte = dateFromDateKey(normalizeDateKey(from));
    }
    if (to) {
      query.date.$lte = dateFromDateKey(normalizeDateKey(to));
    }
  }

  return CapitalHistory.find(query).sort({ date: 1 }).lean();
}

const fetchPenUsdRate = async () => {
  const res = await axios.get("https://open.er-api.com/v6/latest/PEN", {
    timeout: 10000,
  });
  const rate = res.data?.rates?.USD;
  return Number.isFinite(Number(rate)) ? Number(rate) : null;
};

const fetchStockPrice = async symbol => {
  const res = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
    { timeout: 10000 }
  );
  const price = res.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
  return Number.isFinite(Number(price)) ? Number(price) : null;
};

const extractStockUnits = initialInvestment => {
  if (typeof initialInvestment === "number") return initialInvestment;
  if (!initialInvestment || typeof initialInvestment !== "object") return 0;
  if (typeof initialInvestment.USD === "number") return initialInvestment.USD;
  if (typeof initialInvestment.amount === "number") return initialInvestment.amount;
  return 0;
};

export async function calculateCurrentCapitalSnapshot() {
  const [balances, configs, pricesRes, penUsdRate, assets] = await Promise.all([
    getAllBalances(),
    ConfigInfo.find({
      name: { $in: ["PrecioVentaUSDT", "lastPriceUsdtSell", "totalUSD", "totalPen"] },
    }).lean(),
    axios.get("https://api.binance.com/api/v3/ticker/price", { timeout: 10000 }),
    fetchPenUsdRate().catch(() => null),
    Asset.find({ type: "stock" }).lean(),
  ]);

  const configMap = configs.reduce((acc, config) => {
    acc[config.name] = config.total;
    return acc;
  }, {});

  const usdtSellPrice = toFiniteNumber(
    configMap.PrecioVentaUSDT,
    toFiniteNumber(configMap.lastPriceUsdtSell, 1)
  );
  const cashUsd = toFiniteNumber(configMap.totalUSD, 0);
  const cashPen = toFiniteNumber(configMap.totalPen, 0);

  const prices = {};
  for (const priceRow of pricesRes.data ?? []) {
    prices[priceRow.symbol] = Number(priceRow.price);
  }

  const binanceTotal = balances.reduce((sum, balance) => {
    const amount = toFiniteNumber(balance.amount, 0);
    let usdValue = 0;

    if (balance.asset === "USDT") {
      usdValue = amount * usdtSellPrice;
    } else if (Number.isFinite(prices[`${balance.asset}USDT`])) {
      usdValue = amount * prices[`${balance.asset}USDT`];
    } else if (Number.isFinite(prices[`${balance.asset}BUSD`])) {
      usdValue = amount * prices[`${balance.asset}BUSD`];
    }

    return sum + usdValue;
  }, 0);

  const stockRows = await Promise.all(
    assets.map(async asset => {
      const units = extractStockUnits(asset.initialInvestment);
      const price = await fetchStockPrice(asset.symbol).catch(() => null);
      const usdValue = price != null ? units * price : units;
      return { symbol: asset.symbol, units, price, usdValue };
    })
  );

  const stockTotal = stockRows.reduce((sum, row) => sum + row.usdValue, 0);
  const penUsdValue = penUsdRate ? cashPen * penUsdRate : 0;
  const totalUsd = binanceTotal + cashUsd + penUsdValue + stockTotal;

  return {
    totalUsd,
    breakdown: {
      binanceTotal,
      cashUsd,
      cashPen,
      penUsdRate,
      penUsdValue,
      stockTotal,
      stocks: stockRows,
      usdtSellPrice,
    },
  };
}

export async function saveCurrentCapitalSnapshot({ reason = "manual" } = {}) {
  const current = await calculateCurrentCapitalSnapshot();
  return upsertCapitalSnapshot({
    totalUsd: current.totalUsd,
    source: "server",
    breakdown: { ...current.breakdown, reason },
  });
}

import mongoose from "mongoose";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { connectdb } from "../db.js";
import Asset from "../models/asset.model.js";
import CloseHistory from "../models/pairHistorical.model.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_TOLERANCE = 1e-8;
const DEFAULT_YEARS = 7;
const DEFAULT_DRAWDOWN_YEARS = 5;
const DEFAULT_MIN_TRADE_USD = 10;
const REBALANCED_TYPES = new Set(["crypto", "stock", "commodity"]);
const CASH_LIKE_SYMBOLS = new Set(["SHV"]);
const DEFAULT_DNS_SERVERS = ["8.8.8.8", "1.1.1.1"];
const DYNAMIC_BASE_WEIGHT = 0.7;
const DYNAMIC_SIGNAL_WEIGHT = 0.3;
const SLOPE_HOLD_MODES = new Set(["linear", "sqrt", "multiplier"]);

function parseArgs(argv) {
  const args = {
    capital: null,
    from: null,
    to: null,
    years: DEFAULT_YEARS,
    minTradeUsd: DEFAULT_MIN_TRADE_USD,
    feePct: 0,
    dynamicAllocation: false,
    slopeAllocation: false,
    ignoreSlopeHoldThreshold: false,
    slopeHoldMode: "linear",
    slopeLowLimit: 0,
    exportCsv: null,
    excludeSymbols: [],
    cashYieldSymbol: null,
    enhancedIncome: false,
    dividendTax: 0.3,
  };

  for (const arg of argv) {
    const [key, rawValue] = arg.replace(/^--/, "").split("=");
    if (!key || rawValue == null) continue;

    if (key === "capital") args.capital = Number(rawValue);
    if (key === "from") args.from = rawValue;
    if (key === "to") args.to = rawValue;
    if (key === "years") args.years = Number(rawValue);
    if (key === "min-trade") args.minTradeUsd = Number(rawValue);
    if (key === "fee") args.feePct = Number(rawValue);
    if (key === "dynamic-allocation") args.dynamicAllocation = rawValue !== "false" && rawValue !== "0";
    if (key === "slope-allocation") args.slopeAllocation = rawValue !== "false" && rawValue !== "0";
    if (key === "ignore-slope-hold") args.ignoreSlopeHoldThreshold = rawValue !== "false" && rawValue !== "0";
    if (key === "slope-hold-mode") args.slopeHoldMode = rawValue;
    if (key === "slope-low-limit") args.slopeLowLimit = Number(rawValue);
    if (key === "export-csv") args.exportCsv = rawValue;
    if (key === "exclude") {
      args.excludeSymbols = rawValue
        .split(",")
        .map(item => item.trim().toUpperCase())
        .filter(Boolean);
    }
    if (key === "cash-yield-symbol") args.cashYieldSymbol = rawValue.toUpperCase();
    if (key === "enhanced-income") args.enhancedIncome = rawValue !== "false" && rawValue !== "0";
    if (key === "dividend-tax") args.dividendTax = Number(rawValue);
  }

  return args;
}

function configureDnsForSrvUri() {
  if (!process.env.BD?.startsWith("mongodb+srv://")) return;

  const configuredServers = process.env.MONGODB_DNS_SERVERS
    ?.split(",")
    .map(item => item.trim())
    .filter(Boolean);

  dns.setServers(configuredServers?.length ? configuredServers : DEFAULT_DNS_SERVERS);
}

function toUtcDay(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addYears(date, years) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function subtractYears(date, years) {
  return addYears(date, -years);
}

function formatDate(date) {
  return toUtcDay(date).toISOString().slice(0, 10);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(2)}`;
}

function formatCsvNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toFixed(decimals).replace(".", ",");
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  if (/[;"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(escapeCsvValue).join(";"),
    ...rows.map(row => headers.map(header => escapeCsvValue(row[header])).join(";")),
  ].join("\n");

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, "utf8");
}

function normalizeCandles(rawCandles = []) {
  const byDay = new Map();

  for (const candle of rawCandles) {
    const close = Number(candle?.close);
    const time = new Date(candle?.closeTime).getTime();
    if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(time)) continue;
    const day = toUtcDay(time);
    byDay.set(day.getTime(), {
      closeTime: day,
      close,
    });
  }

  return Array.from(byDay.values()).sort(
    (a, b) => a.closeTime.getTime() - b.closeTime.getTime()
  );
}

async function fetchYahooDividends(symbol, startDate, endDate) {
  const period1 = Math.floor(toUtcDay(startDate).getTime() / 1000);
  const period2 = Math.floor((toUtcDay(endDate).getTime() + DAY_MS) / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&period1=${period1}&period2=${period2}&events=div`;

  const res = await axios.get(url, { timeout: 30000 });
  const result = res.data?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const dividends = result?.events?.dividends ?? {};
  const priceByDay = new Map();

  timestamps.forEach((timestamp, index) => {
    const close = Number(closes[index]);
    if (!Number.isFinite(close) || close <= 0) return;
    priceByDay.set(toUtcDay(timestamp * 1000).getTime(), close);
  });

  return Object.values(dividends)
    .map(dividend => {
      const date = toUtcDay(Number(dividend.date) * 1000);
      const amount = Number(dividend.amount);
      const price = priceByDay.get(date.getTime()) ?? null;
      if (!Number.isFinite(amount) || amount <= 0 || !price) return null;
      return {
        date,
        amount,
        price,
        yieldFraction: amount / price,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function fetchYahooDividendEventsBySymbol(symbols, startDate, endDate) {
  const entries = await Promise.all(
    symbols.map(async symbol => [symbol, await fetchYahooDividends(symbol, startDate, endDate)])
  );
  return new Map(entries);
}

function getDailyCandles(history) {
  const frame =
    history?.historicalData?.find(item => item.timeFrame === "1d") ??
    history?.historicalData?.[0];
  return normalizeCandles(frame?.candles ?? []);
}

function calculateRollingHighLow(candles, asOfDate, years) {
  const asOfMs = toUtcDay(asOfDate).getTime();
  const cutoff = subtractYears(new Date(asOfMs), years).getTime();
  const drawdownCutoff = subtractYears(new Date(asOfMs), DEFAULT_DRAWDOWN_YEARS).getTime();

  const highWindow = candles.filter(c => {
    const time = c.closeTime.getTime();
    return time >= cutoff && time <= asOfMs;
  });

  if (!highWindow.length) {
    return null;
  }

  let high = null;
  for (const candle of highWindow) {
    if (high == null || candle.close > high) {
      high = candle.close;
    }
  }

  if (high == null || high <= 0) {
    return null;
  }

  const drawdownWindow = candles.filter(c => {
    const time = c.closeTime.getTime();
    return time >= drawdownCutoff && time <= asOfMs;
  });

  let runningHigh = null;
  let maxDrawdownPercent = 0;

  for (const candle of drawdownWindow) {
    if (runningHigh == null || candle.close > runningHigh) {
      runningHigh = candle.close;
    }

    if (runningHigh > 0) {
      const drawdownPercent = (runningHigh - candle.close) / runningHigh;
      if (drawdownPercent > maxDrawdownPercent) {
        maxDrawdownPercent = drawdownPercent;
      }
    }
  }

  return {
    high,
    low: high * (1 - maxDrawdownPercent),
  };
}

function calculateSlope(candles, asOfDate, years, assetType) {
  const asOfMs = toUtcDay(asOfDate).getTime();
  const window = candles.filter(c => {
    const time = c.closeTime.getTime();
    return time <= asOfMs && c.close > 0;
  });

  if (window.length < 2) return 0;

  const start = window[0].closeTime.getTime();
  const x = window.map(c => (c.closeTime.getTime() - start) / DAY_MS);
  const y = window.map(c => Math.log(c.close));
  const n = x.length;
  const sumX = x.reduce((sum, value) => sum + value, 0);
  const sumY = y.reduce((sum, value) => sum + value, 0);
  const sumXY = x.reduce((sum, value, index) => sum + value * y[index], 0);
  const sumX2 = x.reduce((sum, value) => sum + value * value, 0);
  const denominator = n * sumX2 - sumX * sumX;

  if (Math.abs(denominator) <= Number.EPSILON) return 0;

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const annualizationDays = assetType === "crypto" ? 365 : 252;
  return (Math.exp(slope * annualizationDays) - 1) * 100;
}

function getSlopeHoldFraction(slopeFraction, mode) {
  const absFraction = Math.min(Math.abs(slopeFraction), 1);

  if (mode === "sqrt") {
    return Math.sqrt(absFraction);
  }

  if (mode === "multiplier") {
    return Math.min(1, absFraction * 1.5);
  }

  return absFraction;
}

function getDecisionLow(low, high, slopeFraction, slopeLowLimit) {
  if (!Number.isFinite(slopeLowLimit) || slopeLowLimit <= 0 || slopeFraction <= 0) {
    return low;
  }

  const adjustment = clamp(slopeFraction, 0, slopeLowLimit);
  return low + (high - low) * adjustment;
}

function getPriceAtOrBefore(candles, asOfDate) {
  const asOfMs = toUtcDay(asOfDate).getTime();
  let left = 0;
  let right = candles.length - 1;
  let found = null;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const time = candles[mid].closeTime.getTime();
    if (time <= asOfMs) {
      found = candles[mid];
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return found?.close ?? null;
}

function getMomentumReturn(candles, asOfDate, years) {
  const currentPrice = getPriceAtOrBefore(candles, asOfDate);
  const previousPrice = getPriceAtOrBefore(candles, subtractYears(toUtcDay(asOfDate), years));

  if (!currentPrice || !previousPrice || previousPrice <= 0) return 0;
  return currentPrice / previousPrice - 1;
}

function applySlopeHoldThreshold({
  targetBaseUsd,
  actualBaseUsd,
  allocation,
  baseHoldUsd,
  quoteHoldUsd,
  maxBaseAllowed,
  ignoreSlopeHoldThreshold = false,
}) {
  const rawTargetBaseUsd = clamp(targetBaseUsd, 0, allocation);
  const rawBaseDiffUsd = rawTargetBaseUsd - actualBaseUsd;
  let effectiveTargetBaseUsd = rawTargetBaseUsd;

  if (ignoreSlopeHoldThreshold) {
    effectiveTargetBaseUsd = rawTargetBaseUsd;
  } else if (rawBaseDiffUsd < -BASE_TOLERANCE && baseHoldUsd > 0) {
    const sellPressureUsd = Math.abs(rawBaseDiffUsd);
    const adjustedSellUsd = sellPressureUsd - baseHoldUsd;
    effectiveTargetBaseUsd =
      adjustedSellUsd > BASE_TOLERANCE
        ? Math.max(actualBaseUsd - adjustedSellUsd, 0)
        : actualBaseUsd;
  } else if (rawBaseDiffUsd > BASE_TOLERANCE && quoteHoldUsd > 0) {
    const buyPressureUsd = rawBaseDiffUsd;
    const adjustedBuyUsd = buyPressureUsd - quoteHoldUsd;
    effectiveTargetBaseUsd =
      adjustedBuyUsd > BASE_TOLERANCE
        ? Math.min(actualBaseUsd + adjustedBuyUsd, maxBaseAllowed)
        : actualBaseUsd;
  } else if (quoteHoldUsd > 0 && rawBaseDiffUsd < -BASE_TOLERANCE) {
    effectiveTargetBaseUsd = Math.min(rawTargetBaseUsd, maxBaseAllowed);
  }

  const targetQuoteUsd = allocation - effectiveTargetBaseUsd;
  const baseDiffUsd = effectiveTargetBaseUsd - actualBaseUsd;

  return {
    targetBaseUsd: effectiveTargetBaseUsd,
    targetQuoteUsd,
    baseDiffUsd,
  };
}

function runAssetBacktest({
  asset,
  candles,
  startDate,
  endDate,
  initialCapital,
  years,
  minTradeUsd,
  feePct,
  ignoreSlopeHoldThreshold,
  slopeHoldMode,
  slopeLowLimit,
}) {
  const startMs = toUtcDay(startDate).getTime();
  const endMs = toUtcDay(endDate).getTime();
  const testCandles = candles.filter(c => {
    const time = c.closeTime.getTime();
    return time >= startMs && time <= endMs;
  });

  if (testCandles.length < 2) {
    throw new Error(`${asset.symbol}: no hay suficientes velas en el periodo de backtesting`);
  }

  const firstPrice = testCandles[0].close;
  const lastPrice = testCandles[testCandles.length - 1].close;
  let baseUnits = 0;
  let quoteUsd = initialCapital;
  let trades = 0;
  let buys = 0;
  let sells = 0;

  for (const candle of testCandles) {
    const price = candle.close;
    const indicators = calculateRollingHighLow(candles, candle.closeTime, years);
    if (!indicators) continue;

    let { high, low } = indicators;
    if (low > high) {
      const temp = low;
      low = high;
      high = temp;
    }

    const actualBaseUsd = baseUnits * price;
    const allocation = actualBaseUsd + quoteUsd;
    if (allocation <= BASE_TOLERANCE) continue;

    const slope = calculateSlope(candles, candle.closeTime, years, asset.type);
    const slopeFraction = slope / 100;
    const slopeHoldFraction = getSlopeHoldFraction(slopeFraction, slopeHoldMode);
    const baseHoldFraction = slopeFraction > 0 ? slopeHoldFraction : 0;
    const quoteHoldFraction = slopeFraction < 0 ? slopeHoldFraction : 0;
    const baseHoldUsd = allocation * baseHoldFraction;
    const quoteHoldUsd = allocation * quoteHoldFraction;
    const maxBaseAllowed = Math.max(allocation - quoteHoldUsd, 0);
    const decisionLow = getDecisionLow(low, high, slopeFraction, slopeLowLimit);
    const priceRange = high - decisionLow;
    const normalized = priceRange === 0 ? 0.5 : clamp((price - decisionLow) / priceRange, 0, 1);
    const baseShare = clamp(1 - normalized, 0, 1);
    const desiredBaseUsd = allocation * baseShare;
    const { baseDiffUsd } = applySlopeHoldThreshold({
      targetBaseUsd: desiredBaseUsd,
      actualBaseUsd,
      allocation,
      baseHoldUsd,
      quoteHoldUsd,
      maxBaseAllowed,
      ignoreSlopeHoldThreshold,
    });

    const tradeUsd = Math.abs(baseDiffUsd);
    if (tradeUsd < minTradeUsd) continue;

    if (baseDiffUsd > BASE_TOLERANCE) {
      const grossBuyUsd = Math.min(baseDiffUsd, quoteUsd);
      if (grossBuyUsd < minTradeUsd) continue;
      const feeUsd = grossBuyUsd * feePct;
      const netBuyUsd = Math.max(grossBuyUsd - feeUsd, 0);
      baseUnits += netBuyUsd / price;
      quoteUsd -= grossBuyUsd;
      trades += 1;
      buys += 1;
    } else if (baseDiffUsd < -BASE_TOLERANCE) {
      const sellUsd = Math.min(-baseDiffUsd, actualBaseUsd);
      if (sellUsd < minTradeUsd) continue;
      const unitsToSell = sellUsd / price;
      const feeUsd = sellUsd * feePct;
      baseUnits = Math.max(baseUnits - unitsToSell, 0);
      quoteUsd += Math.max(sellUsd - feeUsd, 0);
      trades += 1;
      sells += 1;
    }
  }

  const finalValue = quoteUsd + baseUnits * lastPrice;
  const strategyReturnPct = ((finalValue - initialCapital) / initialCapital) * 100;
  const buyHoldFinalValue = (initialCapital / firstPrice) * lastPrice;
  const buyHoldReturnPct = ((buyHoldFinalValue - initialCapital) / initialCapital) * 100;

  return {
    symbol: asset.symbol,
    allocationPercentage: asset.allocationPercentage,
    initialCapital,
    finalValue,
    firstPrice,
    lastPrice,
    strategyReturnPct,
    buyHoldReturnPct,
    trades,
    buys,
    sells,
    firstTradeDate: formatDate(testCandles[0].closeTime),
    lastTradeDate: formatDate(testCandles[testCandles.length - 1].closeTime),
  };
}

function getSimulationDates(assetData, startDate, endDate) {
  const startMs = toUtcDay(startDate).getTime();
  const endMs = toUtcDay(endDate).getTime();
  const dates = new Set();

  for (const item of assetData) {
    for (const candle of item.candles) {
      const time = candle.closeTime.getTime();
      if (time >= startMs && time <= endMs) {
        dates.add(time);
      }
    }
  }

  return Array.from(dates)
    .sort((a, b) => a - b)
    .map(time => new Date(time));
}

function calculateDynamicWeights(assetData, date, years, allocationTotal) {
  const rows = assetData.map(item => {
    const baseWeight =
      allocationTotal > 0
        ? toFiniteNumber(item.asset.allocationPercentage) / allocationTotal
        : 1 / assetData.length;
    const slope = calculateSlope(item.candles, date, years, item.asset.type);
    const momentum = getMomentumReturn(item.candles, date, years);
    const signal = Math.max(0, slope / 100) + Math.max(0, momentum);

    return {
      item,
      baseWeight,
      signal,
    };
  });

  const signalTotal = rows.reduce((sum, row) => sum + row.signal, 0);

  if (signalTotal <= BASE_TOLERANCE) {
    return new Map(rows.map(row => [String(row.item.asset._id), row.baseWeight]));
  }

  const rawWeights = rows.map(row => ({
    item: row.item,
    weight:
      DYNAMIC_BASE_WEIGHT * row.baseWeight +
      DYNAMIC_SIGNAL_WEIGHT * (row.signal / signalTotal),
  }));
  const total = rawWeights.reduce((sum, row) => sum + row.weight, 0);

  return new Map(
    rawWeights.map(row => [String(row.item.asset._id), total > 0 ? row.weight / total : row.weight])
  );
}

function runDynamicPortfolioBacktest({
  assetData,
  startDate,
  endDate,
  initialPortfolioCapital,
  years,
  minTradeUsd,
  feePct,
  ignoreSlopeHoldThreshold,
  slopeHoldMode,
  slopeLowLimit,
  cashYieldEvents = [],
  enhancedIncome = false,
  dividendTax = 0.3,
  assetDividendEventsBySymbol = new Map(),
}) {
  const dates = getSimulationDates(assetData, startDate, endDate);
  if (dates.length < 2) {
    throw new Error("No hay suficientes fechas comunes para el backtesting dinamico");
  }

  const allocationTotal = assetData.reduce(
    (sum, item) => sum + toFiniteNumber(item.asset.allocationPercentage),
    0
  );
  const holdings = new Map(assetData.map(item => [String(item.asset._id), 0]));
  const stats = new Map(
    assetData.map(item => [
      String(item.asset._id),
      { trades: 0, buys: 0, sells: 0, buyHoldReturnPct: 0 },
    ])
  );
  const tradeLog = [];
  let cashUsd = initialPortfolioCapital;
  let cashYieldUsd = 0;
  let usdtInterestUsd = 0;
  let btcInterestUnits = 0;
  let bnbInterestUnits = 0;
  let assetDividendUsd = 0;
  let lastPrices = new Map();
  let nextCashYieldEventIndex = 0;
  const nextDividendEventIndexBySymbol = new Map();
  let previousIncomeDate = null;

  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  for (const item of assetData) {
    const firstPrice = getPriceAtOrBefore(item.candles, firstDate);
    const lastPrice = getPriceAtOrBefore(item.candles, lastDate);
    const rowStats = stats.get(String(item.asset._id));
    rowStats.buyHoldReturnPct =
      firstPrice && lastPrice ? ((lastPrice / firstPrice) - 1) * 100 : 0;
  }

  for (const date of dates) {
    if (enhancedIncome && previousIncomeDate) {
      const elapsedDays = Math.max(0, (date.getTime() - previousIncomeDate.getTime()) / DAY_MS);
      if (elapsedDays > 0) {
        const usdtDailyRate = 0.0194 / 365;
        const usdtInterest = (cashUsd * 0.5) * (Math.pow(1 + usdtDailyRate, elapsedDays) - 1);
        cashUsd += usdtInterest;
        usdtInterestUsd += usdtInterest;

        const btcId = assetData.find(item => item.asset.symbol === "BTCUSDT")?.asset._id?.toString();
        if (btcId) {
          const before = holdings.get(btcId) ?? 0;
          const after = before * Math.pow(1 + 0.0027 / 365, elapsedDays);
          holdings.set(btcId, after);
          btcInterestUnits += after - before;
        }

        const bnbId = assetData.find(item => item.asset.symbol === "BNBUSDT")?.asset._id?.toString();
        if (bnbId) {
          const before = holdings.get(bnbId) ?? 0;
          const after = before * Math.pow(1 + 0.0016 / 365, elapsedDays);
          holdings.set(bnbId, after);
          bnbInterestUnits += after - before;
        }
      }
    }

    while (
      nextCashYieldEventIndex < cashYieldEvents.length &&
      cashYieldEvents[nextCashYieldEventIndex].date.getTime() <= date.getTime()
    ) {
      const event = cashYieldEvents[nextCashYieldEventIndex];
      if (event.date.getTime() >= firstDate.getTime() && cashUsd > BASE_TOLERANCE) {
        const taxableCash = enhancedIncome ? cashUsd * 0.5 : cashUsd;
        const dividendUsd = taxableCash * event.yieldFraction * (1 - dividendTax);
        cashUsd += dividendUsd;
        cashYieldUsd += dividendUsd;
      }
      nextCashYieldEventIndex += 1;
    }

    if (enhancedIncome) {
      for (const [symbol, events] of assetDividendEventsBySymbol.entries()) {
        const assetItem = assetData.find(item => item.asset.symbol === symbol);
        if (!assetItem) continue;
        const assetId = String(assetItem.asset._id);
        let eventIndex = nextDividendEventIndexBySymbol.get(symbol) ?? 0;
        while (eventIndex < events.length && events[eventIndex].date.getTime() <= date.getTime()) {
          const event = events[eventIndex];
          if (event.date.getTime() >= firstDate.getTime()) {
            const units = holdings.get(assetId) ?? 0;
            const dividendUsd = units * event.amount * (1 - dividendTax);
            cashUsd += dividendUsd;
            assetDividendUsd += dividendUsd;
          }
          eventIndex += 1;
        }
        nextDividendEventIndexBySymbol.set(symbol, eventIndex);
      }
    }

    const prices = new Map();
    for (const item of assetData) {
      const price = getPriceAtOrBefore(item.candles, date);
      if (price && price > 0) {
        prices.set(String(item.asset._id), price);
        lastPrices.set(String(item.asset._id), price);
      }
    }

    if (prices.size !== assetData.length) continue;

    let portfolioValue = cashUsd;
    for (const item of assetData) {
      const id = String(item.asset._id);
      portfolioValue += (holdings.get(id) ?? 0) * prices.get(id);
    }

    if (portfolioValue <= BASE_TOLERANCE) continue;

    const weights = calculateDynamicWeights(assetData, date, years, allocationTotal);
    const plannedTrades = [];

    for (const item of assetData) {
      const id = String(item.asset._id);
      const price = prices.get(id);
      const weight = weights.get(id) ?? 0;
      const bucketAllocation = portfolioValue * weight;
      const indicators = calculateRollingHighLow(item.candles, date, years);
      if (!indicators || bucketAllocation <= BASE_TOLERANCE) continue;

      let { high, low } = indicators;
      if (low > high) {
        const temp = low;
        low = high;
        high = temp;
      }

      const baseUnits = holdings.get(id) ?? 0;
      const actualBaseUsd = baseUnits * price;
      const slope = calculateSlope(item.candles, date, years, item.asset.type);
      const slopeFraction = slope / 100;
      const slopeHoldFraction = getSlopeHoldFraction(slopeFraction, slopeHoldMode);
      const baseHoldFraction = slopeFraction > 0 ? slopeHoldFraction : 0;
      const quoteHoldFraction = slopeFraction < 0 ? slopeHoldFraction : 0;
      const baseHoldUsd = bucketAllocation * baseHoldFraction;
      const quoteHoldUsd = bucketAllocation * quoteHoldFraction;
      const maxBaseAllowed = Math.max(bucketAllocation - quoteHoldUsd, 0);
      const decisionLow = getDecisionLow(low, high, slopeFraction, slopeLowLimit);
      const priceRange = high - decisionLow;
      const normalized = priceRange === 0 ? 0.5 : clamp((price - decisionLow) / priceRange, 0, 1);
      const baseShare = clamp(1 - normalized, 0, 1);
      const desiredBaseUsd = bucketAllocation * baseShare;
      const { baseDiffUsd } = applySlopeHoldThreshold({
        targetBaseUsd: desiredBaseUsd,
        actualBaseUsd,
        allocation: bucketAllocation,
        baseHoldUsd,
        quoteHoldUsd,
        maxBaseAllowed,
        ignoreSlopeHoldThreshold,
      });

      if (Math.abs(baseDiffUsd) >= minTradeUsd) {
        plannedTrades.push({ item, id, price, baseDiffUsd });
      }
    }

    for (const trade of plannedTrades.filter(item => item.baseDiffUsd < -BASE_TOLERANCE)) {
      const baseUnits = holdings.get(trade.id) ?? 0;
      const actualBaseUsd = baseUnits * trade.price;
      const sellUsd = Math.min(-trade.baseDiffUsd, actualBaseUsd);
      if (sellUsd < minTradeUsd) continue;
      const unitsToSell = sellUsd / trade.price;
      const feeUsd = sellUsd * feePct;
      holdings.set(trade.id, Math.max(baseUnits - unitsToSell, 0));
      cashUsd += Math.max(sellUsd - feeUsd, 0);
      const rowStats = stats.get(trade.id);
      rowStats.trades += 1;
      rowStats.sells += 1;
      tradeLog.push({
        date: formatDate(date),
        symbol: assetData.find(item => String(item.asset._id) === trade.id)?.asset.symbol ?? trade.id,
        action: "sell",
        price: trade.price,
        tradeUsd: sellUsd,
        units: unitsToSell,
        portfolioValue,
      });
    }

    for (const trade of plannedTrades.filter(item => item.baseDiffUsd > BASE_TOLERANCE)) {
      const buyUsd = Math.min(trade.baseDiffUsd, cashUsd);
      if (buyUsd < minTradeUsd) continue;
      const feeUsd = buyUsd * feePct;
      const netBuyUsd = Math.max(buyUsd - feeUsd, 0);
      holdings.set(trade.id, (holdings.get(trade.id) ?? 0) + netBuyUsd / trade.price);
      cashUsd -= buyUsd;
      const rowStats = stats.get(trade.id);
      rowStats.trades += 1;
      rowStats.buys += 1;
      tradeLog.push({
        date: formatDate(date),
        symbol: assetData.find(item => String(item.asset._id) === trade.id)?.asset.symbol ?? trade.id,
        action: "buy",
        price: trade.price,
        tradeUsd: buyUsd,
        units: Math.max(buyUsd - feeUsd, 0) / trade.price,
        portfolioValue,
      });
    }

    previousIncomeDate = date;
  }

  const finalValue = assetData.reduce((sum, item) => {
    const id = String(item.asset._id);
    return sum + (holdings.get(id) ?? 0) * (lastPrices.get(id) ?? 0);
  }, cashUsd);

  const results = assetData.map(item => {
    const id = String(item.asset._id);
    const rowStats = stats.get(id);
    const finalAssetValue = (holdings.get(id) ?? 0) * (lastPrices.get(id) ?? 0);

    return {
      symbol: item.asset.symbol,
      allocationPercentage: item.asset.allocationPercentage,
      initialCapital:
        initialPortfolioCapital *
        (allocationTotal > 0
          ? toFiniteNumber(item.asset.allocationPercentage) / allocationTotal
          : 1 / assetData.length),
      finalValue: finalAssetValue,
      strategyReturnPct: ((finalValue - initialPortfolioCapital) / initialPortfolioCapital) * 100,
      buyHoldReturnPct: rowStats.buyHoldReturnPct,
      trades: rowStats.trades,
      buys: rowStats.buys,
      sells: rowStats.sells,
      firstTradeDate: formatDate(firstDate),
      lastTradeDate: formatDate(lastDate),
    };
  });

  return {
    results,
    finalValue,
    cashUsd,
    cashYieldUsd,
    usdtInterestUsd,
    btcInterestUnits,
    bnbInterestUnits,
    assetDividendUsd,
    dates,
    tradeLog,
  };
}

function runSlopeAllocationBacktest({
  assetData,
  startDate,
  endDate,
  initialPortfolioCapital,
  years,
  minTradeUsd,
  feePct,
}) {
  const dates = getSimulationDates(assetData, startDate, endDate);
  if (dates.length < 2) {
    throw new Error("No hay suficientes fechas para el backtesting por slope");
  }

  const holdings = new Map(assetData.map(item => [String(item.asset._id), 0]));
  const stats = new Map(
    assetData.map(item => [
      String(item.asset._id),
      { trades: 0, buys: 0, sells: 0, buyHoldReturnPct: 0 },
    ])
  );
  let cashUsd = initialPortfolioCapital;
  let lastPrices = new Map();
  const tradeLog = [];

  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const initialSlopeRows = assetData.map(item => ({
    id: String(item.asset._id),
    slope: Math.max(calculateSlope(item.candles, firstDate, years, item.asset.type), 0),
  }));
  const initialSlopeTotal = initialSlopeRows.reduce((sum, row) => sum + row.slope, 0);
  const initialWeightByAssetId = new Map(
    initialSlopeRows.map(row => [
      row.id,
      initialSlopeTotal > BASE_TOLERANCE ? row.slope / initialSlopeTotal : 1 / assetData.length,
    ])
  );
  const initialSlopeByAssetId = new Map(initialSlopeRows.map(row => [row.id, row.slope]));

  for (const item of assetData) {
    const firstPrice = getPriceAtOrBefore(item.candles, firstDate);
    const lastPrice = getPriceAtOrBefore(item.candles, lastDate);
    const rowStats = stats.get(String(item.asset._id));
    rowStats.buyHoldReturnPct =
      firstPrice && lastPrice ? ((lastPrice / firstPrice) - 1) * 100 : 0;
  }

  for (const date of dates) {
    const prices = new Map();
    const slopeRows = [];

    for (const item of assetData) {
      const id = String(item.asset._id);
      const price = getPriceAtOrBefore(item.candles, date);
      if (price && price > 0) {
        prices.set(id, price);
        lastPrices.set(id, price);
      }

      const slope = calculateSlope(item.candles, date, years, item.asset.type);
      slopeRows.push({ item, id, slope: Math.max(slope, 0) });
    }

    if (prices.size !== assetData.length) continue;

    let portfolioValue = cashUsd;
    for (const item of assetData) {
      const id = String(item.asset._id);
      portfolioValue += (holdings.get(id) ?? 0) * prices.get(id);
    }
    if (portfolioValue <= BASE_TOLERANCE) continue;

    const positiveSlopeTotal = slopeRows.reduce((sum, row) => sum + row.slope, 0);
    const weights = new Map();

    if (positiveSlopeTotal > BASE_TOLERANCE) {
      for (const row of slopeRows) {
        weights.set(row.id, row.slope / positiveSlopeTotal);
      }
    } else {
      const equalWeight = 1 / assetData.length;
      for (const row of slopeRows) {
        weights.set(row.id, equalWeight);
      }
    }

    const plannedTrades = [];
    for (const item of assetData) {
      const id = String(item.asset._id);
      const price = prices.get(id);
      const actualUsd = (holdings.get(id) ?? 0) * price;
      const targetUsd = portfolioValue * (weights.get(id) ?? 0);
      const diffUsd = targetUsd - actualUsd;
      if (Math.abs(diffUsd) >= minTradeUsd) {
        plannedTrades.push({
          id,
          price,
          diffUsd,
          slope: slopeRows.find(row => row.id === id)?.slope ?? 0,
          targetWeight: weights.get(id) ?? 0,
          actualUsd,
          targetUsd,
        });
      }
    }

    for (const trade of plannedTrades.filter(item => item.diffUsd < -BASE_TOLERANCE)) {
      const baseUnits = holdings.get(trade.id) ?? 0;
      const actualBaseUsd = baseUnits * trade.price;
      const sellUsd = Math.min(-trade.diffUsd, actualBaseUsd);
      if (sellUsd < minTradeUsd) continue;
      const feeUsd = sellUsd * feePct;
      holdings.set(trade.id, Math.max(baseUnits - sellUsd / trade.price, 0));
      cashUsd += Math.max(sellUsd - feeUsd, 0);
      const rowStats = stats.get(trade.id);
      rowStats.trades += 1;
      rowStats.sells += 1;
      tradeLog.push({
        date: formatDate(date),
        symbol: assetData.find(item => String(item.asset._id) === trade.id)?.asset.symbol ?? trade.id,
        action: "sell",
        slope: trade.slope,
        targetWeight: trade.targetWeight,
        actualUsd: trade.actualUsd,
        targetUsd: trade.targetUsd,
        diffUsd: trade.diffUsd,
        price: trade.price,
        tradeUsd: sellUsd,
        units: sellUsd / trade.price,
        portfolioValue,
      });
    }

    for (const trade of plannedTrades.filter(item => item.diffUsd > BASE_TOLERANCE)) {
      const buyUsd = Math.min(trade.diffUsd, cashUsd);
      if (buyUsd < minTradeUsd) continue;
      const feeUsd = buyUsd * feePct;
      holdings.set(trade.id, (holdings.get(trade.id) ?? 0) + Math.max(buyUsd - feeUsd, 0) / trade.price);
      cashUsd -= buyUsd;
      const rowStats = stats.get(trade.id);
      rowStats.trades += 1;
      rowStats.buys += 1;
      tradeLog.push({
        date: formatDate(date),
        symbol: assetData.find(item => String(item.asset._id) === trade.id)?.asset.symbol ?? trade.id,
        action: "buy",
        slope: trade.slope,
        targetWeight: trade.targetWeight,
        actualUsd: trade.actualUsd,
        targetUsd: trade.targetUsd,
        diffUsd: trade.diffUsd,
        price: trade.price,
        tradeUsd: buyUsd,
        units: Math.max(buyUsd - feeUsd, 0) / trade.price,
        portfolioValue,
      });
    }
  }

  const finalValue = assetData.reduce((sum, item) => {
    const id = String(item.asset._id);
    return sum + (holdings.get(id) ?? 0) * (lastPrices.get(id) ?? 0);
  }, cashUsd);

  const results = assetData.map(item => {
    const id = String(item.asset._id);
    const rowStats = stats.get(id);
    const initialCapital = initialPortfolioCapital * (initialWeightByAssetId.get(id) ?? 0);

    return {
      symbol: item.asset.symbol,
      allocationPercentage: item.asset.allocationPercentage,
      initialSlope: initialSlopeByAssetId.get(id) ?? 0,
      initialWeight: initialWeightByAssetId.get(id) ?? 0,
      initialCapital,
      finalValue: (holdings.get(id) ?? 0) * (lastPrices.get(id) ?? 0),
      strategyReturnPct: ((finalValue - initialPortfolioCapital) / initialPortfolioCapital) * 100,
      buyHoldReturnPct: rowStats.buyHoldReturnPct,
      trades: rowStats.trades,
      buys: rowStats.buys,
      sells: rowStats.sells,
      firstTradeDate: formatDate(firstDate),
      lastTradeDate: formatDate(lastDate),
    };
  });

  return {
    results,
    finalValue,
    cashUsd,
    dates,
    tradeLog,
  };
}

function printTable(rows) {
  const columns = [
    ["Activo", row => row.symbol],
    ["Alloc", row => `${toFiniteNumber(row.allocationPercentage).toFixed(2)}%`],
    ["Estrategia", row => formatPercent(row.strategyReturnPct)],
    ["Buy&Hold all-in", row => formatPercent(row.buyHoldReturnPct)],
    ["Trades", row => String(row.trades)],
    ["Compras", row => String(row.buys)],
    ["Ventas", row => String(row.sells)],
  ];

  const widths = columns.map(([header, getter]) =>
    Math.max(header.length, ...rows.map(row => getter(row).length))
  );

  const header = columns
    .map(([title], index) => title.padEnd(widths[index]))
    .join(" | ");
  const divider = widths.map(width => "-".repeat(width)).join("-|-");
  console.log(header);
  console.log(divider);

  for (const row of rows) {
    console.log(
      columns
        .map(([, getter], index) => getter(row).padEnd(widths[index]))
        .join(" | ")
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!Number.isFinite(args.years) || args.years <= 0) {
    throw new Error("--years debe ser un numero mayor a 0");
  }

  if (!Number.isFinite(args.minTradeUsd) || args.minTradeUsd < 0) {
    throw new Error("--min-trade debe ser un numero mayor o igual a 0");
  }

  if (!Number.isFinite(args.feePct) || args.feePct < 0) {
    throw new Error("--fee debe ser un numero mayor o igual a 0. Ejemplo: --fee=0.001");
  }

  if (!SLOPE_HOLD_MODES.has(args.slopeHoldMode)) {
    throw new Error("--slope-hold-mode debe ser linear, sqrt o multiplier");
  }

  if (!Number.isFinite(args.slopeLowLimit) || args.slopeLowLimit < 0 || args.slopeLowLimit > 1) {
    throw new Error("--slope-low-limit debe ser un numero entre 0 y 1");
  }

  configureDnsForSrvUri();
  await connectdb();

  const assets = await Asset.find({
    type: { $in: Array.from(REBALANCED_TYPES) },
    symbol: { $nin: Array.from(CASH_LIKE_SYMBOLS) },
    allocationPercentage: { $gt: 0 },
  }).lean();
  const filteredAssets = args.excludeSymbols.length
    ? assets.filter(asset => !args.excludeSymbols.includes(String(asset.symbol).toUpperCase()))
    : assets;

  if (!filteredAssets.length) {
    throw new Error("No encontre assets con allocationPercentage mayor a 0");
  }

  const histories = await CloseHistory.find({
    symbol: { $in: filteredAssets.map(asset => asset._id) },
  }).lean();
  const historyByAssetId = new Map(histories.map(history => [String(history.symbol), history]));
  const assetData = [];
  const skipped = [];

  for (const asset of filteredAssets) {
    const candles = getDailyCandles(historyByAssetId.get(String(asset._id)));
    if (candles.length < 2) {
      skipped.push(`${asset.symbol}: sin historial diario suficiente`);
      continue;
    }

    assetData.push({
      asset,
      candles,
      firstDate: candles[0].closeTime,
      lastDate: candles[candles.length - 1].closeTime,
      warmupEndDate: addYears(candles[0].closeTime, args.years),
    });
  }

  if (!assetData.length) {
    throw new Error("Ningun asset tiene historial suficiente para el backtesting");
  }

  const warmupYears = args.slopeAllocation ? 3 : args.years;
  for (const item of assetData) {
    item.warmupEndDate = addYears(item.firstDate, warmupYears);
  }

  const automaticStart = new Date(Math.max(...assetData.map(item => item.warmupEndDate.getTime())));
  const automaticEnd = new Date(Math.min(...assetData.map(item => item.lastDate.getTime())));
  const requestedStart = args.from ? toUtcDay(args.from) : automaticStart;
  const requestedEnd = args.to ? toUtcDay(args.to) : automaticEnd;
  const startDate = new Date(Math.max(automaticStart.getTime(), requestedStart.getTime()));
  const endDate = new Date(Math.min(automaticEnd.getTime(), requestedEnd.getTime()));

  if (startDate.getTime() >= endDate.getTime()) {
    throw new Error(
      `No hay periodo comun para backtesting. Inicio calculado: ${formatDate(startDate)}, fin calculado: ${formatDate(endDate)}`
    );
  }

  const cashYieldEvents = args.cashYieldSymbol || args.enhancedIncome
    ? await fetchYahooDividends(args.cashYieldSymbol ?? "SHV", startDate, endDate)
    : [];
  const assetDividendEventsBySymbol = args.enhancedIncome
    ? await fetchYahooDividendEventsBySymbol(["VOO"], startDate, endDate)
    : new Map();

  const allocationTotal = assetData.reduce(
    (sum, item) => sum + toFiniteNumber(item.asset.allocationPercentage),
    0
  );
  const designatedTotal = assetData.reduce(
    (sum, item) => sum + toFiniteNumber(item.asset.totalCapitalWhenLastAdded),
    0
  );
  const initialPortfolioCapital =
    Number.isFinite(args.capital) && args.capital > 0
      ? args.capital
      : designatedTotal > 0
        ? designatedTotal
        : 10000;

  const slopeAllocationBacktest = args.slopeAllocation
    ? runSlopeAllocationBacktest({
        assetData,
        startDate,
        endDate,
        initialPortfolioCapital,
        years: args.years,
        minTradeUsd: args.minTradeUsd,
        feePct: args.feePct,
      })
    : null;

  const dynamicBacktest = !slopeAllocationBacktest && args.dynamicAllocation
    ? runDynamicPortfolioBacktest({
        assetData,
        startDate,
        endDate,
        initialPortfolioCapital,
        years: args.years,
        minTradeUsd: args.minTradeUsd,
        feePct: args.feePct,
        ignoreSlopeHoldThreshold: args.ignoreSlopeHoldThreshold,
        slopeHoldMode: args.slopeHoldMode,
        slopeLowLimit: args.slopeLowLimit,
        cashYieldEvents,
        enhancedIncome: args.enhancedIncome,
        dividendTax: args.dividendTax,
        assetDividendEventsBySymbol,
      })
    : null;

  const results = slopeAllocationBacktest
    ? slopeAllocationBacktest.results
    : dynamicBacktest
    ? dynamicBacktest.results
    : assetData.map(item => {
        const percentage = toFiniteNumber(item.asset.allocationPercentage);
        const weight = allocationTotal > 0 ? percentage / allocationTotal : 1 / assetData.length;
        const initialCapital = initialPortfolioCapital * weight;
        return runAssetBacktest({
          asset: item.asset,
          candles: item.candles,
          startDate,
          endDate,
          initialCapital,
          years: args.years,
          minTradeUsd: args.minTradeUsd,
          feePct: args.feePct,
          ignoreSlopeHoldThreshold: args.ignoreSlopeHoldThreshold,
          slopeHoldMode: args.slopeHoldMode,
          slopeLowLimit: args.slopeLowLimit,
        });
      });

  const initialTotal = results.reduce((sum, row) => sum + row.initialCapital, 0);
  const strategyFinalTotal = slopeAllocationBacktest
    ? slopeAllocationBacktest.finalValue
    : dynamicBacktest
    ? dynamicBacktest.finalValue
    : results.reduce((sum, row) => sum + row.finalValue, 0);
  const strategyPortfolioReturnPct = ((strategyFinalTotal - initialTotal) / initialTotal) * 100;
  const allocationBuyHoldFinalTotal = results.reduce((sum, row) => {
    return sum + row.initialCapital * (1 + row.buyHoldReturnPct / 100);
  }, 0);
  const allocationBuyHoldReturnPct =
    ((allocationBuyHoldFinalTotal - initialTotal) / initialTotal) * 100;
  const bestAllIn = results.reduce(
    (best, row) => (best == null || row.buyHoldReturnPct > best.buyHoldReturnPct ? row : best),
    null
  );

  console.log("");
  console.log("Backtesting de estrategia");
  console.log(`Periodo: ${formatDate(startDate)} -> ${formatDate(endDate)}`);
  console.log(`Ventana de indicadores: ${args.years} anios moviles`);
  console.log(`Capital inicial usado: ${formatMoney(initialTotal)}`);
  console.log(`Minimo por trade: ${formatMoney(args.minTradeUsd)}`);
  console.log(`Fee simulado: ${(args.feePct * 100).toFixed(4)}%`);
  console.log(`Modo hold por slope: ${args.slopeHoldMode}`);
  console.log(`Limite low efectivo por slope: ${(args.slopeLowLimit * 100).toFixed(0)}%`);
  if (args.dynamicAllocation) {
    console.log(
      `Allocation dinamica: ${(DYNAMIC_BASE_WEIGHT * 100).toFixed(0)}% allocationPercentage + ${(DYNAMIC_SIGNAL_WEIGHT * 100).toFixed(0)}% slope/momentum`
    );
    console.log(`Caja final: ${formatMoney(dynamicBacktest.cashUsd)}`);
    if (args.cashYieldSymbol) {
      console.log(
        `Rendimiento cash ${args.cashYieldSymbol}: ${formatMoney(dynamicBacktest.cashYieldUsd ?? 0)} (${cashYieldEvents.length} eventos)`
      );
    }
    if (args.enhancedIncome) {
      console.log(`Ingresos netos SHV sobre 50% cash: ${formatMoney(dynamicBacktest.cashYieldUsd ?? 0)}`);
      console.log(`Interes USDT sobre 50% cash: ${formatMoney(dynamicBacktest.usdtInterestUsd ?? 0)}`);
      console.log(`Dividendos netos VOO: ${formatMoney(dynamicBacktest.assetDividendUsd ?? 0)}`);
      console.log(`Interes BTC unidades: ${(dynamicBacktest.btcInterestUnits ?? 0).toFixed(8)} BTC`);
      console.log(`Interes BNB unidades: ${(dynamicBacktest.bnbInterestUnits ?? 0).toFixed(8)} BNB`);
      console.log(`Impuesto dividendos asumido: ${(args.dividendTax * 100).toFixed(2)}%`);
    }
  }
  if (args.slopeAllocation) {
    console.log("Allocation por slope: 100% invertido, pesos = slope positivo / suma slopes positivos");
    console.log(`Minimo historial antes de iniciar: ${warmupYears} anios`);
    console.log(`Caja final: ${formatMoney(slopeAllocationBacktest.cashUsd)}`);
  }
  if (args.ignoreSlopeHoldThreshold) {
    console.log("Candados slope hold: desactivados para compras y ventas");
  }
  console.log("");
  printTable(results);
  console.log("");
  console.log(`Ganancia estrategia portafolio: ${formatPercent(strategyPortfolioReturnPct)}`);
  console.log(`Buy&Hold segun allocationPercentage: ${formatPercent(allocationBuyHoldReturnPct)}`);
  if (bestAllIn) {
    console.log(
      `Mejor all-in en un solo activo: ${bestAllIn.symbol} (${formatPercent(bestAllIn.buyHoldReturnPct)})`
    );
  }

  if (args.exportCsv) {
    const exportBase = path.resolve(args.exportCsv);
    const summaryRows = results.map(row => ({
      symbol: row.symbol,
      allocationPercentage: formatCsvNumber(row.allocationPercentage, 2),
      initialSlope: formatCsvNumber(row.initialSlope, 6),
      initialWeight: formatCsvNumber((row.initialWeight ?? 0) * 100, 4),
      initialCapital: formatCsvNumber(row.initialCapital, 2),
      finalValue: formatCsvNumber(row.finalValue, 2),
      strategyReturnPct: formatCsvNumber(strategyPortfolioReturnPct, 2),
      buyHoldAllInPct: formatCsvNumber(row.buyHoldReturnPct, 2),
      trades: row.trades,
      buys: row.buys,
      sells: row.sells,
      firstDate: row.firstTradeDate,
      lastDate: row.lastTradeDate,
    }));

    writeCsv(`${exportBase}-summary.csv`, summaryRows);

    const activeTradeLog = slopeAllocationBacktest?.tradeLog ?? dynamicBacktest?.tradeLog ?? [];
    if (activeTradeLog.length) {
      writeCsv(
        `${exportBase}-trades.csv`,
        activeTradeLog.map(trade => ({
          date: trade.date,
          symbol: trade.symbol,
          action: trade.action,
          slope: formatCsvNumber(trade.slope, 6),
          targetWeight: formatCsvNumber((trade.targetWeight ?? 0) * 100, 4),
          actualUsd: formatCsvNumber(trade.actualUsd, 2),
          targetUsd: formatCsvNumber(trade.targetUsd, 2),
          diffUsd: formatCsvNumber(trade.diffUsd, 2),
          price: formatCsvNumber(trade.price, 8),
          tradeUsd: formatCsvNumber(trade.tradeUsd, 2),
          units: formatCsvNumber(trade.units, 8),
          portfolioValue: formatCsvNumber(trade.portfolioValue, 2),
        }))
      );
    }

    console.log("");
    console.log(`CSV exportado: ${exportBase}-summary.csv`);
    if (activeTradeLog.length) {
      console.log(`CSV exportado: ${exportBase}-trades.csv`);
    }
  }

  if (skipped.length) {
    console.log("");
    console.log("Assets omitidos:");
    for (const item of skipped) {
      console.log(`- ${item}`);
    }
  }

  console.log("");
  console.log("Notas:");
  console.log("- La estrategia empieza despues de tener la ventana completa del asset con menos historial.");
  if (args.slopeAllocation) {
    console.log("- El modo allocation por slope usa caja comun y mantiene el portafolio invertido entre activos.");
  } else if (args.dynamicAllocation) {
    console.log("- El modo dinamico usa caja comun y recalcula pesos efectivos con slope/momentum.");
  } else {
    console.log("- Cada asset arranca en efectivo segun su allocationPercentage y opera solo dentro de su bucket.");
  }
  console.log("- Buy&Hold all-in muestra el retorno si ese bucket se hubiera invertido completo en el activo al inicio.");
}

main()
  .catch(error => {
    console.error("");
    console.error("Error ejecutando backtest:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });

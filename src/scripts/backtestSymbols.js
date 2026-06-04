import axios from "axios";
import fs from "node:fs";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_TOLERANCE = 1e-8;
const DEFAULT_CAPITAL = 10000;
const DEFAULT_YEARS = 1;
const DEFAULT_SLOPE_LOW_LIMIT = 0.9;
const DEFAULT_MIN_TRADE_USD = 10;
const SLOPE_HOLD_MODES = new Set(["linear", "sqrt", "multiplier"]);
const DEFAULT_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "ADAUSDT",
  "NVDA",
  "AAPL",
  "VOO",
  "TLT",
  "GLD",
];

function parseArgs(argv) {
  const args = {
    capital: DEFAULT_CAPITAL,
    years: DEFAULT_YEARS,
    slopeLowLimit: DEFAULT_SLOPE_LOW_LIMIT,
    minTradeUsd: DEFAULT_MIN_TRADE_USD,
    slopeHoldMode: "linear",
    portfolioSlopeAllocation: false,
    portfolioDynamicAllocation: false,
    minHistoryYears: 3,
    exportCsv: null,
    from: null,
    to: null,
    rebalance: "daily",
    cryptoFee: 0,
    otherFee: 0,
    symbols: DEFAULT_SYMBOLS,
    cashYieldSymbol: null,
    dividendTax: 0.3,
  };

  for (const arg of argv) {
    const [key, rawValue] = arg.replace(/^--/, "").split("=");
    if (!key || rawValue == null) continue;
    if (key === "capital") args.capital = Number(rawValue);
    if (key === "years") args.years = Number(rawValue);
    if (key === "slope-low-limit") args.slopeLowLimit = Number(rawValue);
    if (key === "min-trade") args.minTradeUsd = Number(rawValue);
    if (key === "slope-hold-mode") args.slopeHoldMode = rawValue;
    if (key === "portfolio-slope-allocation") args.portfolioSlopeAllocation = rawValue !== "false" && rawValue !== "0";
    if (key === "portfolio-dynamic-allocation") args.portfolioDynamicAllocation = rawValue !== "false" && rawValue !== "0";
    if (key === "min-history-years") args.minHistoryYears = Number(rawValue);
    if (key === "export-csv") args.exportCsv = rawValue;
    if (key === "from") args.from = rawValue;
    if (key === "to") args.to = rawValue;
    if (key === "rebalance") args.rebalance = rawValue;
    if (key === "crypto-fee") args.cryptoFee = Number(rawValue);
    if (key === "other-fee") args.otherFee = Number(rawValue);
    if (key === "symbols") args.symbols = rawValue.split(",").map(item => item.trim()).filter(Boolean);
    if (key === "cash-yield-symbol") args.cashYieldSymbol = rawValue.toUpperCase();
    if (key === "dividend-tax") args.dividendTax = Number(rawValue);
  }

  return args;
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

function formatPercent(value) {
  if (!Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatCsvNumber(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return number.toFixed(decimals).replace(".", ",");
}

function escapeCsvValue(value) {
  const text = String(value ?? "");
  if (/[;"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
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

function isCryptoSymbol(symbol) {
  return symbol.endsWith("USDT");
}

function normalizeCandles(candles) {
  const byDay = new Map();
  for (const candle of candles) {
    const close = Number(candle.close);
    const time = new Date(candle.closeTime).getTime();
    if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(time)) continue;
    const day = toUtcDay(time);
    byDay.set(day.getTime(), { closeTime: day, close });
  }
  return Array.from(byDay.values()).sort((a, b) => a.closeTime - b.closeTime);
}

async function fetchBinanceDailyCandles(symbol) {
  const interval = "1d";
  const limit = 1000;
  const now = Date.now();
  let startTime = 0;
  let all = [];

  while (true) {
    const res = await axios.get("https://api.binance.com/api/v3/klines", {
      params: { symbol, interval, startTime, limit },
      timeout: 30000,
    });
    const candles = res.data.map(candle => ({
      closeTime: new Date(candle[6]),
      close: Number(candle[4]),
    }));
    if (!candles.length) break;
    all = all.concat(candles);
    startTime = candles[candles.length - 1].closeTime.getTime() + 1;
    if (startTime >= now || candles.length < limit) break;
  }

  return normalizeCandles(all);
}

async function fetchYahooDailyCandles(symbol) {
  const period1 = 0;
  const period2 = Math.floor((Date.now() + DAY_MS) / 1000);
  const res = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`,
    { timeout: 30000 }
  );
  const result = res.data?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const candles = timestamps
    .map((timestamp, index) => ({
      closeTime: new Date(timestamp * 1000),
      close: Number(closes[index]),
    }))
    .filter(candle => Number.isFinite(candle.close) && candle.close > 0);

  return normalizeCandles(candles);
}

async function fetchYahooDividends(symbol, startDate, endDate) {
  const period1 = Math.floor(toUtcDay(startDate).getTime() / 1000);
  const period2 = Math.floor((toUtcDay(endDate).getTime() + DAY_MS) / 1000);
  const res = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}&events=div`,
    { timeout: 30000 }
  );
  const result = res.data?.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const dividends = result?.events?.dividends ?? {};
  const priceByDay = new Map();

  timestamps.forEach((timestamp, index) => {
    const close = Number(closes[index]);
    if (Number.isFinite(close) && close > 0) {
      priceByDay.set(toUtcDay(timestamp * 1000).getTime(), close);
    }
  });

  return Object.values(dividends)
    .map(dividend => {
      const date = toUtcDay(Number(dividend.date) * 1000);
      const amount = Number(dividend.amount);
      const price = priceByDay.get(date.getTime()) ?? null;
      if (!Number.isFinite(amount) || amount <= 0 || !price) return null;
      return { date, amount, price, yieldFraction: amount / price };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function fetchCandles(symbol) {
  return isCryptoSymbol(symbol)
    ? fetchBinanceDailyCandles(symbol)
    : fetchYahooDailyCandles(symbol);
}

function calculateRollingHighLow(candles, asOfDate, years) {
  const asOfMs = toUtcDay(asOfDate).getTime();
  const cutoff = subtractYears(new Date(asOfMs), years).getTime();
  const drawdownCutoff = subtractYears(new Date(asOfMs), 5).getTime();
  const highWindow = candles.filter(c => c.closeTime.getTime() >= cutoff && c.closeTime.getTime() <= asOfMs);
  if (!highWindow.length) return null;

  const high = Math.max(...highWindow.map(c => c.close));
  const drawdownWindow = candles.filter(
    c => c.closeTime.getTime() >= drawdownCutoff && c.closeTime.getTime() <= asOfMs
  );
  let runningHigh = null;
  let maxDrawdownPercent = 0;

  for (const candle of drawdownWindow) {
    if (runningHigh == null || candle.close > runningHigh) runningHigh = candle.close;
    if (runningHigh > 0) {
      maxDrawdownPercent = Math.max(maxDrawdownPercent, (runningHigh - candle.close) / runningHigh);
    }
  }

  return { high, low: high * (1 - maxDrawdownPercent) };
}

function calculateSlope(candles, asOfDate, years, type) {
  const asOfMs = toUtcDay(asOfDate).getTime();
  const window = candles.filter(
    c => c.closeTime.getTime() <= asOfMs && c.close > 0
  );
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
  const annualizationDays = type === "crypto" ? 365 : 252;
  return (Math.exp(slope * annualizationDays) - 1) * 100;
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

function applySlopeHoldThreshold({ targetBaseUsd, actualBaseUsd, allocation, baseHoldUsd, quoteHoldUsd, maxBaseAllowed }) {
  const rawTargetBaseUsd = clamp(targetBaseUsd, 0, allocation);
  const rawBaseDiffUsd = rawTargetBaseUsd - actualBaseUsd;
  let effectiveTargetBaseUsd = rawTargetBaseUsd;

  if (rawBaseDiffUsd < -BASE_TOLERANCE && baseHoldUsd > 0) {
    const adjustedSellUsd = Math.abs(rawBaseDiffUsd) - baseHoldUsd;
    effectiveTargetBaseUsd =
      adjustedSellUsd > BASE_TOLERANCE ? Math.max(actualBaseUsd - adjustedSellUsd, 0) : actualBaseUsd;
  } else if (rawBaseDiffUsd > BASE_TOLERANCE && quoteHoldUsd > 0) {
    const adjustedBuyUsd = rawBaseDiffUsd - quoteHoldUsd;
    effectiveTargetBaseUsd =
      adjustedBuyUsd > BASE_TOLERANCE ? Math.min(actualBaseUsd + adjustedBuyUsd, maxBaseAllowed) : actualBaseUsd;
  } else if (quoteHoldUsd > 0 && rawBaseDiffUsd < -BASE_TOLERANCE) {
    effectiveTargetBaseUsd = Math.min(rawTargetBaseUsd, maxBaseAllowed);
  }

  return { baseDiffUsd: effectiveTargetBaseUsd - actualBaseUsd };
}

function getDecisionLow(low, high, slopeFraction, slopeLowLimit) {
  if (slopeFraction <= 0 || slopeLowLimit <= 0) return low;
  return low + (high - low) * clamp(slopeFraction, 0, slopeLowLimit);
}

function getDecisionBounds(low, high, slopeFraction, slopeLowLimit) {
  if (
    !Number.isFinite(low) ||
    !Number.isFinite(high) ||
    high <= low ||
    !Number.isFinite(slopeFraction) ||
    slopeLowLimit <= 0
  ) {
    return { decisionLow: low, decisionHigh: high };
  }

  const adjustment = clamp(Math.abs(slopeFraction), 0, slopeLowLimit);
  if (slopeFraction > 0) {
    return {
      decisionLow: low + (high - low) * adjustment,
      decisionHigh: high,
    };
  }
  if (slopeFraction < 0) {
    return {
      decisionLow: low,
      decisionHigh: high - (high - low) * adjustment,
    };
  }
  return { decisionLow: low, decisionHigh: high };
}

function getSlopeHoldFraction(slopeFraction, mode) {
  const absFraction = Math.min(Math.abs(slopeFraction), 1);
  if (mode === "sqrt") return Math.sqrt(absFraction);
  if (mode === "multiplier") return Math.min(1, absFraction * 1.5);
  return absFraction;
}

function runBacktest({ symbol, candles, capital, years, slopeLowLimit, minTradeUsd, slopeHoldMode, cashYieldEvents = [], dividendTax = 0.3 }) {
  const type = isCryptoSymbol(symbol) ? "crypto" : "stock";
  const startDate = addYears(candles[0].closeTime, years);
  const endDate = candles[candles.length - 1].closeTime;
  const testCandles = candles.filter(c => c.closeTime >= startDate && c.closeTime <= endDate);
  if (testCandles.length < 2) throw new Error(`${symbol}: historial insuficiente`);
  const eligibleCashYieldEvents = cashYieldEvents.filter(
    event => event.date.getTime() >= testCandles[0].closeTime.getTime()
  );

  let baseUnits = 0;
  let quoteUsd = capital;
  let trades = 0;
  let buys = 0;
  let sells = 0;
  let slopeSum = 0;
  let slopeCount = 0;
  let cashYieldEventIndex = 0;
  let cashYieldUsd = 0;

  for (const candle of testCandles) {
    const yieldResult = applyCashYield(quoteUsd, eligibleCashYieldEvents, cashYieldEventIndex, candle.closeTime, dividendTax);
    quoteUsd = yieldResult.cash;
    cashYieldEventIndex = yieldResult.eventIndex;
    cashYieldUsd += yieldResult.earned;

    const price = candle.close;
    const indicators = calculateRollingHighLow(candles, candle.closeTime, years);
    if (!indicators) continue;

    const slope = calculateSlope(candles, candle.closeTime, years, type);
    const slopeFraction = slope / 100;
    const actualBaseUsd = baseUnits * price;
    const allocation = actualBaseUsd + quoteUsd;
    if (allocation <= BASE_TOLERANCE) continue;

    const slopeHoldFraction = getSlopeHoldFraction(slopeFraction, slopeHoldMode);
    const baseHoldFraction = slopeFraction > 0 ? slopeHoldFraction : 0;
    const quoteHoldFraction = slopeFraction < 0 ? slopeHoldFraction : 0;
    const baseHoldUsd = allocation * baseHoldFraction;
    const quoteHoldUsd = allocation * quoteHoldFraction;
    const maxBaseAllowed = Math.max(allocation - quoteHoldUsd, 0);
    const { decisionLow, decisionHigh } = getDecisionBounds(indicators.low, indicators.high, slopeFraction, slopeLowLimit);
    const priceRange = decisionHigh - decisionLow;
    const normalized = priceRange === 0 ? 0.5 : clamp((price - decisionLow) / priceRange, 0, 1);
    const desiredBaseUsd = allocation * clamp(1 - normalized, 0, 1);
    const { baseDiffUsd } = applySlopeHoldThreshold({
      targetBaseUsd: desiredBaseUsd,
      actualBaseUsd,
      allocation,
      baseHoldUsd,
      quoteHoldUsd,
      maxBaseAllowed,
    });

    slopeSum += slope;
    slopeCount += 1;

    if (Math.abs(baseDiffUsd) < minTradeUsd) continue;
    if (baseDiffUsd > BASE_TOLERANCE) {
      const buyUsd = Math.min(baseDiffUsd, quoteUsd);
      if (buyUsd < minTradeUsd) continue;
      baseUnits += buyUsd / price;
      quoteUsd -= buyUsd;
      trades += 1;
      buys += 1;
    } else if (baseDiffUsd < -BASE_TOLERANCE) {
      const sellUsd = Math.min(-baseDiffUsd, actualBaseUsd);
      if (sellUsd < minTradeUsd) continue;
      baseUnits = Math.max(baseUnits - sellUsd / price, 0);
      quoteUsd += sellUsd;
      trades += 1;
      sells += 1;
    }
  }

  const firstPrice = testCandles[0].close;
  const lastPrice = testCandles[testCandles.length - 1].close;
  const finalValue = quoteUsd + baseUnits * lastPrice;

  return {
    symbol,
    start: formatDate(testCandles[0].closeTime),
    end: formatDate(testCandles[testCandles.length - 1].closeTime),
    currentSlope: calculateSlope(candles, endDate, years, type),
    averageSlope: slopeCount ? slopeSum / slopeCount : 0,
    strategyPct: ((finalValue - capital) / capital) * 100,
    allInPct: ((lastPrice / firstPrice) - 1) * 100,
    trades,
    buys,
    sells,
    cashYieldUsd,
  };
}

function getSimulationDates(assetData, startDate, endDate) {
  const startMs = toUtcDay(startDate).getTime();
  const endMs = toUtcDay(endDate).getTime();
  return Array.from(
    new Set(
      assetData.flatMap(item =>
        item.candles
          .filter(candle => {
            const time = candle.closeTime.getTime();
            return time >= startMs && time <= endMs;
          })
          .map(candle => candle.closeTime.getTime())
      )
    )
  )
    .sort((a, b) => a - b)
    .map(time => new Date(time));
}

function filterRebalanceDates(dates, frequency) {
  if (frequency === "daily") return dates;

  const selected = [];
  const seen = new Set();

  for (const date of dates) {
    const key =
      frequency === "monthly"
        ? `${date.getUTCFullYear()}-${date.getUTCMonth()}`
        : (() => {
            const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
            const dayOfWeek = day.getUTCDay() || 7;
            day.setUTCDate(day.getUTCDate() - dayOfWeek + 1);
            return formatDate(day);
          })();

    if (!seen.has(key)) {
      seen.add(key);
      selected.push(date);
    }
  }

  const lastDate = dates.at(-1);
  if (lastDate && selected.at(-1)?.getTime() !== lastDate.getTime()) {
    selected.push(lastDate);
  }

  return selected;
}

function feeRateForSymbol(symbol, cryptoFee, otherFee) {
  return isCryptoSymbol(symbol) ? cryptoFee : otherFee;
}

function applyCashYield(cash, cashYieldEvents, eventIndex, date, dividendTax) {
  let nextIndex = eventIndex;
  let nextCash = cash;
  let earned = 0;
  while (
    nextIndex < cashYieldEvents.length &&
    cashYieldEvents[nextIndex].date.getTime() <= date.getTime()
  ) {
    const event = cashYieldEvents[nextIndex];
    if (nextCash > BASE_TOLERANCE) {
      const dividendUsd = nextCash * event.yieldFraction * (1 - dividendTax);
      nextCash += dividendUsd;
      earned += dividendUsd;
    }
    nextIndex += 1;
  }
  return { cash: nextCash, eventIndex: nextIndex, earned };
}

function runPortfolioSlopeAllocation({
  assetData,
  capital,
  minHistoryYears,
  minTradeUsd,
  years,
  from,
  to,
  rebalance,
  cryptoFee,
  otherFee,
  cashYieldEvents = [],
  dividendTax = 0.3,
}) {
  const automaticStart = new Date(Math.max(...assetData.map(item => addYears(item.candles[0].closeTime, minHistoryYears).getTime())));
  const automaticEnd = new Date(Math.min(...assetData.map(item => item.candles.at(-1).closeTime.getTime())));
  const requestedStart = from ? toUtcDay(from) : automaticStart;
  const requestedEnd = to ? toUtcDay(to) : automaticEnd;
  const startDate = new Date(Math.max(automaticStart.getTime(), requestedStart.getTime()));
  const endDate = new Date(Math.min(automaticEnd.getTime(), requestedEnd.getTime()));
  const allDates = getSimulationDates(assetData, startDate, endDate);
  const dates = filterRebalanceDates(allDates, rebalance);
  if (dates.length < 2) throw new Error("No hay suficientes fechas para el portafolio");

  const holdings = new Map(assetData.map(item => [item.symbol, 0]));
  const stats = new Map(assetData.map(item => [item.symbol, { trades: 0, buys: 0, sells: 0, buyHoldPct: 0 }]));
  const tradeLog = [];
  let cash = capital;
  let cashYieldEventIndex = 0;
  let cashYieldUsd = 0;
  let lastPrices = new Map();
  const firstDate = dates[0];
  const lastDate = dates.at(-1);
  const eligibleCashYieldEvents = cashYieldEvents.filter(
    event => event.date.getTime() >= firstDate.getTime()
  );
  const initialSlopeRows = assetData.map(item => ({
    symbol: item.symbol,
    slope: Math.max(calculateSlope(item.candles, firstDate, years, isCryptoSymbol(item.symbol) ? "crypto" : "stock"), 0),
  }));
  const initialSlopeTotal = initialSlopeRows.reduce((sum, row) => sum + row.slope, 0);
  const initialWeight = new Map(
    initialSlopeRows.map(row => [row.symbol, initialSlopeTotal > BASE_TOLERANCE ? row.slope / initialSlopeTotal : 1 / assetData.length])
  );
  const initialSlope = new Map(initialSlopeRows.map(row => [row.symbol, row.slope]));

  for (const item of assetData) {
    const firstPrice = getPriceAtOrBefore(item.candles, firstDate);
    const lastPrice = getPriceAtOrBefore(item.candles, lastDate);
    stats.get(item.symbol).buyHoldPct = firstPrice && lastPrice ? (lastPrice / firstPrice - 1) * 100 : 0;
  }

  for (const date of dates) {
    const yieldResult = applyCashYield(cash, eligibleCashYieldEvents, cashYieldEventIndex, date, dividendTax);
    cash = yieldResult.cash;
    cashYieldEventIndex = yieldResult.eventIndex;
    cashYieldUsd += yieldResult.earned;

    const prices = new Map();
    const slopeRows = [];
    for (const item of assetData) {
      const price = getPriceAtOrBefore(item.candles, date);
      if (price && price > 0) {
        prices.set(item.symbol, price);
        lastPrices.set(item.symbol, price);
      }
      slopeRows.push({
        symbol: item.symbol,
        slope: Math.max(calculateSlope(item.candles, date, years, isCryptoSymbol(item.symbol) ? "crypto" : "stock"), 0),
      });
    }
    if (prices.size !== assetData.length) continue;

    let portfolioValue = cash;
    for (const item of assetData) {
      portfolioValue += (holdings.get(item.symbol) ?? 0) * prices.get(item.symbol);
    }
    const slopeTotal = slopeRows.reduce((sum, row) => sum + row.slope, 0);
    const weights = new Map(slopeRows.map(row => [row.symbol, slopeTotal > BASE_TOLERANCE ? row.slope / slopeTotal : 1 / assetData.length]));
    const planned = [];
    for (const item of assetData) {
      const actualUsd = (holdings.get(item.symbol) ?? 0) * prices.get(item.symbol);
      const targetUsd = portfolioValue * (weights.get(item.symbol) ?? 0);
      const diffUsd = targetUsd - actualUsd;
      if (Math.abs(diffUsd) >= minTradeUsd) {
        planned.push({
          symbol: item.symbol,
          price: prices.get(item.symbol),
          diffUsd,
          slope: slopeRows.find(row => row.symbol === item.symbol)?.slope ?? 0,
          targetWeight: weights.get(item.symbol) ?? 0,
          actualUsd,
          targetUsd,
        });
      }
    }

    for (const trade of planned.filter(item => item.diffUsd < -BASE_TOLERANCE)) {
      const units = holdings.get(trade.symbol) ?? 0;
      const sellUsd = Math.min(-trade.diffUsd, units * trade.price);
      if (sellUsd < minTradeUsd) continue;
      const feeUsd = sellUsd * feeRateForSymbol(trade.symbol, cryptoFee, otherFee);
      holdings.set(trade.symbol, Math.max(units - sellUsd / trade.price, 0));
      cash += Math.max(sellUsd - feeUsd, 0);
      const rowStats = stats.get(trade.symbol);
      rowStats.trades += 1;
      rowStats.sells += 1;
      tradeLog.push({ date: formatDate(date), action: "sell", tradeUsd: sellUsd, feeUsd, units: sellUsd / trade.price, portfolioValue, ...trade });
    }
    for (const trade of planned.filter(item => item.diffUsd > BASE_TOLERANCE)) {
      const buyUsd = Math.min(trade.diffUsd, cash);
      if (buyUsd < minTradeUsd) continue;
      const feeUsd = buyUsd * feeRateForSymbol(trade.symbol, cryptoFee, otherFee);
      holdings.set(trade.symbol, (holdings.get(trade.symbol) ?? 0) + Math.max(buyUsd - feeUsd, 0) / trade.price);
      cash -= buyUsd;
      const rowStats = stats.get(trade.symbol);
      rowStats.trades += 1;
      rowStats.buys += 1;
      tradeLog.push({ date: formatDate(date), action: "buy", tradeUsd: buyUsd, feeUsd, units: Math.max(buyUsd - feeUsd, 0) / trade.price, portfolioValue, ...trade });
    }
  }

  const finalValue = assetData.reduce(
    (sum, item) => sum + (holdings.get(item.symbol) ?? 0) * (lastPrices.get(item.symbol) ?? 0),
    cash
  );
  const results = assetData.map(item => {
    const rowStats = stats.get(item.symbol);
    return {
      symbol: item.symbol,
      initialSlope: initialSlope.get(item.symbol) ?? 0,
      initialWeight: initialWeight.get(item.symbol) ?? 0,
      initialCapital: capital * (initialWeight.get(item.symbol) ?? 0),
      finalValue: (holdings.get(item.symbol) ?? 0) * (lastPrices.get(item.symbol) ?? 0),
      strategyPct: (finalValue / capital - 1) * 100,
      buyHoldPct: rowStats.buyHoldPct,
      trades: rowStats.trades,
      buys: rowStats.buys,
      sells: rowStats.sells,
      firstDate: formatDate(firstDate),
      lastDate: formatDate(lastDate),
    };
  });

  return { results, tradeLog, finalValue, cash, firstDate, lastDate, cashYieldUsd };
}

function getMomentumReturn(candles, asOfDate, years) {
  const currentPrice = getPriceAtOrBefore(candles, asOfDate);
  const previousPrice = getPriceAtOrBefore(candles, subtractYears(toUtcDay(asOfDate), years));
  if (!currentPrice || !previousPrice || previousPrice <= 0) return 0;
  return currentPrice / previousPrice - 1;
}

function runPortfolioDynamicAllocation({
  assetData,
  capital,
  minHistoryYears,
  minTradeUsd,
  years,
  slopeLowLimit,
  slopeHoldMode,
  from,
  to,
  rebalance,
  cryptoFee,
  otherFee,
  cashYieldEvents = [],
  dividendTax = 0.3,
}) {
  const automaticStart = new Date(Math.max(...assetData.map(item => addYears(item.candles[0].closeTime, minHistoryYears).getTime())));
  const automaticEnd = new Date(Math.min(...assetData.map(item => item.candles.at(-1).closeTime.getTime())));
  const requestedStart = from ? toUtcDay(from) : automaticStart;
  const requestedEnd = to ? toUtcDay(to) : automaticEnd;
  const startDate = new Date(Math.max(automaticStart.getTime(), requestedStart.getTime()));
  const endDate = new Date(Math.min(automaticEnd.getTime(), requestedEnd.getTime()));
  const dates = filterRebalanceDates(getSimulationDates(assetData, startDate, endDate), rebalance);
  if (dates.length < 2) throw new Error("No hay suficientes fechas para el portafolio dinamico");

  const holdings = new Map(assetData.map(item => [item.symbol, 0]));
  const stats = new Map(assetData.map(item => [item.symbol, { trades: 0, buys: 0, sells: 0, buyHoldPct: 0 }]));
  let cash = capital;
  let cashYieldEventIndex = 0;
  let cashYieldUsd = 0;
  let lastPrices = new Map();
  const firstDate = dates[0];
  const lastDate = dates.at(-1);
  const eligibleCashYieldEvents = cashYieldEvents.filter(
    event => event.date.getTime() >= firstDate.getTime()
  );
  const baseWeight = 1 / assetData.length;

  for (const item of assetData) {
    const firstPrice = getPriceAtOrBefore(item.candles, firstDate);
    const lastPrice = getPriceAtOrBefore(item.candles, lastDate);
    stats.get(item.symbol).buyHoldPct = firstPrice && lastPrice ? (lastPrice / firstPrice - 1) * 100 : 0;
  }

  for (const date of dates) {
    const yieldResult = applyCashYield(cash, eligibleCashYieldEvents, cashYieldEventIndex, date, dividendTax);
    cash = yieldResult.cash;
    cashYieldEventIndex = yieldResult.eventIndex;
    cashYieldUsd += yieldResult.earned;

    const prices = new Map();
    const signalRows = [];
    for (const item of assetData) {
      const type = isCryptoSymbol(item.symbol) ? "crypto" : "stock";
      const price = getPriceAtOrBefore(item.candles, date);
      if (price && price > 0) {
        prices.set(item.symbol, price);
        lastPrices.set(item.symbol, price);
      }
      const slopeValue = calculateSlope(item.candles, date, years, type);
      const momentum = getMomentumReturn(item.candles, date, years);
      signalRows.push({
        item,
        symbol: item.symbol,
        slope: slopeValue,
        signal: Math.max(0, slopeValue / 100) + Math.max(0, momentum),
      });
    }
    if (prices.size !== assetData.length) continue;

    let portfolioValue = cash;
    for (const item of assetData) {
      portfolioValue += (holdings.get(item.symbol) ?? 0) * prices.get(item.symbol);
    }

    const signalTotal = signalRows.reduce((sum, row) => sum + row.signal, 0);
    const weights = new Map(
      signalRows.map(row => [
        row.symbol,
        signalTotal > BASE_TOLERANCE
          ? 0.7 * baseWeight + 0.3 * (row.signal / signalTotal)
          : baseWeight,
      ])
    );
    const weightTotal = Array.from(weights.values()).reduce((sum, value) => sum + value, 0);
    for (const [symbol, weight] of weights) {
      weights.set(symbol, weight / weightTotal);
    }

    const planned = [];
    for (const row of signalRows) {
      const item = row.item;
      const price = prices.get(item.symbol);
      const bucketAllocation = portfolioValue * (weights.get(item.symbol) ?? 0);
      const indicators = calculateRollingHighLow(item.candles, date, years);
      if (!indicators || bucketAllocation <= BASE_TOLERANCE) continue;
      let { high, low } = indicators;
      if (low > high) [low, high] = [high, low];

      const slopeFraction = row.slope / 100;
      const slopeHoldFraction = getSlopeHoldFraction(slopeFraction, slopeHoldMode);
      const baseHoldFraction = slopeFraction > 0 ? slopeHoldFraction : 0;
      const quoteHoldFraction = slopeFraction < 0 ? slopeHoldFraction : 0;
      const baseHoldUsd = bucketAllocation * baseHoldFraction;
      const quoteHoldUsd = bucketAllocation * quoteHoldFraction;
      const maxBaseAllowed = Math.max(bucketAllocation - quoteHoldUsd, 0);
      const { decisionLow, decisionHigh } = getDecisionBounds(low, high, slopeFraction, slopeLowLimit);
      const priceRange = decisionHigh - decisionLow;
      const normalized = priceRange === 0 ? 0.5 : clamp((price - decisionLow) / priceRange, 0, 1);
      const desiredBaseUsd = bucketAllocation * clamp(1 - normalized, 0, 1);
      const actualUsd = (holdings.get(item.symbol) ?? 0) * price;
      const { baseDiffUsd } = applySlopeHoldThreshold({
        targetBaseUsd: desiredBaseUsd,
        actualBaseUsd: actualUsd,
        allocation: bucketAllocation,
        baseHoldUsd,
        quoteHoldUsd,
        maxBaseAllowed,
      });
      if (Math.abs(baseDiffUsd) >= minTradeUsd) {
        planned.push({
          symbol: item.symbol,
          price,
          diffUsd: baseDiffUsd,
        });
      }
    }

    for (const trade of planned.filter(item => item.diffUsd < -BASE_TOLERANCE)) {
      const units = holdings.get(trade.symbol) ?? 0;
      const sellUsd = Math.min(-trade.diffUsd, units * trade.price);
      if (sellUsd < minTradeUsd) continue;
      const feeUsd = sellUsd * feeRateForSymbol(trade.symbol, cryptoFee, otherFee);
      holdings.set(trade.symbol, Math.max(units - sellUsd / trade.price, 0));
      cash += Math.max(sellUsd - feeUsd, 0);
      const rowStats = stats.get(trade.symbol);
      rowStats.trades += 1;
      rowStats.sells += 1;
    }

    for (const trade of planned.filter(item => item.diffUsd > BASE_TOLERANCE)) {
      const buyUsd = Math.min(trade.diffUsd, cash);
      if (buyUsd < minTradeUsd) continue;
      const feeUsd = buyUsd * feeRateForSymbol(trade.symbol, cryptoFee, otherFee);
      holdings.set(trade.symbol, (holdings.get(trade.symbol) ?? 0) + Math.max(buyUsd - feeUsd, 0) / trade.price);
      cash -= buyUsd;
      const rowStats = stats.get(trade.symbol);
      rowStats.trades += 1;
      rowStats.buys += 1;
    }
  }

  const finalValue = assetData.reduce(
    (sum, item) => sum + (holdings.get(item.symbol) ?? 0) * (lastPrices.get(item.symbol) ?? 0),
    cash
  );
  const results = assetData.map(item => {
    const rowStats = stats.get(item.symbol);
    return {
      symbol: item.symbol,
      start: formatDate(firstDate),
      end: formatDate(lastDate),
      currentSlope: calculateSlope(item.candles, lastDate, years, isCryptoSymbol(item.symbol) ? "crypto" : "stock"),
      averageSlope: baseWeight * 100,
      strategyPct: (finalValue / capital - 1) * 100,
      allInPct: rowStats.buyHoldPct,
      trades: rowStats.trades,
    };
  });
  return { results, finalValue, cash, firstDate, lastDate, cashYieldUsd };
}

function printTable(rows) {
  const columns = [
    ["Symbol", row => row.symbol],
    ["Start", row => row.start],
    ["End", row => row.end],
    ["Slope Now", row => formatPercent(row.currentSlope)],
    ["Avg Slope", row => formatPercent(row.averageSlope)],
    ["Strategy", row => formatPercent(row.strategyPct)],
    ["All-in", row => formatPercent(row.allInPct)],
    ["Delta", row => formatPercent(row.strategyPct - row.allInPct)],
    ["Trades", row => String(row.trades)],
  ];
  const widths = columns.map(([header, getter]) => Math.max(header.length, ...rows.map(row => getter(row).length)));
  console.log(columns.map(([header], index) => header.padEnd(widths[index])).join(" | "));
  console.log(widths.map(width => "-".repeat(width)).join("-|-"));
  for (const row of rows) {
    console.log(columns.map(([, getter], index) => getter(row).padEnd(widths[index])).join(" | "));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!SLOPE_HOLD_MODES.has(args.slopeHoldMode)) {
    throw new Error("--slope-hold-mode debe ser linear, sqrt o multiplier");
  }
  const results = [];

  for (const symbol of args.symbols) {
    try {
      console.log(`Descargando ${symbol}...`);
      const candles = await fetchCandles(symbol);
      if (candles.length < 2) throw new Error("sin velas suficientes");
      results.push({ symbol, candles });
    } catch (error) {
      console.warn(`Omitido ${symbol}: ${error.message}`);
    }
  }

  const cashYieldEvents = args.cashYieldSymbol && results.length
    ? await fetchYahooDividends(
        args.cashYieldSymbol,
        new Date(Math.min(...results.map(item => item.candles[0].closeTime.getTime()))),
        new Date(Math.max(...results.map(item => item.candles.at(-1).closeTime.getTime())))
      )
    : [];

  if (args.portfolioSlopeAllocation || args.portfolioDynamicAllocation) {
    const runner = args.portfolioSlopeAllocation ? runPortfolioSlopeAllocation : runPortfolioDynamicAllocation;
    const backtest = runner({
      assetData: results,
      capital: args.capital,
      minHistoryYears: args.minHistoryYears,
      minTradeUsd: args.minTradeUsd,
      years: args.years,
      from: args.from,
      to: args.to,
      rebalance: args.rebalance,
      cryptoFee: args.cryptoFee,
      otherFee: args.otherFee,
      slopeLowLimit: args.slopeLowLimit,
      slopeHoldMode: args.slopeHoldMode,
      cashYieldEvents,
      dividendTax: args.dividendTax,
    });
    const strategyPct = (backtest.finalValue / args.capital - 1) * 100;
    console.log("");
    console.log(`${args.portfolioSlopeAllocation ? "Portfolio slope allocation" : "Portfolio dynamic allocation"}: ${formatDate(backtest.firstDate)} -> ${formatDate(backtest.lastDate)}`);
    console.log(`Rebalance: ${args.rebalance}. Crypto fee: ${(args.cryptoFee * 100).toFixed(4)}%. Other fee: ${(args.otherFee * 100).toFixed(4)}%`);
    console.log(`Final: $${backtest.finalValue.toFixed(2)} Retorno: ${formatPercent(strategyPct)} Cash: $${backtest.cash.toFixed(2)}`);
    if (args.cashYieldSymbol) {
      console.log(
        `Rendimiento neto cash ${args.cashYieldSymbol}: $${(backtest.cashYieldUsd ?? 0).toFixed(2)} (${cashYieldEvents.length} eventos, impuesto ${(args.dividendTax * 100).toFixed(2)}%)`
      );
    }
    printTable(backtest.results.map(row => ({
      symbol: row.symbol,
      start: row.firstDate ?? row.start,
      end: row.lastDate ?? row.end,
      currentSlope: row.initialSlope ?? row.currentSlope,
      averageSlope: row.initialWeight != null ? row.initialWeight * 100 : row.averageSlope,
      strategyPct,
      allInPct: row.buyHoldPct ?? row.allInPct,
      trades: row.trades,
    })));

    if (args.exportCsv) {
      const exportBase = path.resolve(args.exportCsv);
      writeCsv(`${exportBase}-summary.csv`, backtest.results.map(row => ({
        symbol: row.symbol,
        initialSlope: formatCsvNumber(row.initialSlope, 6),
        initialWeight: formatCsvNumber(row.initialWeight * 100, 4),
        initialCapital: formatCsvNumber(row.initialCapital, 2),
        finalValue: formatCsvNumber(row.finalValue, 2),
        strategyReturnPct: formatCsvNumber(strategyPct, 2),
        buyHoldAllInPct: formatCsvNumber(row.buyHoldPct, 2),
        trades: row.trades,
        buys: row.buys,
        sells: row.sells,
        firstDate: row.firstDate,
        lastDate: row.lastDate,
      })));
      if (backtest.tradeLog?.length) {
        writeCsv(`${exportBase}-trades.csv`, backtest.tradeLog.map(trade => ({
        date: trade.date,
        symbol: trade.symbol,
        action: trade.action,
        slope: formatCsvNumber(trade.slope, 6),
        targetWeight: formatCsvNumber(trade.targetWeight * 100, 4),
        actualUsd: formatCsvNumber(trade.actualUsd, 2),
        targetUsd: formatCsvNumber(trade.targetUsd, 2),
        diffUsd: formatCsvNumber(trade.diffUsd, 2),
        price: formatCsvNumber(trade.price, 8),
        tradeUsd: formatCsvNumber(trade.tradeUsd, 2),
        feeUsd: formatCsvNumber(trade.feeUsd, 2),
        units: formatCsvNumber(trade.units, 8),
        portfolioValue: formatCsvNumber(trade.portfolioValue, 2),
        })));
      }
      console.log(`CSV exportado: ${exportBase}-summary.csv`);
      if (backtest.tradeLog?.length) {
        console.log(`CSV exportado: ${exportBase}-trades.csv`);
      }
    }
    return;
  }

  const independentResults = results.map(item => runBacktest({
    symbol: item.symbol,
    candles: item.candles,
    ...args,
    cashYieldEvents,
    dividendTax: args.dividendTax,
  }));
  console.log("");
  console.log(
    `Backtest independiente por activo: capital $${args.capital}, years=${args.years}, slope-low-limit=${args.slopeLowLimit}, slope-hold-mode=${args.slopeHoldMode}`
  );
  if (args.cashYieldSymbol) {
    console.log(`Cash inactivo en ${args.cashYieldSymbol}: ${cashYieldEvents.length} eventos, impuesto ${(args.dividendTax * 100).toFixed(2)}%`);
  }
  printTable(independentResults.sort((a, b) => b.strategyPct - a.strategyPct));
}

main().catch(error => {
  console.error("Error:", error.message);
  process.exitCode = 1;
});

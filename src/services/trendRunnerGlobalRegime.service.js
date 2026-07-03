import TrendRunnerAsset from "../models/trendRunnerAsset.model.js";
import {
  TREND_RUNNER_PARAMS as P,
  TREND_RUNNER_UNIVERSE,
} from "./trendRunner.config.js";
import { fetchDailyBarsForAsset } from "./trendRunnerMarketData.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EMA200 = 200;
const STOCK_MARKETS = new Set(["etf", "stock", "adr"]);

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length
    ? clean.reduce((sum, value) => sum + value, 0) / clean.length
    : null;
}

function ema(values, length) {
  const result = Array(values.length).fill(null);
  const alpha = 2 / (length + 1);
  let current = null;
  const seed = [];

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;

    if (current === null) {
      seed.push(value);
      if (seed.length === length) {
        current = mean(seed);
        result[index] = current;
      }
    } else {
      current = alpha * value + (1 - alpha) * current;
      result[index] = current;
    }
  }

  return result;
}

function weekKey(dateText) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7);
  return `${date.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

function weeklyBarsFromDaily(bars) {
  const weeks = [];
  let currentKey = null;

  for (const bar of bars) {
    const key = weekKey(bar.date);
    if (key !== currentKey) {
      currentKey = key;
      weeks.push({ key, date: bar.date, close: bar.close });
    } else {
      const week = weeks.at(-1);
      week.date = bar.date;
      week.close = bar.close;
    }
  }

  return weeks;
}

function analyzeBenchmarkRegime(symbol, bars) {
  const cleanBars = bars
    .filter((bar) => bar?.date && Number.isFinite(Number(bar.close)) && Number(bar.close) > 0)
    .map((bar) => ({ ...bar, close: Number(bar.close) }));

  if (cleanBars.length < EMA200) {
    return {
      symbol,
      available: false,
      bearish: false,
      reason: "insufficient_daily_history",
      bars: cleanBars.length,
    };
  }

  const latestIndex = cleanBars.length - 1;
  const latestBar = cleanBars[latestIndex];
  const dailyEma = ema(cleanBars.map((bar) => bar.close), EMA200)[latestIndex];
  const dailyBearish = Number.isFinite(dailyEma) && latestBar.close < dailyEma;

  const weeks = weeklyBarsFromDaily(cleanBars);
  const weeklyEma = ema(weeks.map((week) => week.close), EMA200);
  const completedWeekIndex = weeks.length - 2;
  const completedWeek = completedWeekIndex >= 0 ? weeks[completedWeekIndex] : null;
  const completedWeeklyEma = completedWeekIndex >= 0 ? weeklyEma[completedWeekIndex] : null;
  const weeklyBearish = Boolean(
    completedWeek
    && Number.isFinite(completedWeeklyEma)
    && completedWeek.close < completedWeeklyEma
  );

  const reasons = [
    dailyBearish ? "daily_below_ema200" : null,
    weeklyBearish ? "weekly_below_ema200" : null,
  ].filter(Boolean);

  return {
    symbol,
    available: true,
    date: latestBar.date,
    close: latestBar.close,
    dailyEma200: dailyEma,
    weeklyDate: completedWeek?.date ?? null,
    weeklyClose: completedWeek?.close ?? null,
    weeklyEma200: completedWeeklyEma ?? null,
    dailyBearish,
    weeklyBearish,
    bearish: dailyBearish || weeklyBearish,
    reason: reasons.join("|"),
    bars: cleanBars.length,
    weeks: weeks.length,
  };
}

function combineRegime(group, states) {
  const availableStates = states.filter((state) => state.available);
  const bearishStates = availableStates.filter((state) => state.bearish);

  return {
    group,
    available: availableStates.length > 0,
    bearish: bearishStates.length > 0,
    reason: bearishStates
      .map((state) => `${state.symbol}:${state.reason || "bearish"}`)
      .join(";"),
    benchmarks: states,
  };
}

function shouldLoadEquityRegime(market) {
  return !market || market === "all" || market === "stocks" || STOCK_MARKETS.has(market);
}

function shouldLoadCryptoRegime(market) {
  return !market || market === "all" || market === "crypto";
}

async function resolveBenchmarkAsset(symbol) {
  const doc = await TrendRunnerAsset.findOne({ symbol });
  if (doc) return doc;

  const config = TREND_RUNNER_UNIVERSE.find((asset) => asset.symbol === symbol);
  if (config) return config;

  throw new Error(`Benchmark Trend Runner no encontrado: ${symbol}`);
}

async function loadBenchmarkState(symbol) {
  try {
    const asset = await resolveBenchmarkAsset(symbol);
    const bars = await fetchDailyBarsForAsset(asset);
    return analyzeBenchmarkRegime(symbol, bars);
  } catch (error) {
    return {
      symbol,
      available: false,
      bearish: false,
      reason: "benchmark_error",
      error: error.message,
    };
  }
}

export async function buildTrendRunnerGlobalRegimeContext({ market = "all" } = {}) {
  const [equityStates, cryptoStates] = await Promise.all([
    shouldLoadEquityRegime(market)
      ? Promise.all(["SPY", "QQQ"].map(loadBenchmarkState))
      : Promise.resolve([]),
    shouldLoadCryptoRegime(market)
      ? Promise.all(["BTCUSDT"].map(loadBenchmarkState))
      : Promise.resolve([]),
  ]);

  return {
    equity: combineRegime("equity", equityStates),
    crypto: combineRegime("crypto", cryptoStates),
  };
}

export function evaluateTrendRunnerGlobalRegime(asset, analysis, context) {
  if (!analysis?.signalType || !context) {
    return { allowed: true, bearish: false, reason: null };
  }

  const group = asset.market === "crypto" ? "crypto" : "equity";
  const regime = context[group];

  if (!regime?.available || !regime.bearish) {
    return {
      allowed: true,
      bearish: false,
      reason: regime?.available ? null : "global_regime_unavailable",
      regime,
    };
  }

  const holdScore = Number(analysis.hold?.score);
  const highQualityAllowed = (
    analysis.signalType === "Pullback + Breakout"
    && Number.isFinite(holdScore)
    && holdScore >= P.globalBearMinHoldScore
  );

  if (highQualityAllowed) {
    return {
      allowed: true,
      bearish: true,
      reason: "global_bear_regime_high_quality_allowed",
      regime,
    };
  }

  return {
    allowed: false,
    bearish: true,
    reason: analysis.signalType === "Reentrada"
      ? "global_bear_regime_reentry_disabled"
      : "global_bear_regime_requires_hold90_pullback_breakout",
    regime,
  };
}

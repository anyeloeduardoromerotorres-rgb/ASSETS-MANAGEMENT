import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import {
  TREND_RUNNER_PARAMS as P,
  TREND_RUNNER_PORTFOLIO,
  TREND_RUNNER_UNIVERSE,
} from "../services/trendRunner.config.js";
import { fetchDailyBarsForAsset } from "../services/trendRunnerMarketData.service.js";
import {
  adversePrice,
  calculateIndicators,
  historyConfig,
  regimeLost,
  signalAt,
} from "../services/trendRunnerIndicators.service.js";

const OUT_DIR = path.resolve("exports");
const DAY_MS = 24 * 60 * 60 * 1000;
const EPSILON = 1e-10;

const SETTINGS = {
  initialCash: 1100,
  backtestEndDate: isoDate(new Date(Date.now() - DAY_MS)),
  oldMinHistoryYears: 3,
  oldYears: 1,
  oldSlopeLowLimit: 0.9,
  oldSlopeHoldMode: "linear",
  oldMinTradeUsd: 10,
  concurrency: 6,
};

const CRISIS_PERIODS = [
  { name: "Dot-com / post burbuja", startDate: "2000-03-24", endDate: "2002-10-09" },
  { name: "Crisis financiera 2008", startDate: "2007-10-09", endDate: "2009-03-09" },
  { name: "COVID crash", startDate: "2020-02-19", endDate: "2020-03-23" },
  { name: "Bear market 2022", startDate: "2022-01-03", endDate: "2022-10-12" },
  { name: "Subida tasas 2022 completo", startDate: "2022-01-03", endDate: "2022-12-30" },
];

function round(value, decimals = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
}

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addYears(date, years) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

function yearsBetween(start, end) {
  return (new Date(end) - new Date(start)) / (365.25 * DAY_MS);
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
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

function maxDrawdown(rows, field = "equity") {
  let peak = -Infinity;
  let maxDd = 0;
  let troughDate = null;
  for (const row of rows) {
    const value = Number(row[field]);
    if (!Number.isFinite(value)) continue;
    peak = Math.max(peak, value);
    const dd = peak > 0 ? value / peak - 1 : 0;
    if (dd < maxDd) {
      maxDd = dd;
      troughDate = row.date;
    }
  }
  return { maxDrawdownPct: maxDd * 100, troughDate };
}

function weekKey(dateText) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / DAY_MS) + 1) / 7);
  return `${date.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

function benchmarkRegimeRows(symbol, bars) {
  const dailyEma200 = ema(bars.map((bar) => bar.close), 200);
  const weeks = [];
  const dailyWeekIndex = [];
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
    dailyWeekIndex.push(weeks.length - 1);
  }

  const weeklyEma200 = ema(weeks.map((week) => week.close), 200);

  return bars.map((bar, index) => {
    const completedWeekIndex = dailyWeekIndex[index] - 1;
    const dailyBearish = Number.isFinite(dailyEma200[index]) && bar.close < dailyEma200[index];
    const completedWeek = completedWeekIndex >= 0 ? weeks[completedWeekIndex] : null;
    const completedWeeklyEma = completedWeekIndex >= 0 ? weeklyEma200[completedWeekIndex] : null;
    const weeklyBearish = (
      completedWeek
      && Number.isFinite(completedWeeklyEma)
      && completedWeek.close < completedWeeklyEma
    );

    return {
      symbol,
      date: bar.date,
      close: bar.close,
      dailyEma200: dailyEma200[index],
      weeklyClose: completedWeek?.close ?? null,
      weeklyEma200: completedWeeklyEma,
      dailyBearish,
      weeklyBearish,
      bearish: Boolean(dailyBearish || weeklyBearish),
      reason: [
        dailyBearish ? "daily_below_ema200" : null,
        weeklyBearish ? "weekly_below_ema200" : null,
      ].filter(Boolean).join("|"),
    };
  });
}

function stateAtOrBefore(rows, date) {
  if (!rows?.length) return null;
  let low = 0;
  let high = rows.length - 1;
  let found = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle].date <= date) {
      found = rows[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function combineBenchmarkRegimeRows(group, benchmarkRows) {
  const allDates = [...new Set(Object.values(benchmarkRows).flatMap((rows) => rows.map((row) => row.date)))].sort();
  return allDates.map((date) => {
    const states = Object.entries(benchmarkRows)
      .map(([symbol, rows]) => ({ symbol, state: stateAtOrBefore(rows, date) }))
      .filter((row) => row.state);
    const bearishStates = states.filter((row) => row.state.bearish);
    return {
      group,
      date,
      bearish: bearishStates.length > 0,
      reason: bearishStates
        .map((row) => `${row.symbol}:${row.state.reason || "bearish"}`)
        .join(";"),
      benchmarks: states
        .map((row) => `${row.symbol}:${row.state.bearish ? "bear" : "ok"}`)
        .join(";"),
    };
  });
}

function buildGlobalRegime(finalCandidates) {
  const bySymbol = new Map(finalCandidates.map((candidate) => [candidate.asset.symbol, candidate]));
  const spy = bySymbol.get("SPY");
  const qqq = bySymbol.get("QQQ");
  const btc = bySymbol.get("BTCUSDT");

  const equityBenchmarkRows = {};
  if (spy) equityBenchmarkRows.SPY = benchmarkRegimeRows("SPY", spy.bars);
  if (qqq) equityBenchmarkRows.QQQ = benchmarkRegimeRows("QQQ", qqq.bars);

  const cryptoBenchmarkRows = {};
  if (btc) cryptoBenchmarkRows.BTCUSDT = benchmarkRegimeRows("BTCUSDT", btc.bars);

  return {
    equity: combineBenchmarkRegimeRows("equity", equityBenchmarkRows),
    crypto: combineBenchmarkRegimeRows("crypto", cryptoBenchmarkRows),
    benchmarks: [
      ...Object.values(equityBenchmarkRows).flat(),
      ...Object.values(cryptoBenchmarkRows).flat(),
    ],
  };
}

function globalRegimeState(globalRegime, market, date) {
  if (!globalRegime) return { bearish: false, reason: "", benchmarks: "" };
  const family = market === "crypto" ? "crypto" : "equity";
  const rows = globalRegime[family] ?? [];
  return stateAtOrBefore(rows, date) ?? { bearish: false, reason: "no_benchmark_state", benchmarks: "" };
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(fileName, rows) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, fileName);
  if (!rows.length) {
    fs.writeFileSync(filePath, "", "utf8");
    return filePath;
  }
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(escapeCsv).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(",")),
  ].join("\n");
  fs.writeFileSync(filePath, csv, "utf8");
  return filePath;
}

async function mapLimit(items, limit, mapper) {
  const results = Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizeBinanceKline(kline) {
  const openTime = Number(kline[0]);
  const open = Number(kline[1]);
  const high = Number(kline[2]);
  const low = Number(kline[3]);
  const close = Number(kline[4]);
  const volume = Number(kline[5]);
  if (![openTime, open, high, low, close].every(Number.isFinite) || close <= 0) return null;
  return {
    date: isoDate(new Date(openTime)),
    open,
    high,
    low,
    close,
    rawClose: close,
    adjustedClose: close,
    volume: Number.isFinite(volume) ? volume : null,
  };
}

async function fetchBinanceDailyBarsDirect(symbol) {
  const rows = [];
  let startTime = Date.UTC(2016, 0, 1);
  const endTime = Date.now();
  let guard = 0;

  while (startTime < endTime && guard < 20) {
    guard += 1;
    const response = await axios.get("https://api.binance.com/api/v3/klines", {
      params: {
        symbol,
        interval: "1d",
        startTime,
        limit: 1000,
      },
      timeout: 30000,
    });
    const page = Array.isArray(response.data) ? response.data : [];
    if (!page.length) break;
    rows.push(...page);
    const lastOpenTime = Number(page.at(-1)?.[0]);
    if (!Number.isFinite(lastOpenTime)) break;
    startTime = lastOpenTime + DAY_MS;
    if (page.length < 1000) break;
  }

  const byDate = new Map();
  rows.map(normalizeBinanceKline).filter(Boolean).forEach((bar) => {
    byDate.set(bar.date, bar);
  });

  const bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const utcToday = isoDate(new Date());
  return bars.at(-1)?.date === utcToday ? bars.slice(0, -1) : bars;
}

function normalizeAssetConfig(asset) {
  return {
    ...asset,
    type: asset.market,
    crypto: asset.market === "crypto",
  };
}

async function loadUniverse() {
  const rows = await mapLimit(TREND_RUNNER_UNIVERSE.map(normalizeAssetConfig), SETTINGS.concurrency, async (asset, index) => {
    try {
      console.log(`[${index + 1}/${TREND_RUNNER_UNIVERSE.length}] Descargando ${asset.symbol}`);
      const downloadedBars = asset.market === "crypto"
        ? await fetchBinanceDailyBarsDirect(asset.dataSymbol)
        : await fetchDailyBarsForAsset(asset);
      const bars = downloadedBars.filter((bar) => bar.date <= SETTINGS.backtestEndDate);
      return { asset, bars, error: null };
    } catch (error) {
      return { asset, bars: [], error: error.message };
    }
  });

  return rows;
}

function signalPriority(signalType) {
  if (signalType === "Pullback + Breakout") return 1;
  if (signalType === "Pullback") return 2;
  if (signalType === "Breakout") return 3;
  if (signalType === "Reentrada") return 4;
  return 99;
}

function targetPositionCapital(equity) {
  return Math.max(
    TREND_RUNNER_PORTFOLIO.minPositionUsd,
    equity * (TREND_RUNNER_PORTFOLIO.positionPct / 100)
  );
}

function prepareFinalCandidates(loaded) {
  const quality = [];
  const candidates = [];

  for (const row of loaded) {
    const { asset, bars, error } = row;
    const config = historyConfig(asset);
    const baseQuality = {
      symbol: asset.symbol,
      name: asset.name,
      market: asset.market,
      firstDate: bars[0]?.date ?? null,
      lastDate: bars.at(-1)?.date ?? null,
      bars: bars.length,
      requiredBars: config.requiredBars,
      finalEligible: false,
      oldEligible: false,
      error,
      reason: null,
    };

    const oldStartDate = bars[0]?.date ? isoDate(addYears(new Date(`${bars[0].date}T00:00:00.000Z`), SETTINGS.oldMinHistoryYears)) : null;
    baseQuality.oldEligible = Boolean(bars.length && bars.at(-1)?.date >= oldStartDate);

    if (error) {
      quality.push({ ...baseQuality, reason: "download_error" });
      continue;
    }
    if (bars.length < config.requiredBars) {
      quality.push({ ...baseQuality, reason: "insufficient_final_history" });
      continue;
    }

    const indicators = calculateIndicators(asset, bars);
    const startIndex = config.requiredBars - 1;
    if (!indicators.hold[startIndex]) {
      quality.push({ ...baseQuality, reason: "hold_score_not_calculable" });
      continue;
    }

    quality.push({ ...baseQuality, finalEligible: true, reason: "ok" });
    candidates.push({ asset, bars, indicators, startIndex });
  }

  return { candidates, quality };
}

function closePosition({
  position,
  positions,
  trades,
  fills,
  date,
  index,
  rawPrice,
  quantity,
  reason,
  leg,
  cashBox,
  useSlippage = true,
}) {
  if (!position || quantity <= EPSILON || !positions.has(position.symbol)) return;
  const price = useSlippage ? adversePrice(rawPrice, "sell") : rawPrice;
  const gross = quantity * price;
  const fee = gross * P.commissionRate;
  cashBox.cash += gross - fee;
  cashBox.totalFees += fee;
  position.exitGross += gross;
  position.exitFees += fee;
  position.exitValue += gross - fee;

  fills.push({
    strategy: position.strategy ?? "final_trend_runner",
    tradeId: position.id,
    symbol: position.symbol,
    date,
    action: "sell",
    leg,
    reason,
    quantity,
    price,
    gross,
    fee,
    cashAfter: cashBox.cash,
  });

  if (leg === "TP1") {
    position.qtyTp1 = Math.max(0, position.qtyTp1 - quantity);
  } else if (leg === "Runner") {
    position.qtyRunner = Math.max(0, position.qtyRunner - quantity);
  } else {
    const total = position.qtyTp1 + position.qtyRunner;
    const tp1Share = total ? position.qtyTp1 / total : 0;
    position.qtyTp1 = Math.max(0, position.qtyTp1 - quantity * tp1Share);
    position.qtyRunner = Math.max(0, position.qtyRunner - quantity * (1 - tp1Share));
  }

  if (position.qtyTp1 + position.qtyRunner > EPSILON) return;

  const netPnl = position.exitValue - position.entryCost;
  trades.push({
    strategy: position.strategy ?? "final_trend_runner",
    tradeId: position.id,
    symbol: position.symbol,
    name: position.name,
    market: position.market,
    signalType: position.signalType,
    signalDate: position.signalDate,
    entryDate: position.entryDate,
    exitDate: date,
    entryPrice: position.entryPrice,
    exitAveragePrice: position.exitGross / position.initialQty,
    allocatedCapital: position.entryCost,
    desiredCapitalUsd: position.desiredCapitalUsd,
    isPartialPosition: position.isPartialPosition,
    netPnl,
    returnPct: (netPnl / position.entryCost) * 100,
    barsHeld: index - position.entryIndex,
    calendarDays: Math.round((new Date(date) - new Date(position.entryDate)) / DAY_MS),
    holdScore: position.hold.score,
    tp1QtyPct: position.hold.tp1QtyPct,
    tp1Reached: position.tp1Reached,
    trailAtr: position.hold.trailAtr,
    exitReason: reason,
    totalFees: position.entryFee + position.exitFees,
    mfePct: ((position.highest - position.entryPrice) / position.entryPrice) * 100,
    maePct: ((position.lowest - position.entryPrice) / position.entryPrice) * 100,
  });

  positions.delete(position.symbol);
}

function executeFinalPortfolio(candidates, {
  startDate = null,
  endDate = null,
  strategy = "final_trend_runner",
  globalRegime = null,
} = {}) {
  const states = candidates.map((candidate) => {
    const dateToIndex = new Map(candidate.bars.map((bar, index) => [bar.date, index]));
    return {
      ...candidate,
      dateToIndex,
      pendingEntry: null,
      lastExitIndex: null,
    };
  });
  const stateBySymbol = new Map(states.map((state) => [state.asset.symbol, state]));
  const allDates = [...new Set(states.flatMap((state) => (
    state.bars.slice(state.startIndex).map((bar) => bar.date)
  )))]
    .filter((date) => (!startDate || date >= startDate) && (!endDate || date <= endDate))
    .sort();

  const cashBox = { cash: SETTINGS.initialCash, totalFees: 0 };
  const positions = new Map();
  const latestClose = new Map();
  const trades = [];
  const fills = [];
  const signals = [];
  const skipped = [];
  const equityCurve = [];
  let nextTradeId = 1;
  let maxOpenPositions = 0;

  function markToMarket() {
    let positionValue = 0;
    for (const position of positions.values()) {
      const price = latestClose.get(position.symbol) ?? position.entryPrice;
      positionValue += (position.qtyTp1 + position.qtyRunner) * price;
    }
    return cashBox.cash + positionValue;
  }

  function positionValue() {
    let value = 0;
    for (const position of positions.values()) {
      const price = latestClose.get(position.symbol) ?? position.entryPrice;
      value += (position.qtyTp1 + position.qtyRunner) * price;
    }
    return value;
  }

  function openPosition(state, pending, bar, index, date) {
    const equity = markToMarket();
    const desiredAllocation = targetPositionCapital(equity);
    if (cashBox.cash + EPSILON < TREND_RUNNER_PORTFOLIO.minPositionUsd) {
      skipped.push({
        strategy,
        symbol: state.asset.symbol,
        signalDate: pending.signalDate,
        intendedEntryDate: date,
        signalType: pending.signalType,
        holdScore: pending.hold.score,
        reason: "insufficient_cash",
        cashAvailable: cashBox.cash,
        requiredCash: TREND_RUNNER_PORTFOLIO.minPositionUsd,
        desiredCapitalUsd: desiredAllocation,
      });
      pending.signalRow.status = "omitted";
      pending.signalRow.statusReason = "insufficient_cash";
      return false;
    }

    const allocation = TREND_RUNNER_PORTFOLIO.allowMargin
      ? desiredAllocation
      : Math.min(desiredAllocation, cashBox.cash);
    const isPartialPosition = allocation + EPSILON < desiredAllocation;
    const entryPrice = adversePrice(bar.open, "buy");
    const quantity = allocation / (entryPrice * (1 + P.commissionRate));
    const gross = quantity * entryPrice;
    const entryFee = gross * P.commissionRate;
    const entryCost = gross + entryFee;
    cashBox.cash -= entryCost;
    cashBox.totalFees += entryFee;

    const hold = { ...pending.hold };
    const atr = state.indicators.atr[index];
    const initialStop = entryPrice - atr * P.atrStopMultiple;
    const risk = entryPrice - initialStop;
    const qtyTp1 = quantity * hold.tp1QtyPct / 100;
    const position = {
      id: nextTradeId,
      strategy,
      symbol: state.asset.symbol,
      name: state.asset.name,
      market: state.asset.market,
      signalType: pending.signalType,
      signalDate: pending.signalDate,
      entryDate: date,
      entryIndex: index,
      entryPrice,
      entryFee,
      entryCost,
      desiredCapitalUsd: desiredAllocation,
      isPartialPosition,
      initialQty: quantity,
      qtyTp1,
      qtyRunner: quantity - qtyTp1,
      hold,
      initialStop,
      tp1: entryPrice + risk * hold.tp1Rr,
      finalTp: entryPrice + risk * hold.finalTpRr,
      runnerStop: initialStop,
      highest: bar.high,
      lowest: bar.low,
      tp1Reached: false,
      exitGross: 0,
      exitFees: 0,
      exitValue: 0,
      pendingMarketExit: null,
    };
    nextTradeId += 1;
    positions.set(state.asset.symbol, position);
    maxOpenPositions = Math.max(maxOpenPositions, positions.size);
    fills.push({
      strategy,
      tradeId: position.id,
      symbol: position.symbol,
      date,
      action: "buy",
      leg: "full_position",
      reason: pending.signalType,
      quantity,
      price: entryPrice,
      gross,
      fee: entryFee,
      cashAfter: cashBox.cash,
    });
    pending.signalRow.status = "executed";
    pending.signalRow.tradeId = position.id;
    pending.signalRow.capitalUsd = allocation;
    pending.signalRow.desiredCapitalUsd = desiredAllocation;
    pending.signalRow.isPartialPosition = isPartialPosition;
    return true;
  }

  for (const date of allDates) {
    const statesWithBar = states
      .map((state) => ({ state, index: state.dateToIndex.get(date) }))
      .filter((item) => Number.isInteger(item.index) && item.index >= item.state.startIndex);
    const enteredToday = new Set();

    for (const { state, index } of statesWithBar) {
      const position = positions.get(state.asset.symbol);
      if (!position?.pendingMarketExit) continue;
      const bar = state.bars[index];
      closePosition({
        position,
        positions,
        trades,
        fills,
        date,
        index,
        rawPrice: bar.open,
        quantity: position.qtyTp1 + position.qtyRunner,
        reason: position.pendingMarketExit,
        leg: "Full",
        cashBox,
      });
    }

    const dueEntries = statesWithBar
      .filter(({ state, index }) => state.pendingEntry?.dueIndex === index)
      .map(({ state, index }) => ({ state, index, pending: state.pendingEntry }))
      .sort((a, b) => (
        a.pending.priority - b.pending.priority
        || b.pending.hold.score - a.pending.hold.score
        || a.state.asset.symbol.localeCompare(b.state.asset.symbol)
      ));

    for (const { state, index, pending } of dueEntries) {
      if (positions.has(state.asset.symbol) && !TREND_RUNNER_PORTFOLIO.pyramidSameAsset) {
        pending.signalRow.status = "omitted";
        pending.signalRow.statusReason = "already_open";
        state.pendingEntry = null;
        continue;
      }
      const opened = openPosition(state, pending, state.bars[index], index, date);
      if (opened) enteredToday.add(state.asset.symbol);
      state.pendingEntry = null;
    }

    for (const { state, index } of statesWithBar) {
      const position = positions.get(state.asset.symbol);
      if (!position || enteredToday.has(state.asset.symbol)) continue;
      const bar = state.bars[index];
      position.highest = Math.max(position.highest, bar.high);
      position.lowest = Math.min(position.lowest, bar.low);

      if (position.qtyTp1 > EPSILON && bar.low <= position.initialStop) {
        const stopFill = bar.open < position.initialStop ? bar.open : position.initialStop;
        closePosition({
          position,
          positions,
          trades,
          fills,
          date,
          index,
          rawPrice: stopFill,
          quantity: position.qtyTp1,
          reason: "initial_stop",
          leg: "TP1",
          cashBox,
        });
      }

      const afterInitial = positions.get(state.asset.symbol);
      if (afterInitial?.qtyRunner > EPSILON && bar.low <= afterInitial.runnerStop) {
        const stopFill = bar.open < afterInitial.runnerStop ? bar.open : afterInitial.runnerStop;
        closePosition({
          position: afterInitial,
          positions,
          trades,
          fills,
          date,
          index,
          rawPrice: stopFill,
          quantity: afterInitial.qtyRunner,
          reason: "runner_trailing_stop",
          leg: "Runner",
          cashBox,
        });
      }

      const afterRunner = positions.get(state.asset.symbol);
      if (afterRunner?.qtyTp1 > EPSILON && bar.high >= afterRunner.tp1) {
        afterRunner.tp1Reached = true;
        closePosition({
          position: afterRunner,
          positions,
          trades,
          fills,
          date,
          index,
          rawPrice: afterRunner.tp1,
          quantity: afterRunner.qtyTp1,
          reason: "tp1",
          leg: "TP1",
          cashBox,
          useSlippage: false,
        });
      }
    }

    for (const { state, index } of statesWithBar) {
      latestClose.set(state.asset.symbol, state.bars[index].close);
    }

    for (const { state, index } of statesWithBar) {
      const position = positions.get(state.asset.symbol);
      if (!position) continue;
      const bar = state.bars[index];
      position.highest = Math.max(position.highest, bar.high);
      position.lowest = Math.min(position.lowest, bar.low);
      const chandelier = position.highest - state.indicators.atr[index] * position.hold.trailAtr;
      position.runnerStop = Math.max(position.initialStop, position.runnerStop, chandelier);
      if (regimeLost(index, state.bars, state.indicators)) position.pendingMarketExit = "regime_loss";
    }

    for (const { state, index } of statesWithBar) {
      if (index >= state.bars.length - 1) continue;
      if (positions.has(state.asset.symbol) && !TREND_RUNNER_PORTFOLIO.pyramidSameAsset) continue;
      if (state.pendingEntry) continue;
      const hold = state.indicators.hold[index];
      if (!hold || hold.score < P.minEntryHoldScore) continue;
      const signalType = signalAt(index, state.bars, state.indicators, hold.score);
      if (!signalType) continue;
      const marketRegime = globalRegimeState(globalRegime, state.asset.market, date);
      if (marketRegime.bearish) {
        const restrictedSignalAllowed = (
          signalType === "Pullback + Breakout"
          && hold.score >= P.globalBearMinHoldScore
        );
        if (!restrictedSignalAllowed) {
          skipped.push({
            strategy,
            symbol: state.asset.symbol,
            signalDate: date,
            intendedEntryDate: state.bars[index + 1].date,
            signalType,
            holdScore: hold.score,
            reason: signalType === "Reentrada"
              ? "bear_regime_reentry_disabled"
              : "bear_regime_requires_hold90_pullback_breakout",
            regimeReason: marketRegime.reason,
            regimeBenchmarks: marketRegime.benchmarks,
          });
          continue;
        }
      }
      const priority = signalPriority(signalType);
      const signalRow = {
        strategy,
        symbol: state.asset.symbol,
        name: state.asset.name,
        market: state.asset.market,
        signalDate: date,
        intendedEntryDate: state.bars[index + 1].date,
        signalType,
        priority,
        holdScore: hold.score,
        capitalUsd: null,
        desiredCapitalUsd: null,
        isPartialPosition: false,
        status: "scheduled",
        statusReason: "",
        tradeId: null,
      };
      signals.push(signalRow);
      state.pendingEntry = {
        dueIndex: index + 1,
        signalDate: date,
        signalType,
        priority,
        hold: { ...hold },
        signalRow,
      };
    }

    const equity = markToMarket();
    const deployed = positionValue();
    equityCurve.push({
      strategy,
      date,
      equity,
      cash: cashBox.cash,
      positionValue: deployed,
      openPositions: positions.size,
      deployedPct: equity ? deployed / equity * 100 : 0,
      targetPositionCapital: targetPositionCapital(equity),
    });
  }

  const finalBarDate = allDates.at(-1);
  for (const position of [...positions.values()]) {
    const state = stateBySymbol.get(position.symbol);
    const index = state?.dateToIndex.get(finalBarDate);
    const bar = Number.isInteger(index) ? state.bars[index] : null;
    const price = bar?.close ?? latestClose.get(position.symbol) ?? position.entryPrice;
    closePosition({
      position,
      positions,
      trades,
      fills,
      date: finalBarDate,
      index: index ?? position.entryIndex,
      rawPrice: price,
      quantity: position.qtyTp1 + position.qtyRunner,
      reason: "period_end",
      leg: "Full",
      cashBox,
    });
  }

  if (equityCurve.length) {
    const last = equityCurve.at(-1);
    last.equity = cashBox.cash;
    last.cash = cashBox.cash;
    last.positionValue = 0;
    last.openPositions = 0;
    last.deployedPct = 0;
  }

  return {
    strategy,
    trades,
    fills,
    signals,
    skipped,
    equityCurve,
    totalFees: cashBox.totalFees,
    maxOpenPositions,
  };
}

function toCloseCandles(bars) {
  return bars.map((bar) => ({
    date: bar.date,
    closeTime: new Date(`${bar.date}T00:00:00.000Z`),
    close: bar.close,
  }));
}

function getPriceAtOrBefore(candles, asOfDate) {
  const asOf = new Date(asOfDate).getTime();
  let found = null;
  for (const candle of candles) {
    if (candle.closeTime.getTime() <= asOf) found = candle;
    else break;
  }
  return found?.close ?? null;
}

function subtractYears(date, years) {
  return addYears(date, -years);
}

function calculateSlope(candles, asOfDate, crypto) {
  const asOf = new Date(asOfDate).getTime();
  const window = candles.filter((candle) => candle.closeTime.getTime() <= asOf && candle.close > 0);
  if (window.length < 2) return 0;
  const start = window[0].closeTime.getTime();
  const x = window.map((candle) => (candle.closeTime.getTime() - start) / DAY_MS);
  const y = window.map((candle) => Math.log(candle.close));
  const n = x.length;
  const sumX = x.reduce((sum, value) => sum + value, 0);
  const sumY = y.reduce((sum, value) => sum + value, 0);
  const sumXY = x.reduce((sum, value, index) => sum + value * y[index], 0);
  const sumX2 = x.reduce((sum, value) => sum + value * value, 0);
  const denominator = n * sumX2 - sumX * sumX;
  if (Math.abs(denominator) <= Number.EPSILON) return 0;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  return (Math.exp(slope * (crypto ? 365 : 252)) - 1) * 100;
}

function rollingHighLow(candles, asOfDate, years) {
  const asOf = new Date(asOfDate).getTime();
  const cutoff = subtractYears(new Date(asOf), years).getTime();
  const drawdownCutoff = subtractYears(new Date(asOf), 5).getTime();
  const highWindow = candles.filter((candle) => candle.closeTime.getTime() >= cutoff && candle.closeTime.getTime() <= asOf);
  if (!highWindow.length) return null;
  const high = Math.max(...highWindow.map((candle) => candle.close));
  const drawdownWindow = candles.filter((candle) => candle.closeTime.getTime() >= drawdownCutoff && candle.closeTime.getTime() <= asOf);
  let runningHigh = null;
  let maxDrawdownPercent = 0;
  for (const candle of drawdownWindow) {
    runningHigh = runningHigh == null ? candle.close : Math.max(runningHigh, candle.close);
    maxDrawdownPercent = Math.max(maxDrawdownPercent, (runningHigh - candle.close) / runningHigh);
  }
  return { high, low: high * (1 - maxDrawdownPercent) };
}

function decisionBounds(low, high, slopeFraction) {
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    return { decisionLow: low, decisionHigh: high };
  }
  const adjustment = Math.min(Math.abs(slopeFraction), SETTINGS.oldSlopeLowLimit);
  if (slopeFraction > 0) return { decisionLow: low + (high - low) * adjustment, decisionHigh: high };
  if (slopeFraction < 0) return { decisionLow: low, decisionHigh: high - (high - low) * adjustment };
  return { decisionLow: low, decisionHigh: high };
}

function slopeHoldFraction(slopeFraction) {
  const abs = Math.min(Math.abs(slopeFraction), 1);
  if (SETTINGS.oldSlopeHoldMode === "sqrt") return Math.sqrt(abs);
  if (SETTINGS.oldSlopeHoldMode === "multiplier") return Math.min(1, abs * 1.5);
  return abs;
}

function applySlopeHoldThreshold({ targetBaseUsd, actualBaseUsd, allocation, baseHoldUsd, quoteHoldUsd, maxBaseAllowed }) {
  const rawTargetBaseUsd = Math.max(0, Math.min(targetBaseUsd, allocation));
  const rawBaseDiffUsd = rawTargetBaseUsd - actualBaseUsd;
  let effectiveTargetBaseUsd = rawTargetBaseUsd;
  if (rawBaseDiffUsd < -EPSILON && baseHoldUsd > 0) {
    const adjustedSellUsd = Math.abs(rawBaseDiffUsd) - baseHoldUsd;
    effectiveTargetBaseUsd = adjustedSellUsd > EPSILON ? Math.max(actualBaseUsd - adjustedSellUsd, 0) : actualBaseUsd;
  } else if (rawBaseDiffUsd > EPSILON && quoteHoldUsd > 0) {
    const adjustedBuyUsd = rawBaseDiffUsd - quoteHoldUsd;
    effectiveTargetBaseUsd = adjustedBuyUsd > EPSILON ? Math.min(actualBaseUsd + adjustedBuyUsd, maxBaseAllowed) : actualBaseUsd;
  } else if (quoteHoldUsd > 0 && rawBaseDiffUsd < -EPSILON) {
    effectiveTargetBaseUsd = Math.min(rawTargetBaseUsd, maxBaseAllowed);
  }
  return { baseDiffUsd: effectiveTargetBaseUsd - actualBaseUsd };
}

function prepareOldCandidates(loaded) {
  return loaded
    .filter((row) => !row.error && row.bars.length)
    .map((row) => ({ asset: row.asset, candles: toCloseCandles(row.bars) }))
    .filter((row) => {
      const first = row.candles[0]?.closeTime;
      const last = row.candles.at(-1)?.closeTime;
      return first && last && addYears(first, SETTINGS.oldMinHistoryYears) <= last;
    });
}

function executeOldSlopePortfolio(assetData, {
  applyCosts = true,
  startDate: requestedStartDate = null,
  endDate: requestedEndDate = null,
  strategy = null,
} = {}) {
  const strategyName = strategy ?? (applyCosts ? "old_slope_costed" : "old_slope_original_no_costs");
  const naturalStartDate = new Date(Math.max(...assetData.map((item) => addYears(item.candles[0].closeTime, SETTINGS.oldMinHistoryYears).getTime())));
  const naturalEndDate = new Date(Math.min(...assetData.map((item) => item.candles.at(-1).closeTime.getTime())));
  const startDate = requestedStartDate
    ? new Date(Math.max(naturalStartDate.getTime(), new Date(`${requestedStartDate}T00:00:00.000Z`).getTime()))
    : naturalStartDate;
  const endDate = requestedEndDate
    ? new Date(Math.min(naturalEndDate.getTime(), new Date(`${requestedEndDate}T00:00:00.000Z`).getTime()))
    : naturalEndDate;
  const allDates = [...new Set(assetData.flatMap((item) => (
    item.candles
      .filter((candle) => candle.closeTime >= startDate && candle.closeTime <= endDate)
      .map((candle) => candle.date)
  )))].sort();

  let cash = SETTINGS.initialCash;
  let totalFees = 0;
  const holdings = new Map(assetData.map((item) => [item.asset.symbol, 0]));
  const lastPrices = new Map();
  const tradeCounts = new Map(assetData.map((item) => [item.asset.symbol, { trades: 0, buys: 0, sells: 0 }]));
  const equityCurve = [];
  let totalBuys = 0;
  let totalSells = 0;

  for (const date of allDates) {
    const prices = new Map();
    const slopeRows = [];
    for (const item of assetData) {
      const price = getPriceAtOrBefore(item.candles, new Date(`${date}T00:00:00.000Z`));
      if (price && price > 0) {
        prices.set(item.asset.symbol, price);
        lastPrices.set(item.asset.symbol, price);
      }
      slopeRows.push({
        item,
        symbol: item.asset.symbol,
        slope: Math.max(calculateSlope(item.candles, new Date(`${date}T00:00:00.000Z`), item.asset.market === "crypto"), 0),
      });
    }
    if (prices.size !== assetData.length) continue;

    let equity = cash;
    for (const item of assetData) {
      equity += (holdings.get(item.asset.symbol) ?? 0) * prices.get(item.asset.symbol);
    }

    const slopeTotal = slopeRows.reduce((sum, row) => sum + row.slope, 0);
    const weights = new Map(slopeRows.map((row) => [
      row.symbol,
      slopeTotal > EPSILON ? row.slope / slopeTotal : 1 / assetData.length,
    ]));

    const planned = [];
    for (const row of slopeRows) {
      const { item } = row;
      const symbol = item.asset.symbol;
      const price = prices.get(symbol);
      const allocation = equity * (weights.get(symbol) ?? 0);
      const indicators = rollingHighLow(item.candles, new Date(`${date}T00:00:00.000Z`), SETTINGS.oldYears);
      if (!indicators || allocation <= EPSILON) continue;
      const slopeFraction = row.slope / 100;
      const holdFraction = slopeHoldFraction(slopeFraction);
      const baseHoldUsd = slopeFraction > 0 ? allocation * holdFraction : 0;
      const quoteHoldUsd = slopeFraction < 0 ? allocation * holdFraction : 0;
      const maxBaseAllowed = Math.max(allocation - quoteHoldUsd, 0);
      const { decisionLow, decisionHigh } = decisionBounds(indicators.low, indicators.high, slopeFraction);
      const priceRange = decisionHigh - decisionLow;
      const normalized = priceRange === 0 ? 0.5 : Math.max(0, Math.min((price - decisionLow) / priceRange, 1));
      const desiredBaseUsd = allocation * Math.max(0, Math.min(1 - normalized, 1));
      const actualUsd = (holdings.get(symbol) ?? 0) * price;
      const { baseDiffUsd } = applySlopeHoldThreshold({
        targetBaseUsd: desiredBaseUsd,
        actualBaseUsd: actualUsd,
        allocation,
        baseHoldUsd,
        quoteHoldUsd,
        maxBaseAllowed,
      });
      if (Math.abs(baseDiffUsd) >= SETTINGS.oldMinTradeUsd) {
        planned.push({ symbol, price, diffUsd: baseDiffUsd });
      }
    }

    for (const trade of planned.filter((item) => item.diffUsd < -EPSILON)) {
      const units = holdings.get(trade.symbol) ?? 0;
      const sellUsd = Math.min(-trade.diffUsd, units * trade.price);
      if (sellUsd < SETTINGS.oldMinTradeUsd) continue;
      const price = applyCosts ? adversePrice(trade.price, "sell") : trade.price;
      const unitsSold = Math.min(units, sellUsd / trade.price);
      const gross = unitsSold * price;
      const fee = applyCosts ? gross * P.commissionRate : 0;
      holdings.set(trade.symbol, Math.max(units - unitsSold, 0));
      cash += gross - fee;
      totalFees += fee;
      tradeCounts.get(trade.symbol).trades += 1;
      tradeCounts.get(trade.symbol).sells += 1;
      totalSells += 1;
    }

    for (const trade of planned.filter((item) => item.diffUsd > EPSILON)) {
      const buyUsd = Math.min(trade.diffUsd, cash);
      if (buyUsd < SETTINGS.oldMinTradeUsd) continue;
      const price = applyCosts ? adversePrice(trade.price, "buy") : trade.price;
      const fee = applyCosts ? buyUsd * P.commissionRate : 0;
      const invest = Math.max(buyUsd - fee, 0);
      holdings.set(trade.symbol, (holdings.get(trade.symbol) ?? 0) + invest / price);
      cash -= buyUsd;
      totalFees += fee;
      tradeCounts.get(trade.symbol).trades += 1;
      tradeCounts.get(trade.symbol).buys += 1;
      totalBuys += 1;
    }

    let finalEquity = cash;
    let positionValue = 0;
    for (const item of assetData) {
      const value = (holdings.get(item.asset.symbol) ?? 0) * (lastPrices.get(item.asset.symbol) ?? 0);
      positionValue += value;
      finalEquity += value;
    }
    equityCurve.push({
      strategy: strategyName,
      date,
      equity: finalEquity,
      cash,
      positionValue,
      openPositions: [...holdings.values()].filter((units) => units > EPSILON).length,
      deployedPct: finalEquity ? positionValue / finalEquity * 100 : 0,
    });
  }

  return {
    strategy: strategyName,
    equityCurve,
    totalFees,
    tradesCount: totalBuys + totalSells,
    buys: totalBuys,
    sells: totalSells,
    assetRows: assetData.map((item) => {
      const stats = tradeCounts.get(item.asset.symbol);
      const firstPrice = getPriceAtOrBefore(item.candles, startDate);
      const lastPrice = getPriceAtOrBefore(item.candles, endDate);
      return {
        strategy: strategyName,
        symbol: item.asset.symbol,
        name: item.asset.name,
        market: item.asset.market,
        trades: stats.trades,
        buys: stats.buys,
        sells: stats.sells,
        buyHoldPct: firstPrice && lastPrice ? (lastPrice / firstPrice - 1) * 100 : null,
      };
    }),
  };
}

function summarizeRun(run) {
  const curve = run.equityCurve;
  const first = curve[0];
  const last = curve.at(-1);
  const dd = maxDrawdown(curve);
  const years = first && last ? Math.max(yearsBetween(first.date, last.date), 1 / 365) : 0;
  const finalEquity = last?.equity ?? SETTINGS.initialCash;
  const totalReturnPct = (finalEquity / SETTINGS.initialCash - 1) * 100;
  const cagrPct = years ? ((finalEquity / SETTINGS.initialCash) ** (1 / years) - 1) * 100 : null;
  const trades = run.trades ?? [];
  const winners = trades.filter((trade) => trade.netPnl > 0);
  const losers = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = losers.reduce((sum, trade) => sum + trade.netPnl, 0);
  return {
    strategy: run.strategy,
    startDate: first?.date ?? null,
    endDate: last?.date ?? null,
    years: round(years, 2),
    initialCash: SETTINGS.initialCash,
    finalEquity: round(finalEquity, 2),
    netProfit: round(finalEquity - SETTINGS.initialCash, 2),
    totalReturnPct: round(totalReturnPct, 2),
    cagrPct: round(cagrPct, 2),
    maxDrawdownPct: round(dd.maxDrawdownPct, 2),
    maxDrawdownDate: dd.troughDate,
    trades: trades.length || run.tradesCount || 0,
    buys: run.buys ?? (run.fills ?? []).filter((fill) => fill.action === "buy").length,
    sells: run.sells ?? (run.fills ?? []).filter((fill) => fill.action === "sell").length,
    winRatePct: trades.length ? round((winners.length / trades.length) * 100, 2) : null,
    profitFactor: grossLoss ? round(grossProfit / Math.abs(grossLoss), 3) : null,
    averageTradePct: trades.length ? round(mean(trades.map((trade) => trade.returnPct)), 2) : null,
    medianTradePct: trades.length ? round(median(trades.map((trade) => trade.returnPct)), 2) : null,
    averageDaysHeld: trades.length ? round(mean(trades.map((trade) => trade.calendarDays)), 1) : null,
    maxOpenPositions: run.maxOpenPositions ?? Math.max(...curve.map((row) => row.openPositions ?? 0), 0),
    avgOpenPositions: round(mean(curve.map((row) => row.openPositions ?? 0)), 2),
    avgDeployedPct: round(mean(curve.map((row) => row.deployedPct ?? 0)), 2),
    feesPaid: round(run.totalFees ?? 0, 2),
    signalsDetected: run.signals?.length ?? null,
    skippedEntries: run.skipped?.length ?? null,
  };
}

function annualReturns(curve, strategy) {
  const groups = new Map();
  for (const row of curve) {
    const year = row.date.slice(0, 4);
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(row);
  }
  return [...groups.entries()].map(([year, rows]) => ({
    strategy,
    year,
    startEquity: round(rows[0].equity, 2),
    endEquity: round(rows.at(-1).equity, 2),
    returnPct: round((rows.at(-1).equity / rows[0].equity - 1) * 100, 2),
    avgOpenPositions: round(mean(rows.map((row) => row.openPositions ?? 0)), 2),
    avgDeployedPct: round(mean(rows.map((row) => row.deployedPct ?? 0)), 2),
  }));
}

function commonPeriodSummary(runs) {
  const curves = runs
    .filter((run) => run.equityCurve?.length)
    .map((run) => ({
      strategy: `${run.strategy}_common_period`,
      curve: run.equityCurve,
    }));
  if (!curves.length) return [];

  const startDate = curves.reduce((maxDate, row) => {
    const date = row.curve[0].date;
    return date > maxDate ? date : maxDate;
  }, "0000-00-00");
  const endDate = curves.reduce((minDate, row) => {
    const date = row.curve.at(-1).date;
    return date < minDate ? date : minDate;
  }, "9999-99-99");

  return curves.map(({ strategy, curve }) => {
    const rows = curve.filter((row) => row.date >= startDate && row.date <= endDate);
    const first = rows[0];
    const last = rows.at(-1);
    const initialEquity = first?.equity ?? SETTINGS.initialCash;
    const finalEquity = last?.equity ?? initialEquity;
    const normalizedCurve = rows.map((row) => ({
      ...row,
      normalizedEquity: initialEquity ? (row.equity / initialEquity) * SETTINGS.initialCash : row.equity,
    }));
    const dd = maxDrawdown(normalizedCurve, "normalizedEquity");
    const years = first && last ? Math.max(yearsBetween(first.date, last.date), 1 / 365) : 0;
    const totalReturnPct = initialEquity ? (finalEquity / initialEquity - 1) * 100 : null;
    const cagrPct = years && initialEquity
      ? ((finalEquity / initialEquity) ** (1 / years) - 1) * 100
      : null;

    return {
      strategy,
      startDate,
      endDate,
      years: round(years, 2),
      normalizedInitialCash: SETTINGS.initialCash,
      normalizedFinalEquity: round(initialEquity ? (finalEquity / initialEquity) * SETTINGS.initialCash : finalEquity, 2),
      totalReturnPct: round(totalReturnPct, 2),
      cagrPct: round(cagrPct, 2),
      maxDrawdownPct: round(dd.maxDrawdownPct, 2),
      maxDrawdownDate: dd.troughDate,
      maxOpenPositions: Math.max(...rows.map((row) => row.openPositions ?? 0), 0),
      avgOpenPositions: round(mean(rows.map((row) => row.openPositions ?? 0)), 2),
      avgDeployedPct: round(mean(rows.map((row) => row.deployedPct ?? 0)), 2),
    };
  });
}

function summarizeFinalTradesBy(trades, key) {
  const groups = new Map();
  for (const trade of trades) {
    const groupKey = trade[key] ?? "unknown";
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        group: groupKey,
        trades: 0,
        winners: 0,
        losers: 0,
        netPnl: 0,
        grossProfit: 0,
        grossLoss: 0,
        returns: [],
        daysHeld: [],
      });
    }
    const group = groups.get(groupKey);
    group.trades += 1;
    group.netPnl += trade.netPnl ?? 0;
    group.returns.push(trade.returnPct);
    group.daysHeld.push(trade.calendarDays);
    if ((trade.netPnl ?? 0) > 0) {
      group.winners += 1;
      group.grossProfit += trade.netPnl;
    } else if ((trade.netPnl ?? 0) < 0) {
      group.losers += 1;
      group.grossLoss += trade.netPnl;
    }
  }

  return [...groups.values()]
    .map((group) => ({
      group: group.group,
      trades: group.trades,
      winners: group.winners,
      losers: group.losers,
      winRatePct: round((group.winners / group.trades) * 100, 2),
      netPnl: round(group.netPnl, 2),
      profitFactor: group.grossLoss ? round(group.grossProfit / Math.abs(group.grossLoss), 3) : null,
      averageTradePct: round(mean(group.returns), 2),
      medianTradePct: round(median(group.returns), 2),
      averageDaysHeld: round(mean(group.daysHeld), 1),
    }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

function countRows(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key] ?? "unknown";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ group: value, count }))
    .sort((a, b) => b.count - a.count);
}

function slugify(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function finalCandidateReadyBy(candidate, date) {
  const startDate = candidate.bars[candidate.startIndex]?.date;
  const endDate = candidate.bars.at(-1)?.date;
  return Boolean(startDate && endDate && startDate <= date && endDate >= date);
}

function oldCandidateReadyBy(candidate, date) {
  const first = candidate.candles[0]?.closeTime;
  const lastDate = candidate.candles.at(-1)?.date;
  if (!first || !lastDate) return false;
  return isoDate(addYears(first, SETTINGS.oldMinHistoryYears)) <= date && lastDate >= date;
}

function crisisComparisonRows(finalCandidates, oldCandidates) {
  const rows = [];

  for (const period of CRISIS_PERIODS) {
    const finalSymbols = new Set(
      finalCandidates
        .filter((candidate) => (
          finalCandidateReadyBy(candidate, period.startDate)
          && candidate.bars.at(-1)?.date >= period.endDate
        ))
        .map((candidate) => candidate.asset.symbol)
    );
    const oldSymbols = new Set(
      oldCandidates
        .filter((candidate) => (
          oldCandidateReadyBy(candidate, period.startDate)
          && candidate.candles.at(-1)?.date >= period.endDate
        ))
        .map((candidate) => candidate.asset.symbol)
    );
    const symbols = new Set([...finalSymbols].filter((symbol) => oldSymbols.has(symbol)));
    const finalSubset = finalCandidates.filter((candidate) => symbols.has(candidate.asset.symbol));
    const oldSubset = oldCandidates.filter((candidate) => symbols.has(candidate.asset.symbol));
    if (!finalSubset.length || !oldSubset.length) {
      rows.push({
        period: period.name,
        startDate: period.startDate,
        endDate: period.endDate,
        universeCount: symbols.size,
        strategy: "not_enough_common_assets",
      });
      continue;
    }

    const slug = slugify(period.name);
    const finalRun = executeFinalPortfolio(finalSubset, {
      startDate: period.startDate,
      endDate: period.endDate,
      strategy: `final_trend_runner_${slug}`,
    });
    const oldRun = executeOldSlopePortfolio(oldSubset, {
      applyCosts: true,
      startDate: period.startDate,
      endDate: period.endDate,
      strategy: `old_slope_costed_${slug}`,
    });

    for (const summary of [summarizeRun(finalRun), summarizeRun(oldRun)]) {
      rows.push({
        period: period.name,
        requestedStartDate: period.startDate,
        requestedEndDate: period.endDate,
        universeCount: symbols.size,
        ...summary,
      });
    }
  }

  return rows;
}

function finalGlobalRegimeCrisisRows(finalCandidates, globalRegime) {
  const rows = [];

  for (const period of CRISIS_PERIODS) {
    const subset = finalCandidates.filter((candidate) => (
      finalCandidateReadyBy(candidate, period.startDate)
      && candidate.bars.at(-1)?.date >= period.endDate
    ));

    if (!subset.length) {
      rows.push({
        period: period.name,
        requestedStartDate: period.startDate,
        requestedEndDate: period.endDate,
        universeCount: 0,
        strategy: "not_enough_assets",
      });
      continue;
    }

    const run = executeFinalPortfolio(subset, {
      startDate: period.startDate,
      endDate: period.endDate,
      strategy: `final_trend_runner_global_regime_${slugify(period.name)}`,
      globalRegime,
    });

    rows.push({
      period: period.name,
      requestedStartDate: period.startDate,
      requestedEndDate: period.endDate,
      universeCount: subset.length,
      ...summarizeRun(run),
    });
  }

  return rows;
}

async function main() {
  const loaded = await loadUniverse();
  const { candidates: finalCandidates, quality } = prepareFinalCandidates(loaded);
  const oldCandidates = prepareOldCandidates(loaded);

  console.log(`Final eligible: ${finalCandidates.length}`);
  console.log(`Old eligible: ${oldCandidates.length}`);

  const finalRun = executeFinalPortfolio(finalCandidates);
  const globalRegime = buildGlobalRegime(finalCandidates);
  const finalGlobalRegimeRun = executeFinalPortfolio(finalCandidates, {
    strategy: "final_trend_runner_global_regime",
    globalRegime,
  });
  const oldCosted = executeOldSlopePortfolio(oldCandidates, { applyCosts: true });
  const oldOriginal = executeOldSlopePortfolio(oldCandidates, { applyCosts: false });
  const strictStartDate = oldCosted.equityCurve[0]?.date;
  const strictEndDate = oldCosted.equityCurve.at(-1)?.date;
  const finalFreshCommon = executeFinalPortfolio(finalCandidates, {
    startDate: strictStartDate,
    endDate: strictEndDate,
    strategy: "final_trend_runner_fresh_common_period",
  });

  const summary = [
    summarizeRun(finalRun),
    summarizeRun(oldCosted),
    summarizeRun(oldOriginal),
  ];
  const commonSummary = commonPeriodSummary([finalRun, oldCosted, oldOriginal]);
  const freshCommonSummary = [
    summarizeRun(finalFreshCommon),
    summarizeRun(oldCosted),
    summarizeRun(oldOriginal),
  ];
  const crisisRows = crisisComparisonRows(finalCandidates, oldCandidates);
  const finalGlobalRegimeSummary = [summarizeRun(finalGlobalRegimeRun)];
  const finalGlobalRegimeCrisisSummary = finalGlobalRegimeCrisisRows(finalCandidates, globalRegime);

  const assumptionRows = [
    { key: "initialCash", value: SETTINGS.initialCash },
    { key: "backtestEndDate", value: SETTINGS.backtestEndDate },
    { key: "final.positionPct", value: TREND_RUNNER_PORTFOLIO.positionPct },
    { key: "final.minPositionUsd", value: TREND_RUNNER_PORTFOLIO.minPositionUsd },
    { key: "final.minEntryHoldScore", value: P.minEntryHoldScore },
    { key: "final.minReentryHoldScore", value: P.minReentryHoldScore },
    { key: "final.globalRegimeFilter", value: "equity uses SPY/QQQ; crypto uses BTCUSDT; daily EMA200 or completed weekly EMA200 below = bear" },
    { key: "final.globalBearRule", value: `bear regime allows only Pullback + Breakout with Hold Score >= ${P.globalBearMinHoldScore}; reentry disabled` },
    { key: "final.historyRule", value: "stocks/ETFs approx 15y; crypto approx 7y; otherwise ignored" },
    { key: "final.entryExecution", value: "next daily open after signal, with slippage" },
    { key: "final.incompleteDailyBars", value: "ignored" },
    { key: "old.logic", value: "slope/range allocation, daily rebalance, min 3y history" },
    { key: "old.years", value: SETTINGS.oldYears },
    { key: "old.slopeLowLimit", value: SETTINGS.oldSlopeLowLimit },
    { key: "commissionRate", value: P.commissionRate },
    { key: "slippageBps", value: P.slippageBps },
  ];

  const files = [
    writeCsv("trend-runner-final-vs-old-summary.csv", summary),
    writeCsv("trend-runner-final-global-regime-summary.csv", finalGlobalRegimeSummary),
    writeCsv("trend-runner-final-global-regime-crisis-summary.csv", finalGlobalRegimeCrisisSummary),
    writeCsv("trend-runner-final-vs-old-common-period-summary.csv", commonSummary),
    writeCsv("trend-runner-final-vs-old-fresh-common-summary.csv", freshCommonSummary),
    writeCsv("trend-runner-final-vs-old-crisis-comparison.csv", crisisRows),
    writeCsv("trend-runner-final-vs-old-assumptions.csv", assumptionRows),
    writeCsv("trend-runner-final-vs-old-asset-quality.csv", quality),
    writeCsv("trend-runner-final-trades-by-market.csv", summarizeFinalTradesBy(finalRun.trades, "market")),
    writeCsv("trend-runner-final-trades-by-signal-type.csv", summarizeFinalTradesBy(finalRun.trades, "signalType")),
    writeCsv("trend-runner-final-signals-by-type.csv", countRows(finalRun.signals, "signalType")),
    writeCsv("trend-runner-final-skipped-by-reason.csv", countRows(finalRun.skipped, "reason")),
    writeCsv("trend-runner-final-trades.csv", finalRun.trades),
    writeCsv("trend-runner-final-global-regime-trades.csv", finalGlobalRegimeRun.trades),
    writeCsv("trend-runner-final-fresh-common-trades.csv", finalFreshCommon.trades),
    writeCsv("trend-runner-final-signals.csv", finalRun.signals),
    writeCsv("trend-runner-final-global-regime-signals.csv", finalGlobalRegimeRun.signals),
    writeCsv("trend-runner-final-skipped.csv", finalRun.skipped),
    writeCsv("trend-runner-final-global-regime-skipped.csv", finalGlobalRegimeRun.skipped),
    writeCsv("trend-runner-final-equity-curve.csv", finalRun.equityCurve),
    writeCsv("trend-runner-final-global-regime-equity-curve.csv", finalGlobalRegimeRun.equityCurve),
    writeCsv("trend-runner-global-regime-benchmark-states.csv", globalRegime.benchmarks),
    writeCsv("trend-runner-final-fresh-common-equity-curve.csv", finalFreshCommon.equityCurve),
    writeCsv("trend-runner-old-costed-equity-curve.csv", oldCosted.equityCurve),
    writeCsv("trend-runner-old-original-equity-curve.csv", oldOriginal.equityCurve),
    writeCsv("trend-runner-annual-returns.csv", [
      ...annualReturns(finalRun.equityCurve, finalRun.strategy),
      ...annualReturns(oldCosted.equityCurve, oldCosted.strategy),
      ...annualReturns(oldOriginal.equityCurve, oldOriginal.strategy),
    ]),
    writeCsv("trend-runner-old-assets.csv", [
      ...oldCosted.assetRows,
      ...oldOriginal.assetRows,
    ]),
  ];

  console.table(summary);
  console.table(commonSummary);
  console.table(freshCommonSummary);
  console.table(crisisRows);
  console.table(finalGlobalRegimeSummary);
  console.table(finalGlobalRegimeCrisisSummary);
  console.log("Archivos generados:");
  for (const file of files) console.log(file);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

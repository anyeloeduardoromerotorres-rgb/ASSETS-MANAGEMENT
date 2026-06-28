import { TREND_RUNNER_PARAMS as P } from "./trendRunner.config.js";

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

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

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;

    if (current === null) {
      seed.push(value);
      if (seed.length === length) {
        current = mean(seed);
        result[i] = current;
      }
    } else {
      current = alpha * value + (1 - alpha) * current;
      result[i] = current;
    }
  }

  return result;
}

function wilderRsi(values, length) {
  const result = Array(values.length).fill(null);
  let avgGain = null;
  let avgLoss = null;
  const seedGains = [];
  const seedLosses = [];

  for (let i = 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (avgGain === null) {
      seedGains.push(gain);
      seedLosses.push(loss);
      if (seedGains.length === length) {
        avgGain = mean(seedGains);
        avgLoss = mean(seedLosses);
      } else {
        continue;
      }
    } else {
      avgGain = (avgGain * (length - 1) + gain) / length;
      avgLoss = (avgLoss * (length - 1) + loss) / length;
    }

    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

function wilderAtr(bars, length) {
  const result = Array(bars.length).fill(null);
  const trueRanges = bars.map((bar, index) => {
    if (index === 0) return bar.high - bar.low;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - bars[index - 1].close),
      Math.abs(bar.low - bars[index - 1].close)
    );
  });

  let current = null;
  for (let i = 0; i < trueRanges.length; i += 1) {
    if (i === length - 1) {
      current = mean(trueRanges.slice(0, length));
      result[i] = current;
    } else if (i >= length) {
      current = (current * (length - 1) + trueRanges[i]) / length;
      result[i] = current;
    }
  }

  return result;
}

function prefix(values) {
  const result = [0];
  for (const value of values) {
    result.push(result[result.length - 1] + (Number.isFinite(value) ? value : 0));
  }
  return result;
}

function rangeSum(prefixValues, start, end) {
  if (start < 0 || end < start) return null;
  return prefixValues[end + 1] - prefixValues[start];
}

function rollingRegression(prefixY, prefixY2, prefixXY, start, end) {
  const n = end - start + 1;
  if (start < 0 || n < 2) return null;

  const sumX = ((start + end) * n) / 2;
  const sumX2 = (
    end * (end + 1) * (2 * end + 1)
    - (start - 1) * start * (2 * start - 1)
  ) / 6;
  const sumY = rangeSum(prefixY, start, end);
  const sumY2 = rangeSum(prefixY2, start, end);
  const sumXY = rangeSum(prefixXY, start, end);
  const covarianceNumerator = n * sumXY - sumX * sumY;
  const xVarianceNumerator = n * sumX2 - sumX ** 2;
  const yVarianceNumerator = n * sumY2 - sumY ** 2;

  if (xVarianceNumerator <= 0 || yVarianceNumerator <= 0) {
    return {
      slope: xVarianceNumerator ? covarianceNumerator / xVarianceNumerator : null,
      correlation: null,
    };
  }

  return {
    slope: covarianceNumerator / xVarianceNumerator,
    correlation: covarianceNumerator / Math.sqrt(
      xVarianceNumerator * yVarianceNumerator
    ),
  };
}

function mondayKey(date) {
  const value = new Date(`${isoDate(date)}T00:00:00.000Z`);
  const day = value.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  value.setUTCDate(value.getUTCDate() - daysSinceMonday);
  return isoDate(value);
}

function weeklySeries(bars, length) {
  const weeks = [];
  const dailyWeekIndex = [];
  let currentKey = null;

  for (let i = 0; i < bars.length; i += 1) {
    const key = mondayKey(bars[i].date);
    if (key !== currentKey) {
      weeks.push({ key, close: bars[i].close });
      currentKey = key;
    } else {
      weeks[weeks.length - 1].close = bars[i].close;
    }
    dailyWeekIndex[i] = weeks.length - 1;
  }

  const weeklyEma = ema(weeks.map((week) => week.close), length);
  return { weeks, weeklyEma, dailyWeekIndex };
}

export function historyConfig(asset) {
  const crypto = asset.market === "crypto" || asset.crypto === true;
  const barsPerYear = crypto ? 365 : 252;
  const driftYears = crypto ? 5 : 10;
  const evalYears = crypto ? 5 : 10;
  const rollingYears = crypto ? 2 : 5;
  const driftMax = crypto ? 60 : 15;
  const driftLookback = driftYears * barsPerYear;
  const evalLength = evalYears * barsPerYear;
  const rollingLength = rollingYears * barsPerYear;
  const requiredBars = Math.max(
    driftLookback + 10,
    evalLength + rollingLength + 10,
    evalLength + P.emaPersistenceLen + 10
  );

  return {
    barsPerYear,
    driftYears,
    evalYears,
    rollingYears,
    driftMax,
    driftLookback,
    evalLength,
    rollingLength,
    requiredBars,
  };
}

export function calculateIndicators(asset, bars) {
  const history = historyConfig(asset);
  const closes = bars.map((bar) => bar.close);
  const logPrices = closes.map(Math.log);
  const emaFast = ema(closes, P.emaFastLen);
  const emaSlow = ema(closes, P.emaSlowLen);
  const emaTrend = ema(closes, P.emaTrendLen);
  const emaPersistence = ema(closes, P.emaPersistenceLen);
  const rsi = wilderRsi(closes, P.rsiLen);
  const atr = wilderAtr(bars, P.atrLen);
  const { weeks, weeklyEma, dailyWeekIndex } = weeklySeries(bars, P.weeklyEmaLen);

  const prefixLog = prefix(logPrices);
  const prefixLog2 = prefix(logPrices.map((value) => value ** 2));
  const prefixIndexLog = prefix(logPrices.map((value, index) => value * index));
  const rollingPositive = closes.map((close, index) => (
    index >= history.rollingLength && close > closes[index - history.rollingLength] ? 1 : 0
  ));
  const abovePersistence = closes.map((close, index) => (
    Number.isFinite(emaPersistence[index]) && close > emaPersistence[index] ? 1 : 0
  ));
  const prefixRollingPositive = prefix(rollingPositive);
  const prefixAbovePersistence = prefix(abovePersistence);

  const hold = Array(bars.length).fill(null);

  for (let i = history.requiredBars - 1; i < bars.length; i += 1) {
    const regression = rollingRegression(
      prefixLog,
      prefixLog2,
      prefixIndexLog,
      i - history.driftLookback + 1,
      i
    );

    if (
      !regression
      || !Number.isFinite(regression.slope)
      || !Number.isFinite(regression.correlation)
    ) {
      continue;
    }

    const driftAnnual = (Math.exp(regression.slope * history.barsPerYear) - 1) * 100;
    const driftScore = clamp((driftAnnual / history.driftMax) * 100, 0, 100);
    const consistencyPct = (
      rangeSum(prefixRollingPositive, i - history.evalLength + 1, i) / history.evalLength
    ) * 100;
    const consistencyScore = clamp(((consistencyPct - 50) / 40) * 100, 0, 100);
    const persistencePct = (
      rangeSum(prefixAbovePersistence, i - history.evalLength + 1, i) / history.evalLength
    ) * 100;
    const persistenceScore = clamp(((persistencePct - 45) / 35) * 100, 0, 100);
    const trendR2 = regression.correlation ** 2;
    const trendQualityScore = clamp(((trendR2 - 0.3) / 0.5) * 100, 0, 100);
    const score = clamp(
      driftScore * 0.4
      + consistencyScore * 0.25
      + persistenceScore * 0.2
      + trendQualityScore * 0.15,
      0,
      100
    );
    const factor = score / 100;

    hold[i] = {
      score,
      driftAnnual,
      driftScore,
      consistencyPct,
      consistencyScore,
      persistencePct,
      persistenceScore,
      trendR2,
      trendQualityScore,
      tp1Rr: P.tp1RrMin + (P.tp1RrMax - P.tp1RrMin) * factor,
      tp1QtyPct: P.tp1QtyMax - (P.tp1QtyMax - P.tp1QtyMin) * factor,
      trailAtr: P.trailAtrMin + (P.trailAtrMax - P.trailAtrMin) * factor,
      finalTpRr: P.finalTpMin + (P.finalTpMax - P.finalTpMin) * factor,
    };
  }

  const weekly = bars.map((_bar, index) => {
    const completedIndex = dailyWeekIndex[index] - 1;
    const slopeIndex = completedIndex - P.weeklySlopeLookback;
    if (completedIndex < 0 || slopeIndex < 0) return null;
    return {
      close: weeks[completedIndex].close,
      ema: weeklyEma[completedIndex],
      emaPrevious: weeklyEma[slopeIndex],
    };
  });

  return { history, emaFast, emaSlow, emaTrend, rsi, atr, weekly, hold };
}

function lowest(bars, end, lookback, field) {
  let value = Infinity;
  for (let i = Math.max(0, end - lookback + 1); i <= end; i += 1) {
    value = Math.min(value, bars[i][field]);
  }
  return value;
}

function highest(bars, end, lookback, field) {
  let value = -Infinity;
  for (let i = Math.max(0, end - lookback + 1); i <= end; i += 1) {
    value = Math.max(value, bars[i][field]);
  }
  return value;
}

export function signalAt(index, bars, indicators, holdScore) {
  const { emaFast, emaSlow, emaTrend, rsi, weekly } = indicators;
  const minIndex = Math.max(
    P.emaTrendLen,
    P.breakoutLen,
    P.pullbackLookback,
    P.slopeLookback
  ) + 2;

  if (
    index < minIndex
    || !indicators.hold[index]
    || !weekly[index]
    || !Number.isFinite(emaFast[index])
    || !Number.isFinite(emaSlow[index])
    || !Number.isFinite(emaTrend[index])
    || !Number.isFinite(rsi[index])
  ) {
    return null;
  }

  const weeklyTrendOk = (
    weekly[index].close > weekly[index].ema
    && weekly[index].ema > weekly[index].emaPrevious
  );
  const slopeOk = emaTrend[index] > emaTrend[index - P.slopeLookback];
  const bullRegime = (
    bars[index].close > emaTrend[index]
    && emaSlow[index] > emaTrend[index]
    && weeklyTrendOk
    && slopeOk
  );

  if (!bullRegime) return null;

  const rsiOk = rsi[index] >= P.rsiLongMin && rsi[index] <= P.rsiLongMax;
  const pullback = (
    lowest(bars, index, P.pullbackLookback, "low")
      <= emaFast[index] * (1 + P.pullbackTolerancePct / 100)
    && bars[index].close > emaFast[index]
    && bars[index].close > bars[index - 1].high
    && bars[index].close > bars[index].open
    && rsiOk
  );
  const breakout = (
    bars[index].close > highest(bars, index - 1, P.breakoutLen, "high")
    && rsiOk
  );
  const reentry = (
    holdScore >= P.minReentryHoldScore
    && bars[index].close > emaFast[index]
    && bars[index - 1].close <= emaFast[index - 1]
    && bars[index].close > emaSlow[index]
    && rsi[index] >= P.rsiLongMin
  );

  if (pullback && breakout) return "Pullback + Breakout";
  if (pullback) return "Pullback";
  if (breakout) return "Breakout";
  if (reentry) return "Reentrada";
  return null;
}

export function regimeLost(index, bars, indicators) {
  const weekly = indicators.weekly[index];
  return Boolean(
    P.exitOnRegimeLoss
    && weekly
    && (
      bars[index].close < indicators.emaTrend[index]
      || weekly.close < weekly.ema
    )
  );
}

export function adversePrice(price, side) {
  const slippage = price * (P.slippageBps / 10_000);
  return side === "buy" ? price + slippage : Math.max(0.00000001, price - slippage);
}

export function analyzeBars(asset, bars) {
  const history = historyConfig(asset);

  if (!Array.isArray(bars) || bars.length < history.requiredBars) {
    return {
      historyOk: false,
      requiredBars: history.requiredBars,
      barsCount: Array.isArray(bars) ? bars.length : 0,
      reason: "insufficient_history",
    };
  }

  const indicators = calculateIndicators(asset, bars);
  const index = bars.length - 1;
  const hold = indicators.hold[index];

  if (!hold || !Number.isFinite(hold.score)) {
    return {
      historyOk: false,
      requiredBars: history.requiredBars,
      barsCount: bars.length,
      reason: "hold_score_not_calculable",
    };
  }

  const signalType = hold.score >= P.minEntryHoldScore
    ? signalAt(index, bars, indicators, hold.score)
    : null;

  return {
    historyOk: true,
    requiredBars: history.requiredBars,
    barsCount: bars.length,
    index,
    latestBar: bars[index],
    indicators,
    hold,
    signalType,
    regimeLost: regimeLost(index, bars, indicators),
    atr: indicators.atr[index],
  };
}

export function buildEntryParameters({ entryPrice, atr, hold }) {
  const safeAtr = Number.isFinite(atr) && atr > 0 ? atr : 0;
  const initialStop = entryPrice - safeAtr * P.atrStopMultiple;
  const risk = Math.max(entryPrice - initialStop, 0);
  const tp1Price = entryPrice + risk * hold.tp1Rr;
  const finalTpPrice = entryPrice + risk * hold.finalTpRr;

  return {
    atr: safeAtr,
    tp1Rr: hold.tp1Rr,
    tp1QtyPct: hold.tp1QtyPct,
    trailAtr: hold.trailAtr,
    finalTpRr: hold.finalTpRr,
    initialStop,
    tp1Price,
    finalTpPrice,
    runnerStop: initialStop,
  };
}

import TrendRunnerAsset from "../models/trendRunnerAsset.model.js";
import TrendRunnerSignal from "../models/trendRunnerSignal.model.js";
import TrendRunnerPosition from "../models/trendRunnerPosition.model.js";
import {
  TREND_RUNNER_PARAMS as P,
  TREND_RUNNER_UNIVERSE,
} from "./trendRunner.config.js";
import {
  adversePrice,
  analyzeBars,
  buildEntryParameters,
  historyConfig,
  isoDate,
  signalAt,
} from "./trendRunnerIndicators.service.js";
import {
  fetchDailyBarsForAsset,
  fetchLatestPriceForAsset,
} from "./trendRunnerMarketData.service.js";
import { resolveCapitalForSignal } from "./trendRunnerCapital.service.js";
import {
  buildTrendRunnerGlobalRegimeContext,
  evaluateTrendRunnerGlobalRegime,
} from "./trendRunnerGlobalRegime.service.js";
import { buildTrendRunnerSignalQualityFromOpenAnalysis } from "./trendRunnerSignalQuality.service.js";
import { sendTrendRunnerPush } from "./trendRunnerNotification.service.js";

const STOCK_MARKETS = new Set(["etf", "stock", "adr"]);
const EPSILON = 1e-10;

const round8 = (value) => Number((Number(value) || 0).toFixed(8));

const toFinite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const isStockMarket = (market) => STOCK_MARKETS.has(market);

function normalizeMarketFilter(market) {
  if (!market || market === "all") return {};
  if (market === "stocks") return { market: { $in: [...STOCK_MARKETS] } };
  if (market === "crypto") return { market: "crypto" };
  return { market };
}

function holdSnapshot(hold) {
  if (!hold) return undefined;
  return {
    score: hold.score,
    driftAnnual: hold.driftAnnual,
    driftScore: hold.driftScore,
    consistencyPct: hold.consistencyPct,
    consistencyScore: hold.consistencyScore,
    persistencePct: hold.persistencePct,
    persistenceScore: hold.persistenceScore,
    trendR2: hold.trendR2,
    trendQualityScore: hold.trendQualityScore,
  };
}

function analysisAtIndex(analysis, bars, index) {
  const hold = analysis.indicators?.hold?.[index];
  const signalType = hold?.score >= P.minEntryHoldScore
    ? signalAt(index, bars, analysis.indicators, hold.score)
    : null;

  return {
    ...analysis,
    index,
    latestBar: bars[index],
    hold,
    signalType,
    atr: analysis.indicators?.atr?.[index],
  };
}

function findCurrentOpenSignalTriggerAnalysis(analysis, bars) {
  if (
    !analysis?.signalType
    || !analysis?.indicators
    || !Array.isArray(bars)
    || !Number.isInteger(analysis.index)
  ) {
    return analysis;
  }

  let triggerIndex = analysis.index;

  for (let index = analysis.index - 1; index >= 0; index -= 1) {
    const hold = analysis.indicators.hold?.[index];
    if (!hold || hold.score < P.minEntryHoldScore) break;

    const signalType = signalAt(index, bars, analysis.indicators, hold.score);
    if (!signalType) break;

    triggerIndex = index;
  }

  return analysisAtIndex(analysis, bars, triggerIndex);
}

function normalizeFeeParts(fees, fallbackAmount, fallbackCurrency = "USD") {
  const rows = [];

  if (Array.isArray(fees)) {
    for (const fee of fees) {
      const amount = toFinite(fee?.amount, 0);
      if (amount <= 0) continue;
      const currency = String(fee?.currency || fallbackCurrency || "USD").toUpperCase();
      const usdValue = toFinite(fee?.usdValue, amount);
      rows.push({ amount: round8(amount), currency, usdValue: round8(usdValue) });
    }
  } else {
    const amount = toFinite(fallbackAmount, 0);
    if (amount > 0) {
      rows.push({
        amount: round8(amount),
        currency: String(fallbackCurrency || "USD").toUpperCase(),
        usdValue: round8(amount),
      });
    }
  }

  const totalUsd = round8(rows.reduce((sum, fee) => sum + toFinite(fee.usdValue), 0));
  return { normalizedFees: rows, totalUsd };
}

function splitFeeParts(fees, proportion) {
  if (!Array.isArray(fees) || !Number.isFinite(proportion) || proportion <= 0) {
    return [];
  }

  return fees
    .map((fee) => ({
      amount: round8(toFinite(fee.amount) * proportion),
      currency: fee.currency,
      usdValue: round8(toFinite(fee.usdValue) * proportion),
    }))
    .filter((fee) => fee.amount > 0 || fee.usdValue > 0);
}

function calculateProfit(position) {
  if (
    position.closeValueFiat == null
    || position.openValueFiat == null
    || position.openValueFiat <= 0
  ) {
    return;
  }

  const totalFees = toFinite(position.openFee) + toFinite(position.closeFee);
  const grossProfit = position.closeValueFiat - position.openValueFiat;
  const netProfit = grossProfit - totalFees;
  position.profitTotalFiat = netProfit;
  position.profitPercent = (netProfit / position.openValueFiat) * 100;
}

function buildNotificationForSignal(signal) {
  if (signal.side === "close") {
    return {
      title: `Trend Runner cierre: ${signal.symbol}`,
      body: `${signal.signalType} cerca de ${toFinite(signal.suggested?.price).toFixed(4)}`,
    };
  }

  const capital = toFinite(signal.suggested?.capitalUsd);
  const shvNote = signal.suggested?.requiresShvSale ? " Requiere vender SHV." : "";
  const partialNote = signal.suggested?.isPartialPosition
    ? ` Posicion parcial; objetivo $${toFinite(signal.suggested?.desiredCapitalUsd).toFixed(2)}.`
    : "";
  const qualityNote = signal.quality?.score
    ? ` Calidad ${signal.quality.grade ?? "-"} ${toFinite(signal.quality.score).toFixed(1)}.`
    : "";
  return {
    title: `Trend Runner entrada: ${signal.symbol}`,
    body: `${signal.signalType}. Hold Score ${toFinite(signal.hold?.score).toFixed(
      1
    )}.${qualityNote} Capital sugerido $${capital.toFixed(2)}.${partialNote}${shvNote}`,
  };
}

async function notifySignalOnce(signal) {
  if (signal.notification?.sentAt) return signal;

  const { title, body } = buildNotificationForSignal(signal);

  try {
    await sendTrendRunnerPush({
      title,
      body,
      data: {
        type: "trend_runner_signal",
        signalId: String(signal._id),
        side: signal.side,
        symbol: signal.symbol,
      },
    });
    signal.notification = { sentAt: new Date(), title, body };
  } catch (error) {
    signal.notification = {
      title,
      body,
      error: error.response?.data?.errors?.[0]?.message ?? error.message,
    };
  }

  await signal.save();
  return signal;
}

async function deactivateActiveSignals(query, reason = "conditions_not_met") {
  await TrendRunnerSignal.updateMany(
    { ...query, status: "active" },
    {
      status: "inactive",
      deactivatedAt: new Date(),
      omissionReason: reason,
      lastCheckedAt: new Date(),
    }
  );
}

async function updateAssetScanMetadata(asset, analysis, error = null) {
  asset.requiredBars = analysis?.requiredBars ?? historyConfig(asset).requiredBars;
  asset.lastHistoryOk = Boolean(analysis?.historyOk);
  asset.lastBarsCount = analysis?.barsCount ?? 0;
  asset.lastHoldScore = analysis?.hold?.score;
  asset.lastSignalType = analysis?.signalType ?? undefined;
  asset.lastScanAt = new Date();
  asset.lastError = error ? String(error.message || error) : undefined;
  await asset.save();
}

export async function seedTrendRunnerUniverse() {
  const results = [];

  for (const item of TREND_RUNNER_UNIVERSE) {
    const config = historyConfig(item);
    const doc = await TrendRunnerAsset.findOneAndUpdate(
      { symbol: item.symbol },
      {
        ...item,
        requiredBars: config.requiredBars,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    results.push(doc);
  }

  return results;
}

async function hasOpenPositionForSymbol(symbol) {
  const existing = await TrendRunnerPosition.exists({ symbol, status: "open" });
  return Boolean(existing);
}

async function upsertOmittedOpenSignal(asset, analysis, capital, price) {
  const signalDateKey = analysis.latestBar?.date ?? isoDate(new Date());

  const signal = await TrendRunnerSignal.findOneAndUpdate(
    {
      symbol: asset.symbol,
      side: "open",
      signalDateKey,
      signalType: analysis.signalType,
      status: "omitted",
    },
    {
      asset: asset._id,
      symbol: asset.symbol,
      market: asset.market,
      side: "open",
      status: "omitted",
      signalType: analysis.signalType,
      timeframe: "1d",
      signalDateKey,
      detectedAt: new Date(),
      lastCheckedAt: new Date(),
      hold: holdSnapshot(analysis.hold),
      suggested: {
        price,
        desiredCapitalUsd: capital.desiredCapitalUsd,
        isPartialPosition: false,
        capitalSource: "INSUFFICIENT",
        fiatCurrency: asset.quoteCurrency,
        availableCashUsd: capital.availableCashUsd,
        availableUsd: capital.availableUsdAfterOpen,
        availableShvUsd: capital.shvUsd,
        availableUsdt: capital.availableUsdt,
      },
      omissionReason: capital.omissionReason ?? "insufficient_capital",
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await deactivateActiveSignals(
    { symbol: asset.symbol, side: "open" },
    signal.omissionReason
  );

  return signal;
}

async function upsertActiveOpenSignal(asset, analysis, capital, price, latestAnalysis = analysis) {
  const params = buildEntryParameters({
    entryPrice: price,
    atr: analysis.atr,
    hold: analysis.hold,
  });
  const signalDateKey = analysis.latestBar?.date ?? isoDate(new Date());
  const suggestedQuantity = capital.suggestedQuantity;
  const quality = buildTrendRunnerSignalQualityFromOpenAnalysis({
    analysis,
    params,
    capital,
    price,
  });

  let signal = await TrendRunnerSignal.findOne({
    symbol: asset.symbol,
    side: "open",
    status: "active",
  });

  const triggerBar = analysis.latestBar;
  const triggerDateKey = triggerBar?.date ?? signalDateKey;

  const payload = {
    asset: asset._id,
    symbol: asset.symbol,
    market: asset.market,
    side: "open",
    status: "active",
    signalType: analysis.signalType,
    timeframe: "1d",
    signalDateKey: triggerDateKey,
    lastCheckedAt: new Date(),
    hold: holdSnapshot(analysis.hold),
    parameters: params,
    quality,
    suggested: {
      price,
      capitalUsd: capital.targetCapitalUsd,
      desiredCapitalUsd: capital.desiredCapitalUsd,
      quantity: suggestedQuantity,
      valueFiat: capital.targetCapitalUsd,
      fiatCurrency: capital.fiatCurrency,
      capitalSource: capital.capitalSource,
      requiresShvSale: capital.requiresShvSale,
      isPartialPosition: capital.isPartialPosition,
      availableCashUsd: capital.availableCashUsd,
      availableUsd: capital.availableUsdAfterOpen,
      availableShvUsd: capital.shvUsd,
      availableUsdt: capital.availableUsdt,
    },
    omissionReason: null,
    raw: {
      triggerBar,
      latestBar: latestAnalysis.latestBar,
      requiredBars: latestAnalysis.requiredBars,
      barsCount: latestAnalysis.barsCount,
    },
  };

  if (!signal) {
    signal = new TrendRunnerSignal({
      ...payload,
      detectedAt: new Date(),
    });
  } else {
    Object.assign(signal, payload);
  }

  await signal.save();
  await notifySignalOnce(signal);
  return signal;
}

export async function scanOneAssetForOpenSignal(asset, { globalRegimeContext = null } = {}) {
  try {
    const regimeContext = globalRegimeContext
      ?? await buildTrendRunnerGlobalRegimeContext({
        market: asset.market === "crypto" ? "crypto" : "stocks",
      });
    const bars = await fetchDailyBarsForAsset(asset);
    const analysis = analyzeBars(asset, bars);
    await updateAssetScanMetadata(asset, analysis);

    if (!analysis.historyOk) {
      await deactivateActiveSignals(
        { symbol: asset.symbol, side: "open" },
        analysis.reason
      );
      return { symbol: asset.symbol, status: "ignored", reason: analysis.reason };
    }

    if (await hasOpenPositionForSymbol(asset.symbol)) {
      await deactivateActiveSignals(
        { symbol: asset.symbol, side: "open" },
        "position_already_open"
      );
      return { symbol: asset.symbol, status: "skipped", reason: "position_already_open" };
    }

    if (!analysis.signalType) {
      await deactivateActiveSignals(
        { symbol: asset.symbol, side: "open" },
        "conditions_not_met"
      );
      return { symbol: asset.symbol, status: "none" };
    }

    const globalRegime = evaluateTrendRunnerGlobalRegime(asset, analysis, regimeContext);
    if (!globalRegime.allowed) {
      await deactivateActiveSignals(
        { symbol: asset.symbol, side: "open" },
        globalRegime.reason
      );
      return {
        symbol: asset.symbol,
        status: "skipped",
        reason: globalRegime.reason,
        globalRegime: {
          bearish: globalRegime.bearish,
          reason: globalRegime.regime?.reason,
          benchmarks: globalRegime.regime?.benchmarks?.map((benchmark) => ({
            symbol: benchmark.symbol,
            available: benchmark.available,
            bearish: benchmark.bearish,
            reason: benchmark.reason,
          })),
        },
      };
    }

    const triggerAnalysis = findCurrentOpenSignalTriggerAnalysis(analysis, bars);
    const price = adversePrice(triggerAnalysis.latestBar.close, "buy");
    const capital = await resolveCapitalForSignal(asset, price);

    if (!capital.canOpen) {
      const signal = await upsertOmittedOpenSignal(asset, triggerAnalysis, capital, price);
      return {
        symbol: asset.symbol,
        status: "omitted",
        reason: signal.omissionReason,
      };
    }

    const signal = await upsertActiveOpenSignal(
      asset,
      triggerAnalysis,
      capital,
      price,
      analysis
    );
    return {
      symbol: asset.symbol,
      status: "active",
      signalId: signal._id,
      signalType: signal.signalType,
      holdScore: signal.hold?.score,
    };
  } catch (error) {
    await updateAssetScanMetadata(asset, { historyOk: false, barsCount: 0 }, error);
    await deactivateActiveSignals(
      { symbol: asset.symbol, side: "open" },
      "scan_error"
    );
    return { symbol: asset.symbol, status: "error", error: error.message };
  }
}

export async function scanOpenSignals({ market = "all" } = {}) {
  await seedTrendRunnerUniverse();
  const globalRegimeContext = await buildTrendRunnerGlobalRegimeContext({ market });
  const assets = await TrendRunnerAsset.find({
    enabled: true,
    ...normalizeMarketFilter(market),
  }).sort({ market: 1, symbol: 1 });

  const results = [];
  for (const asset of assets) {
    results.push(await scanOneAssetForOpenSignal(asset, { globalRegimeContext }));
  }

  return {
    scanned: assets.length,
    active: results.filter((row) => row.status === "active").length,
    omitted: results.filter((row) => row.status === "omitted").length,
    skipped: results.filter((row) => row.status === "skipped").length,
    ignored: results.filter((row) => row.status === "ignored").length,
    errors: results.filter((row) => row.status === "error").length,
    results,
  };
}

export async function refreshActiveOpenSignals({ market = "all" } = {}) {
  const query = {
    side: "open",
    status: "active",
  };

  if (market === "crypto") query.market = "crypto";
  if (market === "stocks") query.market = { $in: [...STOCK_MARKETS] };

  const globalRegimeContext = await buildTrendRunnerGlobalRegimeContext({ market });
  const activeSignals = await TrendRunnerSignal.find(query).populate("asset");
  const results = [];

  for (const signal of activeSignals) {
    if (!signal.asset) {
      await deactivateActiveSignals({ _id: signal._id }, "asset_missing");
      results.push({ signalId: signal._id, status: "inactive", reason: "asset_missing" });
      continue;
    }

    const result = await scanOneAssetForOpenSignal(signal.asset, { globalRegimeContext });
    results.push({ signalId: signal._id, ...result });
  }

  return {
    checked: activeSignals.length,
    results,
  };
}

function determineExitFromPosition(position, analysis, latestPrice) {
  const strategy = position.strategy ?? {};
  const currentPrice = toFinite(latestPrice, analysis?.latestBar?.close ?? 0);
  if (currentPrice <= 0) return null;

  const amount = toFinite(position.amount);
  const qtyTp1 = Math.min(toFinite(strategy.qtyTp1), amount);
  const qtyRunner = Math.min(toFinite(strategy.qtyRunner), amount);
  const initialStop = toFinite(strategy.initialStop);
  const tp1Price = toFinite(strategy.tp1Price);
  const runnerStop = toFinite(strategy.runnerStop);

  const tp1StopHit = qtyTp1 > EPSILON && initialStop > 0 && currentPrice <= initialStop;
  const runnerStopHit = qtyRunner > EPSILON && runnerStop > 0 && currentPrice <= runnerStop;

  if (tp1StopHit || runnerStopHit) {
    const quantity = round8(
      (tp1StopHit ? qtyTp1 : 0) + (runnerStopHit ? qtyRunner : 0)
    );
    const signalType = tp1StopHit && runnerStopHit
      ? "Stop loss"
      : tp1StopHit
        ? "Stop inicial"
        : "Trailing/stop runner";
    const reason = tp1StopHit && runnerStopHit
      ? "stop_loss"
      : tp1StopHit
        ? "initial_stop"
        : "runner_trailing_stop";

    return {
      signalType,
      reason,
      quantity,
      price: currentPrice,
    };
  }

  if (!strategy.tp1Reached && qtyTp1 > EPSILON && tp1Price > 0 && currentPrice >= tp1Price) {
    return {
      signalType: "TP1",
      reason: "tp1",
      quantity: qtyTp1,
      price: currentPrice,
    };
  }

  if (analysis?.regimeLost && amount > EPSILON) {
    return {
      signalType: "Perdida de regimen",
      reason: "regime_loss",
      quantity: amount,
      price: currentPrice,
    };
  }

  return null;
}

async function updatePositionTrailingState(position, analysis, latestPrice) {
  const strategy = position.strategy ?? {};
  const latestBar = analysis?.latestBar;
  const currentPrice = toFinite(latestPrice, latestBar?.close ?? position.openPrice);
  const highCandidate = Math.max(
    toFinite(strategy.highestSinceEntry, position.openPrice),
    toFinite(latestBar?.high, currentPrice),
    currentPrice
  );
  const lowCandidate = Math.min(
    toFinite(strategy.lowestSinceEntry, position.openPrice),
    toFinite(latestBar?.low, currentPrice),
    currentPrice
  );

  let runnerStop = toFinite(strategy.runnerStop, strategy.initialStop);
  const atr = toFinite(analysis?.atr);
  const trailAtr = toFinite(strategy.trailAtr);

  if (atr > 0 && trailAtr > 0) {
    const chandelier = highCandidate - atr * trailAtr;
    runnerStop = Math.max(
      toFinite(strategy.initialStop),
      runnerStop,
      chandelier
    );
  }

  position.strategy = {
    ...strategy,
    highestSinceEntry: highCandidate,
    lowestSinceEntry: lowCandidate,
    runnerStop,
  };
  await position.save();
}

async function upsertCloseSignal(position, exitInfo) {
  let signal = await TrendRunnerSignal.findOne({
    side: "close",
    status: "active",
    position: position._id,
  });

  const payload = {
    asset: position.asset,
    position: position._id,
    symbol: position.symbol,
    market: position.market,
    side: "close",
    status: "active",
    signalType: exitInfo.signalType,
    reason: exitInfo.reason,
    timeframe: "intraday",
    signalDateKey: isoDate(new Date()),
    lastCheckedAt: new Date(),
    hold: position.strategy?.hold,
    parameters: {
      initialStop: position.strategy?.initialStop,
      tp1Price: position.strategy?.tp1Price,
      runnerStop: position.strategy?.runnerStop,
      trailAtr: position.strategy?.trailAtr,
    },
    suggested: {
      price: exitInfo.price,
      quantity: exitInfo.quantity,
      valueFiat: exitInfo.quantity * exitInfo.price,
      fiatCurrency: position.fiatCurrency,
      capitalSource: position.capitalSource === "USDT" ? "USDT" : "USD",
    },
    omissionReason: null,
  };

  if (!signal) {
    signal = new TrendRunnerSignal({
      ...payload,
      detectedAt: new Date(),
    });
  } else {
    Object.assign(signal, payload);
  }

  await signal.save();
  await notifySignalOnce(signal);
  return signal;
}

export async function scanCloseSignals({ market = "all" } = {}) {
  const positionQuery = { status: "open" };
  if (market === "crypto") positionQuery.market = "crypto";
  if (market === "stocks") positionQuery.market = { $in: [...STOCK_MARKETS] };

  const positions = await TrendRunnerPosition.find(positionQuery).populate("asset");
  const results = [];

  for (const position of positions) {
    try {
      if (!position.asset) {
        await deactivateActiveSignals(
          { side: "close", position: position._id },
          "asset_missing"
        );
        results.push({ positionId: position._id, symbol: position.symbol, status: "error", reason: "asset_missing" });
        continue;
      }

      const [bars, latestPrice] = await Promise.all([
        fetchDailyBarsForAsset(position.asset),
        fetchLatestPriceForAsset(position.asset).catch(() => null),
      ]);
      const analysis = analyzeBars(position.asset, bars);
      await updatePositionTrailingState(position, analysis, latestPrice);
      const exitInfo = determineExitFromPosition(position, analysis, latestPrice);

      if (!exitInfo) {
        await deactivateActiveSignals(
          { side: "close", position: position._id },
          "conditions_not_met"
        );
        results.push({ positionId: position._id, symbol: position.symbol, status: "none" });
        continue;
      }

      const signal = await upsertCloseSignal(position, exitInfo);
      results.push({
        positionId: position._id,
        symbol: position.symbol,
        status: "active",
        signalId: signal._id,
        signalType: signal.signalType,
      });
    } catch (error) {
      results.push({
        positionId: position._id,
        symbol: position.symbol,
        status: "error",
        error: error.message,
      });
    }
  }

  return {
    checked: positions.length,
    active: results.filter((row) => row.status === "active").length,
    results,
  };
}

export async function createPositionFromSignal(signalId, payload = {}) {
  const signal = await TrendRunnerSignal.findById(signalId).populate("asset");
  if (!signal) throw new Error("Senal Trend Runner no encontrada");
  if (signal.side !== "open") throw new Error("La senal no es de apertura");
  if (signal.status !== "active") throw new Error("La senal ya no esta activa");

  const openPrice = toFinite(payload.openPrice, signal.suggested?.price);
  const amount = toFinite(payload.amount ?? payload.quantity, signal.suggested?.quantity);
  const openValueFiat = toFinite(payload.openValueFiat, openPrice * amount);
  const openDate = payload.openDate ? new Date(payload.openDate) : new Date();
  const fiatCurrency = String(
    payload.fiatCurrency || signal.suggested?.fiatCurrency || signal.asset?.quoteCurrency || "USD"
  ).toUpperCase();
  const broker = String(payload.broker || signal.asset?.broker || "etoro").toLowerCase();
  const { normalizedFees, totalUsd: openFee } = normalizeFeeParts(
    payload.openFees,
    payload.openFee,
    payload.openFeeCurrency || fiatCurrency
  );

  if (
    !Number.isFinite(openPrice)
    || openPrice <= 0
    || !Number.isFinite(amount)
    || amount <= 0
    || !Number.isFinite(openValueFiat)
    || openValueFiat <= 0
    || Number.isNaN(openDate.getTime())
  ) {
    throw new Error("Datos de apertura invalidos");
  }

  const params = signal.parameters ?? {};
  const tp1QtyPct = toFinite(params.tp1QtyPct, 0);
  const qtyTp1 = round8(amount * (tp1QtyPct / 100));
  const qtyRunner = round8(Math.max(0, amount - qtyTp1));

  const position = await TrendRunnerPosition.create({
    asset: signal.asset?._id,
    sourceSignal: signal._id,
    symbol: signal.symbol,
    market: signal.market,
    broker,
    fiatCurrency,
    capitalSource: signal.suggested?.capitalSource === "USDT"
      ? "USDT"
      : signal.suggested?.capitalSource === "USD+SHV"
        ? "USD+SHV"
        : "USD",
    requiresShvSale: Boolean(signal.suggested?.requiresShvSale),
    openDate,
    openPrice,
    amount: round8(amount),
    openValueFiat: round8(openValueFiat),
    openFee,
    openFees: normalizedFees,
    status: "open",
    strategy: {
      signalType: signal.signalType,
      hold: signal.hold,
      atrAtEntry: params.atr,
      tp1Rr: params.tp1Rr,
      tp1QtyPct,
      trailAtr: params.trailAtr,
      finalTpRr: params.finalTpRr,
      initialStop: params.initialStop,
      tp1Price: params.tp1Price,
      finalTpPrice: params.finalTpPrice,
      runnerStop: params.runnerStop ?? params.initialStop,
      highestSinceEntry: openPrice,
      lowestSinceEntry: openPrice,
      tp1Reached: false,
      qtyTp1,
      qtyRunner,
    },
    notes: payload.notes,
  });

  signal.status = "opened";
  signal.position = position._id;
  signal.deactivatedAt = new Date();
  await signal.save();

  return position;
}

function reduceStrategyQuantities(strategy = {}, closeAmount, reason) {
  const next = { ...strategy };
  let remaining = closeAmount;

  if (String(reason || "").toLowerCase().includes("tp1")) {
    const takeTp1 = Math.min(toFinite(next.qtyTp1), remaining);
    next.qtyTp1 = round8(toFinite(next.qtyTp1) - takeTp1);
    remaining = round8(remaining - takeTp1);
    if (takeTp1 > 0) next.tp1Reached = true;
  }

  if (remaining > EPSILON) {
    const total = toFinite(next.qtyTp1) + toFinite(next.qtyRunner);
    if (total > EPSILON) {
      const tp1Share = toFinite(next.qtyTp1) / total;
      const runnerShare = toFinite(next.qtyRunner) / total;
      next.qtyTp1 = round8(Math.max(0, toFinite(next.qtyTp1) - remaining * tp1Share));
      next.qtyRunner = round8(Math.max(0, toFinite(next.qtyRunner) - remaining * runnerShare));
    }
  }

  return next;
}

export async function closeTrendRunnerPosition(positionId, payload = {}) {
  const position = await TrendRunnerPosition.findById(positionId);
  if (!position) throw new Error("Posicion Trend Runner no encontrada");
  if (position.status === "closed") throw new Error("La posicion ya esta cerrada");

  const closePrice = toFinite(payload.closePrice);
  if (closePrice <= 0) throw new Error("closePrice debe ser valido");

  const closeDate = payload.closeDate ? new Date(payload.closeDate) : new Date();
  if (Number.isNaN(closeDate.getTime())) throw new Error("closeDate invalida");

  const requestedCloseAmount = toFinite(
    payload.closeAmount ?? payload.amount ?? payload.quantity,
    position.amount
  );
  const closeAmount = requestedCloseAmount > 0 ? requestedCloseAmount : position.amount;

  if (closeAmount > position.amount + EPSILON) {
    throw new Error("closeAmount no puede ser mayor que la cantidad abierta");
  }

  const closeValueFiat = toFinite(payload.closeValueFiat, closePrice * closeAmount);
  const { normalizedFees, totalUsd: closeFee } = normalizeFeeParts(
    payload.closeFees,
    payload.closeFee,
    payload.closeFeeCurrency || position.fiatCurrency
  );
  const closeReason = payload.closeReason || payload.reason || "manual";

  if (closeAmount < position.amount - EPSILON) {
    const proportion = closeAmount / position.amount;
    const closedOpenValue = round8(position.openValueFiat * proportion);
    const closedOpenFee = round8(toFinite(position.openFee) * proportion);
    const closedOpenFees = splitFeeParts(position.openFees, proportion);
    const remainingOpenFees = splitFeeParts(position.openFees, 1 - proportion);

    const closedPosition = new TrendRunnerPosition({
      asset: position.asset,
      sourceSignal: position.sourceSignal,
      parentPosition: position._id,
      symbol: position.symbol,
      market: position.market,
      broker: position.broker,
      fiatCurrency: position.fiatCurrency,
      capitalSource: position.capitalSource,
      requiresShvSale: position.requiresShvSale,
      openDate: position.openDate,
      openPrice: position.openPrice,
      amount: round8(closeAmount),
      openValueFiat: closedOpenValue,
      openFee: closedOpenFee,
      openFees: closedOpenFees,
      closeDate,
      closePrice,
      closeValueFiat: round8(closeValueFiat),
      closeFee,
      closeFees: normalizedFees,
      closeReason,
      status: "closed",
      strategy: {
        ...position.strategy,
        qtyTp1: 0,
        qtyRunner: 0,
      },
      notes: payload.notes ?? position.notes,
    });

    calculateProfit(closedPosition);
    await closedPosition.save();

    position.amount = round8(position.amount - closeAmount);
    position.openValueFiat = round8(position.openValueFiat - closedOpenValue);
    position.openFee = round8(toFinite(position.openFee) - closedOpenFee);
    position.openFees = remainingOpenFees;
    position.strategy = reduceStrategyQuantities(position.strategy, closeAmount, closeReason);
    await position.save();

    await deactivateActiveSignals(
      { side: "close", position: position._id },
      "manual_partial_close"
    );

    return closedPosition;
  }

  position.closeDate = closeDate;
  position.closePrice = closePrice;
  position.closeValueFiat = round8(closeValueFiat);
  position.closeFee = closeFee;
  position.closeFees = normalizedFees;
  position.closeReason = closeReason;
  position.status = "closed";
  position.strategy = {
    ...position.strategy,
    qtyTp1: 0,
    qtyRunner: 0,
  };
  calculateProfit(position);
  await position.save();

  await deactivateActiveSignals(
    { side: "close", position: position._id },
    "manual_full_close"
  );

  return position;
}

export async function updateTrendRunnerPosition(positionId, payload = {}) {
  const position = await TrendRunnerPosition.findById(positionId);
  if (!position) throw new Error("Posicion Trend Runner no encontrada");

  const editableFields = [
    "broker",
    "openDate",
    "openPrice",
    "amount",
    "openValueFiat",
    "openFee",
    "closeDate",
    "closePrice",
    "closeValueFiat",
    "closeFee",
    "closeReason",
    "notes",
  ];

  for (const field of editableFields) {
    if (payload[field] === undefined) continue;
    if (field.endsWith("Date")) {
      const date = new Date(payload[field]);
      if (!Number.isNaN(date.getTime())) position[field] = date;
    } else if (["broker", "closeReason", "notes"].includes(field)) {
      position[field] = payload[field];
    } else {
      const value = Number(payload[field]);
      if (Number.isFinite(value)) position[field] = value;
    }
  }

  if (position.status === "closed") calculateProfit(position);
  await position.save();
  return position;
}

export async function getTrendRunnerOpenBalances() {
  const positions = await TrendRunnerPosition.find({ status: "open" });
  const grouped = new Map();

  for (const position of positions) {
    const current = grouped.get(position.symbol) ?? {
      asset: position.symbol,
      total: 0,
      usdValue: 0,
      market: position.market,
      temporary: true,
    };
    current.total += toFinite(position.amount);
    current.usdValue += toFinite(position.openValueFiat);
    grouped.set(position.symbol, current);
  }

  return [...grouped.values()].map((row) => ({
    ...row,
    total: round8(row.total),
    usdValue: round8(row.usdValue),
  }));
}

export { isStockMarket };

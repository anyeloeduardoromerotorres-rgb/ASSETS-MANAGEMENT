import ConfigInfo from "../models/configInfo.model.js";
import TrendRunnerPosition from "../models/trendRunnerPosition.model.js";
import { getAllBalances } from "../scripts/fetchBalanceBinance.js";
import { TREND_RUNNER_PORTFOLIO } from "./trendRunner.config.js";
import { fetchYahooLatestPrice } from "./trendRunnerMarketData.service.js";

const STOCK_MARKETS = new Set(["stock", "etf", "adr"]);

const toFinite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

async function getConfigTotal(names, fallback = 0) {
  const docs = await ConfigInfo.find({ name: { $in: names } });
  for (const name of names) {
    const found = docs.find((doc) => doc.name === name);
    if (found && Number.isFinite(Number(found.total))) return Number(found.total);
  }
  return fallback;
}

export async function getTrendRunnerOpenCapitalUsed(marketGroup) {
  const query = { status: "open" };
  if (marketGroup === "crypto") {
    query.market = "crypto";
  } else if (marketGroup === "stocks") {
    query.market = { $in: [...STOCK_MARKETS] };
  }

  const positions = await TrendRunnerPosition.find(query).select("openValueFiat");
  return positions.reduce((sum, position) => {
    return sum + toFinite(position.openValueFiat);
  }, 0);
}

export async function getStockCashContext() {
  const [etoroUsd, shvAmount, openCapitalUsed] = await Promise.all([
    getConfigTotal(["totalUSDEtoro"], 0),
    getConfigTotal(["totalSHV"], 0),
    getTrendRunnerOpenCapitalUsed("stocks"),
  ]);

  let shvPrice = null;
  try {
    shvPrice = await fetchYahooLatestPrice("SHV");
  } catch (error) {
    shvPrice = null;
  }

  const shvUsd = shvPrice && shvPrice > 0 ? shvAmount * shvPrice : shvAmount;
  const availableUsdAfterOpen = Math.max(0, etoroUsd - openCapitalUsed);
  const availableCashUsd = Math.max(0, etoroUsd + shvUsd - openCapitalUsed);

  return {
    marketGroup: "stocks",
    etoroUsd,
    shvAmount,
    shvPrice,
    shvUsd,
    openCapitalUsed,
    availableUsdAfterOpen,
    availableCashUsd,
  };
}

export async function getCryptoCashContext() {
  const balances = await getAllBalances();
  const usdt = balances.find((balance) => balance.asset === "USDT");
  const availableUsdt = toFinite(usdt?.amount);

  return {
    marketGroup: "crypto",
    availableUsdt,
    availableCashUsd: availableUsdt,
  };
}

function targetCapitalFromAvailable(availableCashUsd) {
  if (availableCashUsd < TREND_RUNNER_PORTFOLIO.minPositionUsd) {
    return {
      targetCapitalUsd: 0,
      canOpen: false,
      omissionReason: "capital_below_minimum",
    };
  }

  const pctCapital = availableCashUsd * (TREND_RUNNER_PORTFOLIO.positionPct / 100);
  const targetCapitalUsd = Math.max(
    TREND_RUNNER_PORTFOLIO.minPositionUsd,
    pctCapital
  );

  if (!TREND_RUNNER_PORTFOLIO.allowMargin && targetCapitalUsd > availableCashUsd) {
    return {
      targetCapitalUsd,
      canOpen: false,
      omissionReason: "insufficient_capital",
    };
  }

  return {
    targetCapitalUsd,
    canOpen: true,
    omissionReason: null,
  };
}

export async function resolveCapitalForSignal(asset, price) {
  const safePrice = toFinite(price);
  if (safePrice <= 0) {
    return {
      canOpen: false,
      omissionReason: "invalid_price",
    };
  }

  if (asset.market === "crypto") {
    const context = await getCryptoCashContext();
    const target = targetCapitalFromAvailable(context.availableUsdt);
    if (!target.canOpen) {
      return {
        ...context,
        ...target,
        canOpen: false,
        capitalSource: "INSUFFICIENT",
        fiatCurrency: "USDT",
      };
    }

    return {
      ...context,
      ...target,
      canOpen: true,
      suggestedQuantity: target.targetCapitalUsd / safePrice,
      capitalSource: "USDT",
      requiresShvSale: false,
      fiatCurrency: "USDT",
    };
  }

  const context = await getStockCashContext();
  const target = targetCapitalFromAvailable(context.availableCashUsd);

  if (!target.canOpen) {
    return {
      ...context,
      ...target,
      canOpen: false,
      capitalSource: "INSUFFICIENT",
      fiatCurrency: "USD",
    };
  }

  const requiresShvSale = target.targetCapitalUsd > context.availableUsdAfterOpen;

  return {
    ...context,
    ...target,
    canOpen: true,
    suggestedQuantity: target.targetCapitalUsd / safePrice,
    capitalSource: requiresShvSale ? "USD+SHV" : "USD",
    requiresShvSale,
    fiatCurrency: "USD",
  };
}

export async function getTrendRunnerCapitalSummary() {
  const [stocks, crypto] = await Promise.all([
    getStockCashContext(),
    getCryptoCashContext(),
  ]);

  return {
    settings: TREND_RUNNER_PORTFOLIO,
    stocks,
    crypto,
  };
}

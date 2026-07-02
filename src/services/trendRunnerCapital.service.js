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
  const totalCapitalUsd = availableCashUsd + openCapitalUsed;

  return {
    marketGroup: "stocks",
    etoroUsd,
    shvAmount,
    shvPrice,
    shvUsd,
    openCapitalUsed,
    availableUsdAfterOpen,
    availableCashUsd,
    totalCapitalUsd,
  };
}

export async function getCryptoCashContext() {
  const [balances, openCapitalUsed] = await Promise.all([
    getAllBalances(),
    getTrendRunnerOpenCapitalUsed("crypto"),
  ]);
  const usdt = balances.find((balance) => balance.asset === "USDT");
  const availableUsdt = toFinite(usdt?.amount);

  return {
    marketGroup: "crypto",
    availableUsdt,
    availableCashUsd: availableUsdt,
    openCapitalUsed,
    totalCapitalUsd: availableUsdt + openCapitalUsed,
  };
}

function targetCapitalFromAvailable(context) {
  const availableCashUsd = Math.max(0, toFinite(context?.availableCashUsd));
  const totalCapitalUsd = Math.max(
    availableCashUsd,
    toFinite(context?.totalCapitalUsd, availableCashUsd)
  );
  const desiredCapitalUsd = Math.max(
    TREND_RUNNER_PORTFOLIO.minPositionUsd,
    totalCapitalUsd * (TREND_RUNNER_PORTFOLIO.positionPct / 100)
  );

  if (availableCashUsd < TREND_RUNNER_PORTFOLIO.minPositionUsd) {
    return {
      targetCapitalUsd: 0,
      desiredCapitalUsd,
      isPartialPosition: false,
      canOpen: false,
      omissionReason: "capital_below_minimum",
    };
  }

  if (!TREND_RUNNER_PORTFOLIO.allowMargin && desiredCapitalUsd > availableCashUsd) {
    const partialCapitalUsd = availableCashUsd;
    return {
      targetCapitalUsd: partialCapitalUsd,
      desiredCapitalUsd,
      isPartialPosition: true,
      canOpen: true,
      omissionReason: null,
    };
  }

  return {
    targetCapitalUsd: desiredCapitalUsd,
    desiredCapitalUsd,
    isPartialPosition: false,
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
    const target = targetCapitalFromAvailable(context);
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
  const target = targetCapitalFromAvailable(context);

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

import axios from "axios";
import { getBinanceBaseUrl } from "../utils/binance.utils.js";
import { isoDate } from "./trendRunnerIndicators.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const toNumber = (value, fallback = NaN) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function normalizeYahooBars(result) {
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0] ?? {};
  const adjclose = result?.indicators?.adjclose?.[0]?.adjclose ?? [];

  if (!Array.isArray(timestamps)) return [];

  const bars = timestamps
    .map((ts, index) => {
      const close = toNumber(quote.close?.[index]);
      if (!Number.isFinite(close) || close <= 0) return null;

      const adjustedClose = toNumber(adjclose[index], close);
      const factor = adjustedClose > 0 ? adjustedClose / close : 1;
      const open = toNumber(quote.open?.[index], close) * factor;
      const high = toNumber(quote.high?.[index], close) * factor;
      const low = toNumber(quote.low?.[index], close) * factor;
      const adjusted = close * factor;

      if (![open, high, low, adjusted].every(Number.isFinite)) return null;

      return {
        date: isoDate(new Date(ts * 1000)),
        open,
        high,
        low,
        close: adjusted,
        rawClose: close,
        adjustedClose: adjusted,
        volume: toNumber(quote.volume?.[index], null),
      };
    })
    .filter(Boolean);

  const byDate = new Map();
  for (const bar of bars) byDate.set(bar.date, bar);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchYahooDailyBars(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=max&events=history`;
  const response = await axios.get(url, { timeout: 30000 });
  const result = response.data?.chart?.result?.[0];
  return normalizeYahooBars(result);
}

export async function fetchYahooLatestPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=1d&range=5d`;
  const response = await axios.get(url, { timeout: 15000 });
  const result = response.data?.chart?.result?.[0];
  const metaPrice = toNumber(result?.meta?.regularMarketPrice);
  if (Number.isFinite(metaPrice) && metaPrice > 0) return metaPrice;

  const bars = normalizeYahooBars(result);
  return bars.at(-1)?.close ?? null;
}

function normalizeBinanceKline(kline) {
  const openTime = Number(kline[0]);
  const open = toNumber(kline[1]);
  const high = toNumber(kline[2]);
  const low = toNumber(kline[3]);
  const close = toNumber(kline[4]);
  const volume = toNumber(kline[5], null);

  if (![openTime, open, high, low, close].every(Number.isFinite) || close <= 0) {
    return null;
  }

  return {
    date: isoDate(new Date(openTime)),
    open,
    high,
    low,
    close,
    rawClose: close,
    adjustedClose: close,
    volume,
  };
}

export async function fetchBinanceDailyBars(symbol) {
  const baseUrl = await getBinanceBaseUrl();
  const rows = [];
  let startTime = Date.UTC(2016, 0, 1);
  const endTime = Date.now();
  let guard = 0;

  while (startTime < endTime && guard < 20) {
    guard += 1;
    const response = await axios.get(`${baseUrl}api/v3/klines`, {
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
    const lastOpenTime = Number(page[page.length - 1]?.[0]);
    if (!Number.isFinite(lastOpenTime)) break;
    startTime = lastOpenTime + DAY_MS;

    if (page.length < 1000) break;
  }

  const byDate = new Map();
  rows.map(normalizeBinanceKline).filter(Boolean).forEach((bar) => {
    byDate.set(bar.date, bar);
  });

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchBinanceLatestPrice(symbol) {
  const baseUrl = await getBinanceBaseUrl();
  const response = await axios.get(`${baseUrl}api/v3/ticker/price`, {
    params: { symbol },
    timeout: 15000,
  });
  const price = toNumber(response.data?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export async function fetchDailyBarsForAsset(asset) {
  if (asset.dataSource === "binance") {
    return fetchBinanceDailyBars(asset.dataSymbol);
  }
  return fetchYahooDailyBars(asset.dataSymbol);
}

export async function fetchLatestPriceForAsset(asset) {
  if (asset.dataSource === "binance") {
    return fetchBinanceLatestPrice(asset.dataSymbol);
  }
  return fetchYahooLatestPrice(asset.dataSymbol);
}

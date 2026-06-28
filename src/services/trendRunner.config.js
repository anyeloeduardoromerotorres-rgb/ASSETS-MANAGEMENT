export const TREND_RUNNER_PARAMS = {
  commissionRate: 0.0005,
  slippageBps: 5,
  minEntryHoldScore: 70,
  minReentryHoldScore: 90,
  emaFastLen: 20,
  emaSlowLen: 50,
  emaTrendLen: 200,
  rsiLen: 14,
  rsiLongMin: 45,
  rsiLongMax: 85,
  atrLen: 14,
  atrStopMultiple: 2.2,
  weeklyEmaLen: 30,
  weeklySlopeLookback: 4,
  slopeLookback: 20,
  pullbackLookback: 12,
  pullbackTolerancePct: 0.7,
  breakoutLen: 25,
  emaPersistenceLen: 200,
  tp1RrMin: 1,
  tp1RrMax: 3,
  tp1QtyMax: 60,
  tp1QtyMin: 10,
  trailAtrMin: 2.5,
  trailAtrMax: 8,
  finalTpMin: 4,
  finalTpMax: 25,
  useFinalTp: false,
  exitOnRegimeLoss: true,
};

export const TREND_RUNNER_PORTFOLIO = {
  positionPct: 2.75,
  minPositionUsd: 20,
  allowMargin: false,
  allowFractionalShares: true,
  pyramidSameAsset: false,
};

function yahooAsset(symbol, market, name = symbol) {
  return {
    symbol,
    displaySymbol: symbol,
    dataSymbol: symbol,
    name,
    market,
    broker: "etoro",
    dataSource: "yahoo",
    quoteCurrency: "USD",
    minHistoryYears: 15,
  };
}

function cryptoAsset(base, name = base) {
  const symbol = `${base}USDT`;
  return {
    symbol,
    displaySymbol: symbol,
    dataSymbol: symbol,
    name,
    market: "crypto",
    broker: "binance",
    dataSource: "binance",
    quoteCurrency: "USDT",
    minHistoryYears: 7,
  };
}

const baseUniverse = [
  yahooAsset("SPY", "etf", "SPDR S&P 500 ETF Trust"),
  yahooAsset("QQQ", "etf", "Invesco QQQ Trust"),
  yahooAsset("IWM", "etf", "iShares Russell 2000 ETF"),
  yahooAsset("GLD", "etf", "SPDR Gold Shares"),
  yahooAsset("TLT", "etf", "iShares 20+ Year Treasury Bond ETF"),
  yahooAsset("XLE", "etf", "Energy Select Sector SPDR Fund"),
  yahooAsset("XLV", "etf", "Health Care Select Sector SPDR Fund"),
  yahooAsset("VOO", "etf", "Vanguard S&P 500 ETF"),
  yahooAsset("SCHD", "etf", "Schwab U.S. Dividend Equity ETF"),
  yahooAsset("GLDM", "etf", "SPDR Gold MiniShares Trust"),
  yahooAsset("AAPL", "stock", "Apple Inc."),
  yahooAsset("MSFT", "stock", "Microsoft Corporation"),
  yahooAsset("NVDA", "stock", "NVIDIA Corporation"),
  yahooAsset("AMZN", "stock", "Amazon.com, Inc."),
  yahooAsset("JPM", "stock", "JPMorgan Chase & Co."),
  yahooAsset("XOM", "stock", "Exxon Mobil Corporation"),
  yahooAsset("KO", "stock", "The Coca-Cola Company"),
  yahooAsset("WMT", "stock", "Walmart Inc."),
  yahooAsset("BRK-B", "stock", "Berkshire Hathaway Inc. Class B"),
  yahooAsset("META", "stock", "Meta Platforms, Inc."),
  cryptoAsset("BTC", "Bitcoin"),
  cryptoAsset("ETH", "Ethereum"),
  cryptoAsset("BNB", "BNB"),
  cryptoAsset("SOL", "Solana"),
];

const etfs = [
  "DIA", "MDY", "VTI", "VEA", "VWO", "EFA", "EEM", "EWJ", "EWU", "EWG",
  "EWC", "EWA", "EWY", "EWZ", "EWT", "EWW", "FXI", "XLF", "XLK", "XLY",
  "XLP", "XLU", "XLI", "XLB", "SMH", "IBB", "XBI", "XRT", "KRE", "ITB",
  "XHB", "GDX", "GDXJ", "VNQ", "SLV", "USO", "DBC", "IEF", "SHY", "TIP",
  "AGG", "BND", "LQD", "HYG", "EMB",
];

const stocks = [
  "GOOGL", "GOOG", "TSLA", "BAC", "WFC", "GS", "MS", "V", "MA", "AXP",
  "UNH", "JNJ", "PFE", "MRK", "ABT", "TMO", "DHR", "MDT", "ISRG", "AMGN",
  "LLY", "PG", "PEP", "COST", "HD", "LOW", "MCD", "SBUX", "NKE", "DIS",
  "NFLX", "ORCL", "CSCO", "IBM", "INTC", "AMD", "QCOM", "TXN", "AVGO", "CRM",
  "ADBE", "AMAT", "LRCX", "KLAC", "CAT", "DE", "HON", "UNP", "UPS", "FDX",
  "BA", "LMT", "CVX", "COP", "SLB",
];

const adrs = [
  "TSM", "ASML", "SAP", "TM", "SONY", "NVO", "AZN", "UL", "BHP", "RIO",
  "VALE", "PBR", "BP", "SHEL", "TTE", "HSBC", "RY", "TD", "INFY", "MELI",
];

const cryptos = ["ADA", "XRP", "DOGE", "LTC", "BCH", "LINK", "DOT", "AVAX"];

export const TREND_RUNNER_UNIVERSE = [
  ...baseUniverse,
  ...etfs.map((symbol) => yahooAsset(symbol, "etf")),
  ...stocks.map((symbol) => yahooAsset(symbol, "stock")),
  ...adrs.map((symbol) => yahooAsset(symbol, "adr")),
  ...cryptos.map((symbol) => cryptoAsset(symbol)),
];

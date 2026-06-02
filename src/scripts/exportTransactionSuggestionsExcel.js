import axios from "axios";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { connectdb } from "../db.js";
import Asset from "../models/asset.model.js";
import ConfigInfo from "../models/configInfo.model.js";
import { getAllBalances } from "./fetchBalanceBinance.js";

const REBALANCED_TYPES = new Set(["crypto", "stock", "commodity"]);
const CASH_LIKE_SYMBOLS = new Set(["SHV"]);
const DEFAULT_DNS_SERVERS = ["8.8.8.8", "1.1.1.1"];
const SLOPE_LOW_LIMIT = 0.6;
const MIN_TRADE_USD = 10;

function configureDnsForSrvUri() {
  if (!process.env.BD?.startsWith("mongodb+srv://")) return;
  const configuredServers = process.env.MONGODB_DNS_SERVERS
    ?.split(",")
    .map(item => item.trim())
    .filter(Boolean);
  dns.setServers(configuredServers?.length ? configuredServers : DEFAULT_DNS_SERVERS);
}

function parseArgs(argv) {
  const args = {
    output: "exports/transaction-suggestions-formulas.xls",
    minTradeUsd: MIN_TRADE_USD,
  };

  for (const arg of argv) {
    const [key, rawValue] = arg.replace(/^--/, "").split("=");
    if (!key || rawValue == null) continue;
    if (key === "output") args.output = rawValue;
    if (key === "min-trade") args.minTradeUsd = Number(rawValue);
  }

  return args;
}

function splitSymbol(symbol) {
  const knownQuotes = ["USDT", "USDC", "BUSD", "BTC", "ETH", "USD", "PEN"];
  for (const quote of knownQuotes) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return {
        baseAsset: symbol.slice(0, symbol.length - quote.length),
        quoteAsset: quote,
      };
    }
  }
  return { baseAsset: symbol, quoteAsset: "USD" };
}

function getInitialInvestmentAmount(initialInvestment) {
  if (typeof initialInvestment === "number") return initialInvestment;
  if (!initialInvestment || typeof initialInvestment !== "object") return 0;
  if (typeof initialInvestment.USD === "number") return initialInvestment.USD;
  if (typeof initialInvestment.amount === "number") return initialInvestment.amount;
  return 0;
}

async function fetchBinancePrices() {
  const res = await axios.get("https://api.binance.com/api/v3/ticker/price", { timeout: 30000 });
  const prices = new Map();
  for (const item of res.data ?? []) {
    const price = Number(item.price);
    if (item.symbol && Number.isFinite(price) && price > 0) {
      prices.set(item.symbol, price);
    }
  }
  return prices;
}

async function fetchYahooPrice(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
    const res = await axios.get(url, { timeout: 30000 });
    const price = res.data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

async function fetchExternalPrice(symbol, type, binancePrices) {
  if (type === "stock") {
    return fetchYahooPrice(symbol);
  }

  if (type === "commodity") {
    const yahooSymbol = symbol.includes("=") ? symbol : `${symbol}=X`;
    const yahooPrice = await fetchYahooPrice(yahooSymbol);
    if (yahooPrice) return yahooPrice;
    return binancePrices.get(symbol) ?? null;
  }

  return null;
}

function getConfigNumber(configs, ...names) {
  for (const name of names) {
    const value = configs.get(name);
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

async function fetchPenToUsd() {
  try {
    const res = await axios.get("https://open.er-api.com/v6/latest/PEN", { timeout: 30000 });
    const rate = res.data?.result === "success" ? Number(res.data?.rates?.USD) : null;
    return Number.isFinite(rate) && rate > 0 ? rate : 0;
  } catch {
    return 0;
  }
}

function buildBalanceMap(rawBalances, binancePrices, lastPriceUsdtSell) {
  const map = new Map();
  for (const balance of rawBalances) {
    const asset = String(balance.asset ?? "").toUpperCase();
    const total = Number(balance.amount ?? balance.total ?? 0);
    if (!asset || !Number.isFinite(total) || total <= 0) continue;

    let usdValue = 0;
    if (asset === "USDT") {
      usdValue = total * lastPriceUsdtSell;
    } else {
      const price = binancePrices.get(`${asset}USDT`) ?? binancePrices.get(`${asset}BUSD`) ?? 0;
      usdValue = total * price;
    }

    map.set(asset, { asset, total, usdValue });
  }
  return map;
}

function getHoldingData({
  asset,
  balanceMap,
  totals,
  penToUsd,
  lastPriceUsdtSell,
  fallbackUsdValue = 0,
  fallbackAmount = 0,
}) {
  const upper = String(asset ?? "").toUpperCase();
  if (upper === "USD") return { amount: totals.usd ?? 0, usdValue: totals.usd ?? 0 };
  if (upper === "PEN") {
    const amount = totals.pen ?? 0;
    return { amount, usdValue: penToUsd > 0 ? amount * penToUsd : 0 };
  }
  if (upper === "USDT") {
    const entry = balanceMap.get("USDT");
    const amount = entry?.total ?? 0;
    return { amount, usdValue: amount * (lastPriceUsdtSell || 1) };
  }

  const entry = balanceMap.get(upper);
  if (entry) return { amount: entry.total ?? 0, usdValue: entry.usdValue ?? 0 };
  return { amount: fallbackAmount, usdValue: fallbackUsdValue };
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function numberCell(value, styleId = "Number") {
  const number = Number(value);
  return `<Cell ss:StyleID="${styleId}"><Data ss:Type="Number">${Number.isFinite(number) ? number : 0}</Data></Cell>`;
}

function textCell(value, styleId = "Text") {
  return `<Cell ss:StyleID="${styleId}"><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
}

function formulaCell(formula, styleId = "Number") {
  return `<Cell ss:StyleID="${styleId}" ss:Formula="${xmlEscape(formula)}"><Data ss:Type="Number">0</Data></Cell>`;
}

function formulaTextCell(formula) {
  return `<Cell ss:StyleID="Text" ss:Formula="${xmlEscape(formula)}"><Data ss:Type="String"></Data></Cell>`;
}

function rowXml(cells) {
  return `<Row>${cells.join("")}</Row>`;
}

function buildWorkbook({ rows, generatedAt, minTradeUsd }) {
  const headers = [
    "Symbol",
    "Type",
    "Base",
    "Quote",
    "AllocationUSD",
    "High",
    "Low",
    "SlopePct",
    "Price",
    "ActualBaseUnits",
    "ActualBaseUSD",
    "ActualQuoteUSD",
    "SlopeFraction",
    "SlopeHoldFraction",
    "BaseHoldUSD",
    "QuoteHoldUSD",
    "MaxBaseAllowedUSD",
    "DecisionLow",
    "Normalized",
    "BaseShare",
    "DesiredBaseUSD",
    "RawTargetBaseUSD",
    "SellPressureUSD",
    "AdjustedSellUSD",
    "BuyPressureUSD",
    "AdjustedBuyUSD",
    "TargetBaseUSD",
    "TargetQuoteUSD",
    "BaseDiffUSD",
    "Action",
    "SuggestedBaseAmount",
    "SuggestedQuoteValue",
    "Suggestion",
    "MinTradeUSD",
  ];

  const infoRows = [
    rowXml([textCell("Generado"), textCell(generatedAt)]),
    rowXml([textCell("Nota"), textCell("Las columnas desde SlopeFraction en adelante son formulas editables en Excel.")]),
    rowXml([textCell("Low efectivo"), textCell(`low + (high - low) * MIN(slopeFraction, ${SLOPE_LOW_LIMIT}) cuando slope es positivo.`)]),
    rowXml([textCell("Hold por slope"), textCell("MIN(1, SQRT(ABS(slopeFraction))).")]),
    rowXml([textCell("MinTradeUSD"), numberCell(minTradeUsd)]),
  ];

  const dataRows = [
    rowXml(headers.map(header => textCell(header, "Header"))),
    ...rows.map(row => {
      const f = {
        slopeFraction: "=RC8/100",
        slopeHoldFraction: "=MIN(1,SQRT(ABS(RC13)))",
        baseHoldUsd: "=IF(RC13>0,RC5*RC14,0)",
        quoteHoldUsd: "=IF(RC13<0,RC5*RC14,0)",
        maxBaseAllowed: "=MAX(RC5-RC16,0)",
        decisionLow: `=IF(AND(RC13>0,RC6>RC7),RC7+(RC6-RC7)*MIN(RC13,${SLOPE_LOW_LIMIT}),RC7)`,
        normalized: "=IF(RC6-RC18=0,0.5,MAX(0,MIN(1,(RC9-RC18)/(RC6-RC18))))",
        baseShare: "=MAX(0,MIN(1,1-RC19))",
        desiredBaseUsd: "=RC5*RC20",
        rawTargetBaseUsd: "=MAX(0,MIN(RC21,RC5))",
        sellPressureUsd: "=MAX(0,RC11-RC22)",
        adjustedSellUsd: "=MAX(0,RC23-RC15)",
        buyPressureUsd: "=MAX(0,RC22-RC11)",
        adjustedBuyUsd: "=MAX(0,RC25-RC16)",
        targetBaseUsd: "=IF(AND(RC22-RC11<0,RC15>0),IF(RC24>0,MAX(RC11-RC24,0),RC11),IF(AND(RC22-RC11>0,RC16>0),IF(RC26>0,MIN(RC11+RC26,RC17),RC11),IF(AND(RC16>0,RC22-RC11<0),MIN(RC22,RC17),RC22)))",
        targetQuoteUsd: "=RC5-RC27",
        baseDiffUsd: "=RC27-RC11",
        action: '=IF(ABS(RC29)<RC34,"none",IF(RC29>0,"buy","sell"))',
        suggestedBaseAmount: '=IF(RC30="none",0,ABS(RC29)/RC9)',
        suggestedQuoteValue: '=IF(RC30="none",0,ABS(RC29))',
        suggestion: '=IF(RC30="none","No operar",IF(RC30="buy","Comprar "&TEXT(RC31,"0.000000")&" "&RC3&" (~$"&TEXT(RC32,"0.00")&") usando "&RC4,"Vender "&TEXT(RC31,"0.000000")&" "&RC3&" (~$"&TEXT(RC32,"0.00")&") por "&RC4))',
      };

      return rowXml([
        textCell(row.symbol),
        textCell(row.type),
        textCell(row.baseAsset),
        textCell(row.quoteAsset),
        numberCell(row.allocation),
        numberCell(row.high),
        numberCell(row.low),
        numberCell(row.slope),
        numberCell(row.price),
        numberCell(row.actualBaseUnits),
        numberCell(row.actualBaseUsd),
        numberCell(row.actualQuoteUsd),
        formulaCell(f.slopeFraction),
        formulaCell(f.slopeHoldFraction),
        formulaCell(f.baseHoldUsd),
        formulaCell(f.quoteHoldUsd),
        formulaCell(f.maxBaseAllowed),
        formulaCell(f.decisionLow),
        formulaCell(f.normalized),
        formulaCell(f.baseShare),
        formulaCell(f.desiredBaseUsd),
        formulaCell(f.rawTargetBaseUsd),
        formulaCell(f.sellPressureUsd),
        formulaCell(f.adjustedSellUsd),
        formulaCell(f.buyPressureUsd),
        formulaCell(f.adjustedBuyUsd),
        formulaCell(f.targetBaseUsd),
        formulaCell(f.targetQuoteUsd),
        formulaCell(f.baseDiffUsd),
        formulaTextCell(f.action),
        formulaCell(f.suggestedBaseAmount),
        formulaCell(f.suggestedQuoteValue),
        formulaTextCell(f.suggestion),
        numberCell(minTradeUsd),
      ]);
    }),
  ];

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel">
  <Calculation>Automatic</Calculation>
 </ExcelWorkbook>
 <Styles>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
  <Style ss:ID="Text"><NumberFormat ss:Format="@"/></Style>
  <Style ss:ID="Number"><NumberFormat ss:Format="0.00000000"/></Style>
 </Styles>
 <Worksheet ss:Name="Info">
  <Table>${infoRows.join("")}</Table>
 </Worksheet>
 <Worksheet ss:Name="Transacciones">
  <Table>${dataRows.join("")}</Table>
  <AutoFilter x:Range="R1C1:R${rows.length + 1}C${headers.length}" xmlns="urn:schemas-microsoft-com:office:excel"/>
 </Worksheet>
</Workbook>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  configureDnsForSrvUri();
  await connectdb();

  try {
    const [assets, configsList, rawBalances, binancePrices, penToUsd] = await Promise.all([
      Asset.find({
        type: { $in: Array.from(REBALANCED_TYPES) },
        symbol: { $nin: Array.from(CASH_LIKE_SYMBOLS) },
        totalCapitalWhenLastAdded: { $gt: 0 },
        high: { $gt: 0 },
      }).lean(),
      ConfigInfo.find({}).lean(),
      getAllBalances(),
      fetchBinancePrices(),
      fetchPenToUsd(),
    ]);

    const configs = new Map(configsList.map(item => [item.name, item.total]));
    const lastPriceUsdtSell = getConfigNumber(configs, "PrecioVentaUSDT", "lastPriceUsdtSell") ?? 1;
    const totals = {
      usd: getConfigNumber(configs, "totalUSD") ?? 0,
      pen: getConfigNumber(configs, "totalPen") ?? 0,
    };
    const balanceMap = buildBalanceMap(rawBalances, binancePrices, lastPriceUsdtSell);

    const rows = [];
    for (const asset of assets) {
      const { baseAsset, quoteAsset } = splitSymbol(asset.symbol);
      let price = null;

      if (asset.type === "crypto") {
        price = binancePrices.get(asset.symbol) ?? null;
      } else {
        price = await fetchExternalPrice(asset.symbol, asset.type, binancePrices);
      }

      if (!price || price <= 0) continue;

      const initialAmount = getInitialInvestmentAmount(asset.initialInvestment);
      const fallbackUsdValue = initialAmount * price;
      const baseHolding = getHoldingData({
        asset: baseAsset,
        balanceMap,
        totals,
        penToUsd,
        lastPriceUsdtSell,
        fallbackUsdValue,
        fallbackAmount: initialAmount,
      });
      const quoteHolding = getHoldingData({
        asset: quoteAsset,
        balanceMap,
        totals,
        penToUsd,
        lastPriceUsdtSell,
      });

      rows.push({
        symbol: asset.symbol,
        type: asset.type,
        baseAsset,
        quoteAsset,
        allocation: Number(asset.totalCapitalWhenLastAdded ?? 0),
        high: Number(asset.high ?? 0),
        low: Number(asset.low ?? 0),
        slope: Number(asset.slope ?? 0),
        price,
        actualBaseUnits: baseHolding.amount,
        actualBaseUsd: baseHolding.usdValue,
        actualQuoteUsd: quoteHolding.usdValue,
      });
    }

    const workbook = buildWorkbook({
      rows,
      generatedAt: new Date().toISOString(),
      minTradeUsd: Number.isFinite(args.minTradeUsd) && args.minTradeUsd > 0 ? args.minTradeUsd : MIN_TRADE_USD,
    });

    const outputPath = path.resolve(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, workbook, "utf8");

    console.log(`Archivo creado: ${outputPath}`);
    console.log(`Activos incluidos: ${rows.length}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async err => {
  console.error("Error creando Excel de sugerencias:", err.message);
  await mongoose.disconnect();
  process.exit(1);
});

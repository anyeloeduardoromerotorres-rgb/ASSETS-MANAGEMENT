import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  Button,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import api from "../constants/api";

type AssetDocument = {
  _id: string;
  symbol: string;
  type: "fiat" | "crypto" | "stock" | "commodity";
  totalCapitalWhenLastAdded: number;
  maxPriceSevenYear: number;
  minPriceSevenYear: number;
  slope?: number;
  initialInvestment?: number | Record<string, number>;
  exchange?:
    | string
    | {
        _id?: string;
        id?: string;
        name?: string;
      };
  exchangeName?: string;
};

type BalanceEntry = {
  asset: string;
  total: number;
  usdValue: number;
};

type ConfigInfo = {
  _id: string;
  name: string;
  total: number;
};

type Operation = {
  id: string;
  assetId: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  fiatCurrency: string;
  exchangeId?: string | null;
  exchangeName?: string | null;
  isBinance: boolean;
  usdtUsdRate: number;
  allocation: number;
  price: number;
  priceLabel?: string;
  mode?: "buy" | "sell" | "neutral";
  action: "buy" | "sell";
  // signo de la pendiente (slope) del activo: 1 = positiva, -1 = negativa, 0 = neutra
  slopeSign?: 1 | 0 | -1;
  buyPrice?: number;
  sellPrice?: number;
  suggestedBaseAmount: number;
  suggestedFiatValue: number;
  closingPositions?: Array<{
    id: string;
    amount: number;
    closeValueFiat: number;
    closePrice: number;
  }>;
  residualBaseAmount?: number;
  residualFiatValue?: number;
  targetBaseUsd: number;
  targetQuoteUsd: number;
  targetBasePercent: number;
  actualBaseUsd: number;
  actualQuoteUsd: number;
  baseDiffUsd: number;
  actionMessage: string;
};

type TradeFormState = {
  openPrice: string;
  amount: string;
  openValueFiat: string;
  openFee: string;
  feeCurrency: string;
  openDate: string;
  closeFee: string;
};

type TransactionDoc = {
  _id: string;
  asset: string | { _id?: string };
  type: "long" | "short";
  amount: number;
  openValueFiat: number;
  openPrice: number;
  openFee?: number;
  status: "open" | "closed";
  openDate?: string;
  createdAt?: string;
};

type OpenPosition = {
  id: string;
  amount: number;
  openValueFiat: number;
  openPrice: number;
  openFee: number;
  openDate: number;
};

type OpenPositionsByAsset = {
  longs: OpenPosition[];
  shorts: OpenPosition[];
};

const formatNumberForInput = (value: number, decimals = 6) => {
  if (!Number.isFinite(value)) return "";
  const factor = 10 ** decimals;
  return (Math.round(value * factor) / factor).toString();
};

const parseNumberInput = (value: string) => {
  if (typeof value !== "string") return NaN;
  const normalized = value.replace(/,/g, ".");
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const isLikelyObjectId = (value: string) => /^[0-9a-fA-F]{24}$/.test(value);

const BINANCE_EXCHANGE_IDS = new Set([
  "68b36f95ea61fd89d70c8d98",
  "binance",
]);

const isBinanceExchangeValue = (value: unknown) => {
  if (!value) return false;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return BINANCE_EXCHANGE_IDS.has(lower);
  }
  if (typeof value === "object") {
    const maybeObj = value as { _id?: string; id?: string; name?: string };
    if (maybeObj.name && typeof maybeObj.name === "string") {
      if (maybeObj.name.toLowerCase().includes("binance")) return true;
    }
    const idVal = maybeObj._id ?? maybeObj.id;
    if (typeof idVal === "string" && BINANCE_EXCHANGE_IDS.has(idVal.toLowerCase())) {
      return true;
    }
  }
  return false;
};

const BASE_TOLERANCE = 1e-8;
const PROFIT_TOLERANCE = 1e-6;

const toNumber = (value: unknown, fallback = 0) => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseDate = (value?: string) => {
  if (!value) return Number.NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NaN;
};

const normalizeOpenPosition = (tx: TransactionDoc): OpenPosition | null => {
  const amount = toNumber(tx.amount);
  const openValueFiat = toNumber(tx.openValueFiat);
  const openPrice = toNumber(tx.openPrice);
  if (amount <= 0 || openValueFiat <= 0 || openPrice <= 0) return null;
  const openFee = Math.max(0, toNumber(tx.openFee));
  const openDate = parseDate(tx.openDate) ?? parseDate(tx.createdAt);
  return {
    id: tx._id,
    amount,
    openValueFiat,
    openPrice,
    openFee,
    openDate: Number.isFinite(openDate) ? openDate : Date.now(),
  };
};

const formatAssetAmount = (amount: number, asset: string) => {
  const upper = asset.toUpperCase();
  if (["USD", "PEN"].includes(upper)) {
    return amount.toFixed(3);
  }
  if (upper === "USDT") {
    return amount.toFixed(8);
  }
  if (["BTC"].includes(upper)) {
    return amount.toFixed(6);
  }
  return amount.toFixed(4);
};

const formatQuoteValue = (value: number, asset: string) => {
  const upper = asset?.toUpperCase?.() ?? "USD";
  if (upper === "USD") {
    return `$${value.toFixed(3)}`;
  }
  if (upper === "USDT") {
    return `${value.toFixed(8)} USDT`;
  }
  if (upper === "PEN") {
    return `${value.toFixed(3)} PEN`;
  }
  return `${value.toFixed(2)} ${upper}`;
};

const buildClosurePlan = (
  op: Operation,
  orders: OpenPosition[],
  action: "sell" | "buy"
):
  | {
      baseUsed: number;
      quoteUsed: number;
      entries: Array<{ id: string; amount: number; closeValueFiat: number; closePrice: number }>;
    }
  | null => {
  if (!orders.length) return null;
  const availableBase = op.suggestedBaseAmount;
  if (!(availableBase > BASE_TOLERANCE)) return null;

  let baseUsed = 0;
  let quoteUsed = 0;
    const entries: Array<{ id: string; amount: number; closeValueFiat: number; closePrice: number }> = [];
    const currentPrice = op.price;
    const quoteUpper = op.quoteAsset?.toUpperCase?.() ?? op.quoteAsset;
    const quoteDecimals = quoteUpper === "USDT" ? 8 : (quoteUpper === "USD" || quoteUpper === "PEN" ? 3 : 2);

  for (const order of orders) {
    if (order.amount <= 0) continue;
    const remaining = availableBase - baseUsed;
    if (remaining <= BASE_TOLERANCE) break;
    const take = Math.min(order.amount, remaining);
    if (take <= BASE_TOLERANCE) continue;

    const factor = take / order.amount;
    const currentQuote = take * currentPrice;
    const openGross = order.openValueFiat * factor;
    const openFeePart = order.openFee * factor;

    const profit =
      action === "sell"
        ? currentQuote - (openGross + openFeePart)
        : (openGross - openFeePart) - currentQuote;

    if (profit <= PROFIT_TOLERANCE) continue;

    baseUsed = Number((baseUsed + take).toFixed(8));
    quoteUsed = Number((quoteUsed + currentQuote).toFixed(quoteDecimals));
    entries.push({
      id: order.id,
      amount: Number(take.toFixed(8)),
      closeValueFiat: Number(currentQuote.toFixed(quoteDecimals)),
      closePrice: currentPrice,
    });
  }

  if (!entries.length) return null;

  return {
    baseUsed,
    quoteUsed,
    entries,
  };
};

const adjustOperationForClosings = (
  op: Operation,
  openPositions?: OpenPositionsByAsset
): Operation | null => {
  if (!openPositions) return op;

  const priceIsValid = Number.isFinite(op.price) && op.price > 0;
  const baseUpper = op.baseAsset?.toUpperCase?.() ?? op.baseAsset;
  const quoteUpperGlobal = op.quoteAsset?.toUpperCase?.() ?? op.quoteAsset;

  if (op.action === "sell") {
    if (!openPositions.longs.length) return op;
    const saleUsd = Math.max(0, -op.baseDiffUsd);
    const totalBaseNeeded =
      baseUpper === "USD" || !priceIsValid ? saleUsd : saleUsd / (op.price || 1);
    const totalBaseNeededRounded = Number(totalBaseNeeded.toFixed(8));

    const computeFiatValue = (baseAmount: number) => {
      if (!priceIsValid) return saleUsd;
      if (quoteUpperGlobal === "USD") {
        if (baseUpper === "USD") {
          return baseAmount;
        }
        return baseAmount * (op.price || 0);
      }
      if (quoteUpperGlobal === "USDT") {
        return baseAmount * (op.price || 0);
      }
      return baseAmount * (op.price || 0);
    };

    const plan = buildClosurePlan(op, openPositions.longs, "sell");
    // Si no hay cierres rentables y el slope es negativo, permitir abrir short igualmente
    if (!plan) {
      if ((op.slopeSign ?? 0) < 0) return op;
      return null;
    }

    const roundedBase = Number(plan.baseUsed.toFixed(8));
    const quoteUpper = quoteUpperGlobal;
    const quoteDec = quoteUpper === "USDT" ? 8 : (quoteUpper === "USD" || quoteUpper === "PEN" ? 3 : 2);
    const roundedQuote = Number(plan.quoteUsed.toFixed(quoteDec));
    const baseLabel = formatAssetAmount(roundedBase, op.baseAsset);
    const quoteAssetUpper = op.quoteAsset?.toUpperCase?.() ?? op.quoteAsset;
    const quoteLabel = formatQuoteValue(roundedQuote, quoteAssetUpper ?? "USD");
    const plural = plan.entries.length > 1 ? "s" : "";
    let message = `Cerrar ${plan.entries.length} long${plural} abiertas (${quoteLabel}) vendiendo ${baseLabel} ${op.baseAsset} por ${quoteAssetUpper}.`;

    const adjustedBaseDiff =
      op.baseAsset?.toUpperCase?.() === "USD"
        ? -roundedBase
        : -(roundedBase * op.price);

    const residualBase = Math.max(0, Number((totalBaseNeededRounded - roundedBase).toFixed(8)));
    const residualFiat = Number(residualBase > 0 ? computeFiatValue(residualBase).toFixed(quoteDec) : "0");
    if (residualBase > BASE_TOLERANCE) {
      const residualLabel = formatAssetAmount(residualBase, op.baseAsset);
      const residualFiatLabel = formatQuoteValue(residualFiat, quoteAssetUpper ?? "USD");
      message += ` Además, abrir short con ${residualLabel} ${op.baseAsset} (${residualFiatLabel}).`;
    }

    return {
      ...op,
      suggestedBaseAmount: Number((roundedBase + residualBase).toFixed(8)),
      suggestedFiatValue: Number((roundedQuote + residualFiat).toFixed(quoteDec)),
      baseDiffUsd: adjustedBaseDiff,
      closingPositions: plan.entries.map(entry => ({
        id: entry.id,
        amount: Number(entry.amount.toFixed(8)),
        closeValueFiat: Number(entry.closeValueFiat.toFixed(quoteDec)),
        closePrice: entry.closePrice,
      })),
      residualBaseAmount: residualBase,
      residualFiatValue: residualFiat,
      actionMessage: message,
    };
  }

  if (op.action === "buy") {
    if (!openPositions.shorts.length) return op;
    const buyUsd = Math.max(0, op.baseDiffUsd);
    const totalBaseNeeded =
      baseUpper === "USD" || !priceIsValid ? buyUsd : buyUsd / (op.price || 1);
    const totalBaseNeededRounded = Number(totalBaseNeeded.toFixed(8));

    const computeFiatValue = (baseAmount: number) => {
      if (!priceIsValid) return buyUsd;
      if (quoteUpperGlobal === "USD") {
        if (baseUpper === "USD") {
          return baseAmount;
        }
        return baseAmount * (op.price || 0);
      }
      if (quoteUpperGlobal === "USDT") {
        return baseAmount * (op.price || 0);
      }
      return baseAmount * (op.price || 0);
    };

    const plan = buildClosurePlan(op, openPositions.shorts, "buy");
    // Si no hay cierres rentables y el slope es positivo, permitir abrir long igualmente
    if (!plan) {
      if ((op.slopeSign ?? 0) > 0) return op;
      return null;
    }

    const roundedBase = Number(plan.baseUsed.toFixed(8));
    const quoteUpper2 = quoteUpperGlobal;
    const quoteDec = quoteUpper2 === "USDT" ? 8 : (quoteUpper2 === "USD" || quoteUpper2 === "PEN" ? 3 : 2);
    const roundedQuote = Number(plan.quoteUsed.toFixed(quoteDec));
    const baseLabel = formatAssetAmount(roundedBase, op.baseAsset);
    const quoteAssetUpper = op.quoteAsset?.toUpperCase?.() ?? op.quoteAsset;
    const quoteLabel = formatQuoteValue(roundedQuote, quoteAssetUpper ?? "USD");
    const plural = plan.entries.length > 1 ? "s" : "";
    let message = `Cerrar ${plan.entries.length} short${plural} abiertas (${quoteLabel}) comprando ${baseLabel} ${op.baseAsset} usando ${quoteAssetUpper}.`;

    const adjustedBaseDiff =
      op.baseAsset?.toUpperCase?.() === "USD"
        ? roundedBase
        : roundedBase * op.price;

    const residualBase = Math.max(0, Number((totalBaseNeededRounded - roundedBase).toFixed(8)));
    const residualFiat = Number(residualBase > 0 ? computeFiatValue(residualBase).toFixed(quoteDec) : "0");
    if (residualBase > BASE_TOLERANCE) {
      const residualLabel = formatAssetAmount(residualBase, op.baseAsset);
      const residualFiatLabel = formatQuoteValue(residualFiat, quoteAssetUpper ?? "USD");
      message += ` Además, abrir long con ${residualLabel} ${op.baseAsset} usando ${residualFiatLabel}.`;
    }

    return {
      ...op,
      suggestedBaseAmount: Number((roundedBase + residualBase).toFixed(8)),
      suggestedFiatValue: Number((roundedQuote + residualFiat).toFixed(quoteDec)),
      baseDiffUsd: adjustedBaseDiff,
      closingPositions: plan.entries.map(entry => ({
        id: entry.id,
        amount: Number(entry.amount.toFixed(8)),
        closeValueFiat: Number(entry.closeValueFiat.toFixed(quoteDec)),
        closePrice: entry.closePrice,
      })),
      residualBaseAmount: residualBase,
      residualFiatValue: residualFiat,
      actionMessage: message,
    };
  }

  return op;
};

export default function TransaccionesScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const hasFetchedOnFocus = useRef(false);
  const isFetchingRef = useRef(false);
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null);
  const [tradeFormVisible, setTradeFormVisible] = useState(false);
  const [tradeFormError, setTradeFormError] = useState<string | null>(null);
  const [tradeFormSuccess, setTradeFormSuccess] = useState<string | null>(null);
  const [savingTransaction, setSavingTransaction] = useState(false);

  const [tradeForm, setTradeForm] = useState<TradeFormState | null>(null);
  const openPositionsByAssetRef = useRef<Map<string, OpenPositionsByAsset>>(new Map());

  const loadData = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      try {
        if (!silent) {
          setLoading(true);
        }
        setError(null);

      const [assetsRes, balancesRes, configRes, penRes, transactionsRes] = await Promise.all([
        api.get<AssetDocument[]>("/assets"),
        api.get<{ balances: BalanceEntry[]; totals: { usd: number; pen: number } }>(
          "/binance/balances"
        ),
        api.get<ConfigInfo[]>("/config-info"),
        fetch("https://open.er-api.com/v6/latest/PEN").then(res => res.json()),
        api.get<TransactionDoc[]>("/transactions"),
      ]);

      const allAssets = assetsRes.data || [];
      const nonFiatAssets = allAssets.filter(asset => asset.type !== "fiat");
      const fiatPairs = allAssets.filter(asset => asset.symbol === "USDTUSD" || asset.symbol === "USDPEN");
      const assets = [...nonFiatAssets, ...fiatPairs];


      const balanceList = balancesRes.data?.balances ?? [];
      const totals = balancesRes.data?.totals ?? { usd: 0, pen: 0 };
      const balanceMap = new Map<string, BalanceEntry>();
      balanceList.forEach(entry => {
        balanceMap.set(entry.asset, entry);
      });

      const configMap = new Map<string, number>();
      (configRes.data ?? []).forEach(item => {
        configMap.set(item.name, item.total);
      });

      const getConfigNumber = (...names: string[]) => {
        for (const name of names) {
          const value = configMap.get(name);
          if (typeof value === "number" && !Number.isNaN(value)) {
            return value;
          }
        }
        return undefined;
      };

      const resolvedUsdtBuy = getConfigNumber("PrecioCompraUSDT", "lastPriceUsdtBuy");
      const resolvedUsdtSell = getConfigNumber("PrecioVentaUSDT", "lastPriceUsdtSell");
      const lastPriceUsdtBuy =
        typeof resolvedUsdtBuy === "number" && resolvedUsdtBuy > 0 ? resolvedUsdtBuy : 1;
      const lastPriceUsdtSell =
        typeof resolvedUsdtSell === "number" && resolvedUsdtSell > 0 ? resolvedUsdtSell : lastPriceUsdtBuy;
      const usdtUsdRate = Number.isFinite(lastPriceUsdtBuy + lastPriceUsdtSell)
        ? (lastPriceUsdtBuy + lastPriceUsdtSell) / 2
        : lastPriceUsdtSell || lastPriceUsdtBuy || 1;

      const penUsdRate = penRes?.result === "success" && penRes?.rates?.USD ? penRes.rates.USD : null;
      const penToUsd = penUsdRate ?? 0; // USD por PEN
      const usdToPen = penUsdRate ? 1 / penUsdRate : null; // PEN por USD

      const transactionsList = Array.isArray(transactionsRes.data) ? transactionsRes.data : [];

      const openTransactionsByAsset = new Map<string, OpenPositionsByAsset>();
      transactionsList.forEach(tx => {
        if (!tx || tx.status !== "open") return;
        const assetId =
          typeof tx.asset === "string"
            ? tx.asset
            : tx.asset && typeof tx.asset._id === "string"
            ? tx.asset._id
            : null;
        if (!assetId) return;
        const normalized = normalizeOpenPosition(tx);
        if (!normalized) return;
        const entry = openTransactionsByAsset.get(assetId) ?? { longs: [], shorts: [] };
        if (tx.type === "long") {
          entry.longs.push(normalized);
        } else if (tx.type === "short") {
          entry.shorts.push(normalized);
        }
        openTransactionsByAsset.set(assetId, entry);
      });

      openTransactionsByAsset.forEach(entry => {
        entry.longs.sort((a, b) => a.openDate - b.openDate);
        entry.shorts.sort((a, b) => a.openDate - b.openDate);
      });

      // guardar para uso al guardar (FIFO en cierre real)
      openPositionsByAssetRef.current = openTransactionsByAsset;

      const nonCryptoAssets = allAssets.filter(asset => asset.type !== "crypto");
      const otherAssetPricesEntries = await Promise.all(
        nonCryptoAssets.map(async asset => {
          const price = await fetchExternalAssetPrice(
            asset.symbol,
            asset.type,
            lastPriceUsdtSell,
            penToUsd
          );
          return [asset.symbol, price ?? null] as const;
        })
      );
      const externalPriceMap = new Map<string, number>();
      otherAssetPricesEntries.forEach(([symbol, price]) => {
        if (price != null && !Number.isNaN(price)) {
          externalPriceMap.set(symbol, price);
        }
      });

      const externalHoldingsInfo = nonCryptoAssets.map(asset => {
        const amount = getInitialInvestmentAmount(asset.initialInvestment);
        const price = externalPriceMap.get(asset.symbol) ?? null;
        const usdValue = amount != null && price != null ? amount * price : null;
        return { symbol: asset.symbol, amount, price, usdValue };
      });

      const externalValueMap = new Map<string, number>();
      externalHoldingsInfo.forEach(info => {
        if (info.usdValue != null) {
          externalValueMap.set(info.symbol, info.usdValue);
        }
      });

      const externalUsdValue = externalHoldingsInfo.reduce((acc, info) => {
        if (info.usdValue == null) return acc;
        return acc + info.usdValue;
      }, 0);

      const designatedTotal = nonFiatAssets.reduce(
        (acc, asset) => acc + (asset.totalCapitalWhenLastAdded ?? 0),
        0
      );

      const cryptoUsd = balanceList.reduce(
        (acc, entry) => acc + (entry.usdValue ?? 0),
        0
      );
      const configUsd = configMap.get("totalUSD") ?? 0;
      const penTotal = configMap.get("totalPen") ?? totals.pen ?? 0;
      const penUsdValue = penToUsd ? penTotal * penToUsd : 0;
      const totalUsdFromBalances = totals.usd ?? configUsd;
      const usdtBalanceEntry = balanceMap.get("USDT");
      const usdtUsdValue = usdtBalanceEntry?.usdValue ?? 0;

      const portfolioTotal =
        totalUsdFromBalances + cryptoUsd + penUsdValue + externalUsdValue;


      const difference = portfolioTotal - designatedTotal;
      const adjustableCount = nonFiatAssets.length || 1;
      let perAssetAdjustment = 0;
      if (difference < 0) {
        perAssetAdjustment = difference / adjustableCount;
      } else if (difference > 200) {
        perAssetAdjustment = (difference - 200) / adjustableCount;
      }


      const operationsResult: Operation[] = [];

      for (const asset of assets) {
        let allocation = Math.max((asset.totalCapitalWhenLastAdded ?? 0) + perAssetAdjustment, 0);

        if (asset.symbol === "USDTUSD") {
          allocation = Math.max(totalUsdFromBalances + usdtUsdValue, 0);
        } else if (asset.symbol === "USDPEN") {
          allocation = Math.max(totalUsdFromBalances + penUsdValue, 0);
        }
        if (allocation <= 0) continue;

        const { baseAsset, quoteAsset } = splitSymbol(asset.symbol);
        const isUsdtPair = asset.symbol === "USDTUSD";

        const rawExchange = asset.exchange ?? asset.exchangeName ?? null;
        const exchangeId =
          typeof rawExchange === "string" && isLikelyObjectId(rawExchange)
            ? rawExchange
            : typeof rawExchange === "object" && rawExchange
            ? ((rawExchange as { _id?: string; id?: string })._id ?? (rawExchange as { id?: string }).id ?? null)
            : null;
        const exchangeName =
          typeof asset.exchangeName === "string"
            ? asset.exchangeName
            : typeof rawExchange === "object" && rawExchange && typeof (rawExchange as { name?: string }).name === "string"
            ? (rawExchange as { name?: string }).name!
            : typeof rawExchange === "string" && !isLikelyObjectId(rawExchange)
            ? rawExchange
            : null;
        const isBinance = isBinanceExchangeValue(exchangeId) || isBinanceExchangeValue(exchangeName);

        let fetchedPrice: number | null;
        if (asset.type === "crypto") {
          fetchedPrice = await fetchAssetPrice(asset.symbol, lastPriceUsdtSell, usdToPen ?? 0);
        } else {
          fetchedPrice = externalPriceMap.get(asset.symbol) ?? null;
          if (!fetchedPrice) {
            fetchedPrice = await fetchExternalAssetPrice(
              asset.symbol,
              asset.type,
              lastPriceUsdtSell,
              penToUsd
            );
            if (fetchedPrice != null) {
              externalPriceMap.set(asset.symbol, fetchedPrice);
            }
          }
        }

        if (!fetchedPrice || fetchedPrice <= 0) {
          if (!isUsdtPair) {
            continue;
          }
        }

        const stockHoldingValue = externalValueMap.get(asset.symbol) ?? 0;
        const baseHolding = getHoldingData(
          baseAsset,
          balanceMap,
          totals,
          penToUsd,
          lastPriceUsdtSell,
          stockHoldingValue
        );
        const quoteHolding = getHoldingData(
          quoteAsset,
          balanceMap,
          totals,
          penToUsd,
          lastPriceUsdtSell
        );

        const slopeFraction = (asset.slope ?? 0) / 100;
        const baseHoldFraction = slopeFraction > 0 ? Math.min(slopeFraction, 1) : 0;
        const quoteHoldFraction = slopeFraction < 0 ? Math.min(Math.abs(slopeFraction), 1) : 0;

        const baseHoldUsd = allocation * baseHoldFraction;
        const quoteHoldUsd = allocation * quoteHoldFraction;
        const maxBaseAllowed = Math.max(allocation - quoteHoldUsd, 0);

        const evaluateScenario = async (
          mode: "buy" | "sell" | "neutral",
          scenarioPrice: number | null | undefined,
          {
            allowUpdates,
            priceLabel,
          }: {
            allowUpdates: boolean;
            priceLabel?: string;
          }
        ) => {
          let price = scenarioPrice ?? fetchedPrice ?? null;
          if (!price || price <= 0) return;

          let minPrice = asset.minPriceSevenYear;
          let maxPrice = asset.maxPriceSevenYear;

          if (allowUpdates) {
            const updates: Partial<AssetDocument> = {};
            if (price < minPrice) {
              minPrice = price;
              updates.minPriceSevenYear = price;
            }
            if (price > maxPrice) {
              maxPrice = price;
              updates.maxPriceSevenYear = price;
            }

            if (Object.keys(updates).length > 0) {
              try {
                await api.put(`/assets/${asset._id}`, updates);
              } catch (updateErr) {
                console.warn("No se pudo actualizar límites para", asset.symbol, updateErr);
              }
            }
          }

          const actualBaseUsd = isUsdtPair ? baseHolding.amount * price : baseHolding.usdValue;
          const actualQuoteUsd = quoteHolding.usdValue;

          const priceRange = maxPrice - minPrice;
          const normalized = priceRange === 0 ? 0.5 : clamp((price - minPrice) / priceRange, 0, 1);
          let baseShare = 1 - normalized;
          baseShare = clamp(baseShare, 0, 1);
          const desiredBaseUsd = allocation * baseShare;

          let targetBaseCandidate = desiredBaseUsd;
          const rawBaseDiff = desiredBaseUsd - actualBaseUsd;
          const rawSellUsd = rawBaseDiff < 0 ? -rawBaseDiff : 0;

          if (baseHoldUsd > 0) {
            const availableExcess = Math.max(0, actualBaseUsd - baseHoldUsd);
            if (rawSellUsd > 0) {
              if (rawSellUsd < baseHoldUsd || availableExcess <= BASE_TOLERANCE) {
                targetBaseCandidate = actualBaseUsd; // no venta, proteger reserva
              } else {
                const sellFinal = Math.min(rawSellUsd - baseHoldUsd, availableExcess);
                targetBaseCandidate = actualBaseUsd - sellFinal;
              }
            }
          }


          const adjustedDesiredBaseUsd = clamp(targetBaseCandidate, 0, maxBaseAllowed);

          let targetBaseUsd: number;
          if (actualBaseUsd < adjustedDesiredBaseUsd) {
            targetBaseUsd = Math.min(adjustedDesiredBaseUsd, maxBaseAllowed);
          } else {
            const minimumAfterSell = Math.max(adjustedDesiredBaseUsd, baseHoldUsd);
            const cappedMinimum = clamp(minimumAfterSell, 0, maxBaseAllowed);
            targetBaseUsd = actualBaseUsd > cappedMinimum ? cappedMinimum : actualBaseUsd;
          }

          targetBaseUsd = clamp(targetBaseUsd, 0, maxBaseAllowed);

          let targetQuoteUsd = allocation - targetBaseUsd;
          if (targetQuoteUsd < quoteHoldUsd) {
            targetQuoteUsd = quoteHoldUsd;
            targetBaseUsd = clamp(allocation - targetQuoteUsd, 0, maxBaseAllowed);
          }

          const baseDiffUsd = targetBaseUsd - actualBaseUsd;
          const tolerance = Math.max(allocation * 0.01, 10);

          const action: "buy" | "sell" = baseDiffUsd > 0 ? "buy" : "sell";

          //

          if (mode === "buy") {
            if (baseDiffUsd <= tolerance) {
              return;
            }
          } else if (mode === "sell") {
            if (baseDiffUsd >= -tolerance) {
              return;
            }
          } else if (Math.abs(baseDiffUsd) <= tolerance) {
            return;
          }

          const priceIsValid = Number.isFinite(price) && price > 0;
          const quoteUpper = quoteAsset?.toUpperCase?.() ?? quoteAsset;
          const baseAmountUnits =
            baseAsset === "USD" || !priceIsValid ? baseDiffUsd : baseDiffUsd / (price as number);
          const absBaseAmount = Math.abs(baseAmountUnits);
          const absDiffUsd = Math.abs(baseDiffUsd);
          const quoteValue = (() => {
            if (!priceIsValid) return absDiffUsd;
            if (quoteUpper === "USD" || quoteUpper === "USDT" || quoteUpper === "USDC") {
              return absDiffUsd;
            }
            return absBaseAmount * (price as number);
          })();

          const approxLabel =
            quoteUpper === "USD" || quoteUpper === "USDT" || quoteUpper === "USDC"
              ? `$${absDiffUsd.toFixed(2)}`
              : `${quoteValue.toFixed(2)} ${quoteUpper}`;

          let actionMessage: string;

          if (baseDiffUsd > 0) {
            actionMessage = isUsdtPair
              ? `Comprar ${absBaseAmount.toFixed(6)} ${baseAsset} (~${approxLabel}) usando ${quoteAsset} a $${price.toFixed(4)} (PrecioCompraUSDT).`
              : `Comprar ${absBaseAmount.toFixed(6)} ${baseAsset} (~${approxLabel}) usando ${quoteAsset}.`;
          } else {
            actionMessage = isUsdtPair
              ? `Vender ${absBaseAmount.toFixed(6)} ${baseAsset} (~${approxLabel}) por ${quoteAsset} a $${price.toFixed(4)} (PrecioVentaUSDT).`
              : `Vender ${absBaseAmount.toFixed(6)} ${baseAsset} (~${approxLabel}) por ${quoteAsset}.`;
          }

          const suggestedBaseAmount = absBaseAmount;

          //

          const slopeSign: 1 | 0 | -1 = slopeFraction > 0 ? 1 : slopeFraction < 0 ? -1 : 0;

          const operation: Operation = {
            id: `${asset._id}-${mode}-${action}`,
            assetId: asset._id,
            symbol: asset.symbol,
            mode,
            action,
            baseAsset,
            quoteAsset,
            fiatCurrency: quoteAsset,
            exchangeId: exchangeId,
            exchangeName,
            isBinance,
            usdtUsdRate,
            allocation,
            price,
            priceLabel,
            slopeSign,
            buyPrice: isUsdtPair ? lastPriceUsdtBuy : undefined,
            sellPrice: isUsdtPair ? lastPriceUsdtSell : undefined,
            suggestedBaseAmount,
            suggestedFiatValue: quoteValue,
            targetBaseUsd,
            targetQuoteUsd,
            targetBasePercent: allocation > 0 ? targetBaseUsd / allocation : 0,
            actualBaseUsd,
            actualQuoteUsd,
            baseDiffUsd,
            actionMessage,
          };

          operationsResult.push(operation);
        };

        if (isUsdtPair) {
          await evaluateScenario("buy", lastPriceUsdtBuy ?? fetchedPrice ?? 1, {
            allowUpdates: true,
            priceLabel: "PrecioCompraUSDT",
          });
          await evaluateScenario("sell", lastPriceUsdtSell ?? fetchedPrice ?? lastPriceUsdtBuy ?? 1, {
            allowUpdates: false,
            priceLabel: "PrecioVentaUSDT",
          });
        } else {
          await evaluateScenario("neutral", fetchedPrice, {
            allowUpdates: true,
          });
        }
      }

      const adjustedOperations = operationsResult
        .map(op => adjustOperationForClosings(op, openTransactionsByAsset.get(op.assetId)))
        .filter((op): op is Operation => Boolean(op));

      setOperations(adjustedOperations);
      } catch (err: any) {
        console.error("❌ Error cargando transacciones:", err);
        setError("No se pudieron cargar las transacciones sugeridas.");
      } finally {
        isFetchingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      hasFetchedOnFocus.current = true;
      loadData();
    }, [loadData])
  );

  useEffect(() => {
    if (!hasFetchedOnFocus.current) {
      loadData();
    }
  }, [loadData]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadData({ silent: true });
    }, 15_000);

    return () => clearInterval(interval);
  }, [loadData]);

  const refreshHandler = useCallback(() => {
    setRefreshing(true);
    loadData({ silent: true });
  }, [loadData]);

  const handleOperationPress = useCallback(
    (operation: Operation) => {
      if (operation.action !== "sell" && operation.action !== "buy") return;
      const nowIso = new Date().toISOString();
      const defaultFeeCurrency = "USDT";
      const defaultFeeValue = operation.suggestedFiatValue * 0.001; // 0.1%
      const defaultCloseFee = 0;
      setSelectedOperation(operation);
      setTradeForm({
        openPrice: formatNumberForInput(operation.price, 6),
        amount: formatNumberForInput(operation.suggestedBaseAmount, 6),
        openValueFiat: formatNumberForInput(
          operation.suggestedFiatValue,
          ((): number => {
            const q = (operation.fiatCurrency?.toUpperCase?.() ?? operation.fiatCurrency) as string;
            if (q === "USDT") return 8;
            if (q === "USD" || q === "PEN") return 3;
            return 2;
          })()
        ),
        openFee: formatNumberForInput(defaultFeeValue, 4),
        feeCurrency: defaultFeeCurrency,
        openDate: nowIso,
        closeFee: formatNumberForInput(defaultCloseFee, 4),
      });
      setTradeFormError(null);
      setTradeFormSuccess(null);
      setTradeFormVisible(true);
    },
    []
  );

  const handleTradeFormChange = useCallback(
    (field: keyof TradeFormState, value: string) => {
      setTradeForm(prev => {
        if (!prev) return prev;
        const updated: TradeFormState = { ...prev, [field]: value };
        if (field === "feeCurrency") {
          updated.feeCurrency = value.toUpperCase();
        }
        if (field === "closeFee") {
          updated.closeFee = value;
        }
        if (field === "amount" || field === "openPrice") {
          const amount = parseNumberInput(field === "amount" ? value : updated.amount);
          const price = parseNumberInput(field === "openPrice" ? value : updated.openPrice);
          if (Number.isFinite(amount) && Number.isFinite(price)) {
            const newFiatValue = amount * price;
            const prevFiatValue = parseNumberInput(prev.openValueFiat);
            const previousAutoFee = Number.isFinite(prevFiatValue)
              ? formatNumberForInput(prevFiatValue * 0.001, 4)
              : prev.openFee;
            updated.openValueFiat = formatNumberForInput(newFiatValue, 2);
            if (prev.openFee === previousAutoFee) {
              updated.openFee = formatNumberForInput(newFiatValue * 0.001, 4);
            }
          }
        }
        return updated;
      });
    },
    []
  );

  const closeTradeForm = useCallback(() => {
    setTradeFormVisible(false);
    setSelectedOperation(null);
    setTradeForm(null);
    setTradeFormError(null);
    setTradeFormSuccess(null);
  }, []);

  const handleSaveTransaction = useCallback(async () => {
    if (!selectedOperation || !tradeForm) return;

    const openPrice = parseNumberInput(tradeForm.openPrice);
    const amount = parseNumberInput(tradeForm.amount);
    const openValueFiatInput = parseNumberInput(tradeForm.openValueFiat);
    const feeAmount = parseNumberInput(tradeForm.openFee || "0");
    const closeFeeAmount = parseNumberInput(tradeForm.closeFee || "0");

    if (!Number.isFinite(openPrice) || openPrice <= 0) {
      setTradeFormError("Ingresa un precio de apertura válido.");
      setTradeFormSuccess(null);
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setTradeFormError("Ingresa una cantidad válida.");
      setTradeFormSuccess(null);
      return;
    }

    const computedValue = amount * openPrice;
    const openValueFiat = Number.isFinite(openValueFiatInput) && openValueFiatInput > 0
      ? openValueFiatInput
      : computedValue;

    const dateValue = tradeForm.openDate ? new Date(tradeForm.openDate) : new Date();
    if (Number.isNaN(dateValue.getTime())) {
      setTradeFormError("Ingresa una fecha válida en formato ISO.");
      setTradeFormSuccess(null);
      return;
    }

    const fiatCurrency = (selectedOperation.fiatCurrency || "USD").toUpperCase();
    const feeCurrency = (tradeForm.feeCurrency || fiatCurrency).toUpperCase();
    if (!Number.isFinite(closeFeeAmount) || closeFeeAmount < 0) {
      setTradeFormError("Ingresa un fee de cierre válido.");
      setTradeFormSuccess(null);
      return;
    }
    let openFeeUsd = 0;

    if (Number.isFinite(feeAmount) && feeAmount > 0) {
      if (feeCurrency === "BNB") {
        try {
          const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT");
          if (res.ok) {
            const data = await res.json();
            const bnbUsdt = parseFloat(data?.price);
            if (Number.isFinite(bnbUsdt) && bnbUsdt > 0) {
              openFeeUsd = feeAmount * bnbUsdt * (selectedOperation.usdtUsdRate ?? 1);
            } else {
              openFeeUsd = feeAmount * (selectedOperation.usdtUsdRate ?? 1);
            }
          } else {
            openFeeUsd = feeAmount * (selectedOperation.usdtUsdRate ?? 1);
          }
        } catch (conversionErr) {
          console.warn("No se pudo convertir fee BNB a USD", conversionErr);
          openFeeUsd = feeAmount * (selectedOperation.usdtUsdRate ?? 1);
        }
      } else if (feeCurrency === "USDT") {
        openFeeUsd = feeAmount * (selectedOperation.usdtUsdRate ?? 1);
      } else {
        openFeeUsd = feeAmount;
      }
    }
    if (openFeeUsd > 0) {
      openFeeUsd = Number(openFeeUsd.toFixed(8));
    }

    const txType = selectedOperation.action === "buy" ? "long" : "short";

    // Construir plan de cierre FIFO con la cantidad realmente ejecutada
    const positions = openPositionsByAssetRef.current.get(selectedOperation.assetId);
    const entriesSource =
      selectedOperation.action === "sell" ? positions?.longs ?? [] : positions?.shorts ?? [];
    // cantidad ejecutada en unidades de base
    const executedBaseUnits = amount;
    let remainingBase = executedBaseUnits;
    const closeValueDecimals = (() => {
      const q = selectedOperation.quoteAsset?.toUpperCase?.() ?? selectedOperation.quoteAsset;
      if (q === "USDT") return 8;
      if (q === "USD" || q === "PEN") return 3;
      return 2;
    })();

    // Cerrar sólo si es rentable según la lógica de plan (profit > 0)
    let closeEntries: Array<{ id: string; amount: number; closeValueFiat: number; closePrice: number }> = [];
    if (entriesSource.length > 0 && executedBaseUnits > BASE_TOLERANCE) {
      const tempOp: Operation = {
        ...selectedOperation,
        // usar el precio de apertura ingresado por el usuario
        price: openPrice,
        suggestedBaseAmount: executedBaseUnits,
      };
      const plan = buildClosurePlan(
        tempOp,
        entriesSource,
        selectedOperation.action === "sell" ? "sell" : "buy"
      );
      if (plan) {
        closeEntries = plan.entries.map(e => ({
          id: e.id,
          amount: Number(e.amount.toFixed(8)),
          closeValueFiat: Number(e.closeValueFiat.toFixed(closeValueDecimals)),
          closePrice: openPrice,
        }));
        remainingBase = Number(Math.max(0, executedBaseUnits - plan.baseUsed).toFixed(8));
      } else {
        // no hay cierres rentables -> mantener posiciones abiertas y abrir nueva si corresponde
        remainingBase = executedBaseUnits;
      }
    }

    // Prorrateo de fee de cierre total ingresado
    const closings = closeEntries;
    const totalCloseFee = Math.max(0, closeFeeAmount);
    let remainingFee = totalCloseFee;
    const totalCloseValue = closings.reduce((sum, c) => sum + (c.closeValueFiat || 0), 0);
    const feeShares = closings.map((c, idx) => {
      if (totalCloseFee === 0) return 0;
      let share = 0;
      if (totalCloseValue > 0) {
        share = (c.closeValueFiat / totalCloseValue) * totalCloseFee;
      } else {
        share = totalCloseFee / (closings.length || 1);
      }
      if (idx === closings.length - 1) {
        share = remainingFee;
      }
      const rounded = Number(share.toFixed(8));
      remainingFee = Number((remainingFee - rounded).toFixed(8));
      return rounded;
    });

    try {
      setSavingTransaction(true);
      setTradeFormError(null);
      // 1) Cerrar posiciones (si corresponde)
      if (closings.length) {
        const closeDateIso = new Date().toISOString();
        await Promise.all(
          closings.map((close, index) =>
            api.put(`/transactions/${close.id}/close`, {
              closeDate: closeDateIso,
              closePrice: close.closePrice,
              closeValueFiat: close.closeValueFiat,
              closeFee: feeShares[index],
            })
          )
        );
      }

      // 2) Abrir nueva posición sólo si sobra base (ejecutaste más que el total cerrado)
      const residualBase = Number(Math.max(0, remainingBase).toFixed(8));
      if (residualBase > BASE_TOLERANCE) {
        const residualFiatDecimals = (() => {
          const q = selectedOperation.fiatCurrency?.toUpperCase?.() ?? selectedOperation.fiatCurrency;
          if (q === "USDT") return 8;
          if (q === "USD" || q === "PEN") return 3;
          return 2;
        })();
        const payload = {
          asset: selectedOperation.assetId,
          type: txType,
          fiatCurrency,
          openDate: dateValue.toISOString(),
          openPrice,
          amount: residualBase,
          openValueFiat: Number((residualBase * openPrice).toFixed(residualFiatDecimals)),
          openFee: openFeeUsd,
        };
        await api.post("/transactions", payload);
      }

      const successLabel = txType === "long" ? "long" : "short";
      await loadData();
      setTradeFormSuccess(`Transacción ${successLabel} guardada correctamente.`);
      setTimeout(() => {
        closeTradeForm();
      }, 800);
    } catch (err) {
      console.error("❌ Error guardando transacción:", err);
      setTradeFormError("No se pudo guardar la transacción. Intenta nuevamente.");
      setTradeFormSuccess(null);
    } finally {
      setSavingTransaction(false);
    }
  }, [closeTradeForm, loadData, selectedOperation, tradeForm]);

  const content = useMemo(() => {
    if (loading && !refreshing) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
        </View>
      );
    }

    if (operations.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={styles.empty}>No hay operaciones sugeridas en este momento.</Text>
        </View>
      );
    }

    return (
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshHandler} />}
      >
        {operations.map(op => {
          const isActionSupported = op.action === "sell" || op.action === "buy";
          const tradeHint = op.action === "sell" ? "Pulsa para registrar un short sugerido." : "Pulsa para registrar un long sugerido.";
          return (
            <TouchableOpacity
              key={op.id}
              style={[styles.card, !isActionSupported && styles.cardDisabled]}
              onPress={() => handleOperationPress(op)}
              activeOpacity={isActionSupported ? 0.8 : 1}
              disabled={!isActionSupported}
            >
              <Text style={styles.cardTitle}>{op.symbol}</Text>
              <Text style={styles.detail}>
                {op.priceLabel ?? "Precio actual"}: ${op.price.toFixed(4)}
              </Text>
              {op.symbol === "USDTUSD" && (
                <Text style={styles.detail}>
                  Precio compra USDT: ${op.buyPrice?.toFixed(4) ?? "N/D"} | Precio venta USDT: $
                  {op.sellPrice?.toFixed(4) ?? "N/D"}
                </Text>
              )}
              <Text style={styles.detail}>Capital asignado: ${op.allocation.toFixed(2)}</Text>
              <Text style={styles.detail}>
                Objetivo base ({op.baseAsset}): ${op.targetBaseUsd.toFixed(2)} | Actual: $
                {op.actualBaseUsd.toFixed(2)}
              </Text>
              <Text style={styles.detail}>
                Objetivo quote ({op.quoteAsset}): ${op.targetQuoteUsd.toFixed(2)} | Actual: $
                {op.actualQuoteUsd.toFixed(2)}
              </Text>
              {Number.isFinite(op.targetBasePercent) && op.allocation > 0 && (
                <Text style={styles.detail}>
                  Proporción base objetivo: {(op.targetBasePercent * 100).toFixed(2)}%
                </Text>
              )}
              <Text style={styles.action}>{op.actionMessage}</Text>
              {isActionSupported && <Text style={styles.hint}>{tradeHint}</Text>}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  }, [error, handleOperationPress, loading, operations, refreshHandler, refreshing]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📊 Transacciones sugeridas</Text>
      {content}

      <Modal
        visible={tradeFormVisible}
        transparent
        animationType="slide"
        onRequestClose={closeTradeForm}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {selectedOperation?.action === "buy" ? "Abrir long" : "Abrir short"}{" "}
              {selectedOperation?.symbol ? `(${selectedOperation.symbol})` : ""}
            </Text>
            {tradeForm ? (
              <>
                <Text style={styles.modalLabel}>
                  Quote (fiat): {selectedOperation?.fiatCurrency ?? "USD"}
                </Text>

                <Text style={styles.modalLabel}>Fecha de apertura (ISO)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={tradeForm.openDate}
                  onChangeText={text => handleTradeFormChange("openDate", text)}
                  placeholder="2024-01-01T12:00:00.000Z"
                />

                <Text style={styles.modalLabel}>Precio de apertura</Text>
                <TextInput
                  style={styles.modalInput}
                  value={tradeForm.openPrice}
                  onChangeText={text => handleTradeFormChange("openPrice", text)}
                  keyboardType="numeric"
                />

                <Text style={styles.modalLabel}>Cantidad (asset)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={tradeForm.amount}
                  onChangeText={text => handleTradeFormChange("amount", text)}
                  keyboardType="numeric"
                />

                <Text style={styles.modalLabel}>Valor total en fiat</Text>
                <TextInput
                  style={styles.modalInput}
                  value={tradeForm.openValueFiat}
                  onChangeText={text => handleTradeFormChange("openValueFiat", text)}
                  keyboardType="numeric"
                />

                <Text style={styles.modalLabel}>Fee de apertura (opcional)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={tradeForm.openFee}
                  onChangeText={text => handleTradeFormChange("openFee", text)}
                  keyboardType="numeric"
                />

                {selectedOperation?.closingPositions?.length ? (
                  <>
                    <Text style={styles.modalLabel}>
                      Fee de cierre total (se prorrateará entre {selectedOperation.closingPositions.length}{" "}
                      operación{selectedOperation.closingPositions.length > 1 ? "es" : ""})
                    </Text>
                    <TextInput
                      style={styles.modalInput}
                      value={tradeForm.closeFee}
                      onChangeText={text => handleTradeFormChange("closeFee", text)}
                      keyboardType="numeric"
                      placeholder="0"
                    />
                  </>
                ) : null}

                {selectedOperation?.isBinance ? (
                  <>
                    <Text style={styles.modalLabel}>Moneda del fee</Text>
                    <View style={styles.chipRow}>
                      {["USDT", "BNB"].map(currency => {
                        const active = tradeForm.feeCurrency === currency;
                        return (
                          <TouchableOpacity
                            key={currency}
                            style={[styles.chip, active && styles.chipActive]}
                            onPress={() => handleTradeFormChange("feeCurrency", currency)}
                          >
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>
                              {currency}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text style={styles.modalHint}>
                      El fee se convertirá automáticamente a USD al guardar.
                    </Text>
                  </>
                ) : (
                  <Text style={styles.modalHint}>
                    El fee se convertirá automáticamente a USD al guardar.
                  </Text>
                )}

                {tradeFormError && <Text style={styles.error}>{tradeFormError}</Text>}
                {tradeFormSuccess && <Text style={styles.success}>{tradeFormSuccess}</Text>}

                <View style={styles.modalButtonRow}>
                  <View style={styles.modalButton}>
                    <Button
                      title={
                        savingTransaction
                          ? "Guardando..."
                          : selectedOperation?.action === "buy"
                          ? "Guardar long"
                          : "Guardar short"
                      }
                      onPress={handleSaveTransaction}
                      disabled={savingTransaction}
                    />
                  </View>
                  <View style={styles.modalButton}>
                    <Button title="Cerrar" color="#757575" onPress={closeTradeForm} />
                  </View>
                </View>
              </>
            ) : (
              <ActivityIndicator size="large" />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function splitSymbol(symbol: string): { baseAsset: string; quoteAsset: string } {
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

async function fetchAssetPrice(
  symbol: string,
  lastPriceUsdtSell: number,
  usdToPen: number
): Promise<number | null> {
  if (symbol === "USDTUSD") {
    return lastPriceUsdtSell || 1;
  }

  if (symbol === "USDPEN") {
    return usdToPen ? 1 / usdToPen : null;
  }

  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    const price = parseFloat(data?.price);
    return Number.isFinite(price) ? price : null;
  } catch (err) {
    console.warn("No se pudo obtener precio para", symbol, err);
    return null;
  }
}

async function fetchExternalAssetPrice(
  symbol: string,
  type: string,
  lastPriceUsdtSell: number,
  penToUsd: number
): Promise<number | null> {
  if (type === "stock") {
    return fetchStockRegularPrice(symbol);
  }

  if (type === "commodity") {
    return fetchCommodityPrice(symbol);
  }

  if (type === "fiat" && (symbol === "USDTUSD" || symbol === "USDPEN")) {
    if (symbol === "USDTUSD") {
      return lastPriceUsdtSell;
    }
    try {
      if (penToUsd) {
        return penToUsd ? 1 / penToUsd : null;
      }
      const res = await fetch("https://open.er-api.com/v6/latest/USD");
      const data = await res.json();
      const penRate = data?.rates?.PEN;
      return typeof penRate === "number" ? penRate : null;
    } catch (err) {
      console.warn("No se pudo obtener precio para USDPEN", err);
      return null;
    }
  }

  return null;
}

async function fetchStockRegularPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" ? price : null;
  } catch (err) {
    console.warn("No se pudo obtener precio de acción para", symbol, err);
    return null;
  }
}

async function fetchCommodityPrice(symbol: string): Promise<number | null> {
  try {
    // Intenta Yahoo Finance primero
    const yahooSymbol = symbol.includes("=") ? symbol : `${symbol}=X`;
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1mo`
    );
    if (res.ok) {
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof price === "number") return price;
    }
  } catch (err) {
    console.warn("No se pudo obtener precio de commodity en Yahoo para", symbol, err);
  }

  // Fallback a precios SPOT de Binance
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    const price = parseFloat(data?.price);
    return Number.isFinite(price) ? price : null;
  } catch (err) {
    console.warn("No se pudo obtener precio de commodity en Binance para", symbol, err);
    return null;
  }
}

function getInitialInvestmentAmount(initialInvestment?: number | Record<string, number>): number | null {
  if (typeof initialInvestment === "number") return initialInvestment;
  if (!initialInvestment) return null;

  if (typeof initialInvestment["USD"] === "number") {
    return initialInvestment["USD"];
  }

  if (typeof (initialInvestment as any).amount === "number") {
    return (initialInvestment as any).amount;
  }

  return null;
}

function getHoldingData(
  asset: string,
  balanceMap: Map<string, BalanceEntry>,
  totals: { usd: number; pen: number },
  penToUsd: number,
  lastPriceUsdtSell: number,
  fallbackUsdValue = 0
): { amount: number; usdValue: number } {
  if (asset === "USD") {
    return { amount: totals.usd ?? 0, usdValue: totals.usd ?? 0 };
  }

  if (asset === "PEN") {
    const penAmount = totals.pen ?? 0;
    return { amount: penAmount, usdValue: penAmount * (penToUsd || 0) };
  }

  if (asset === "USDT") {
    const balance = balanceMap.get("USDT");
    if (balance) return { amount: balance.total, usdValue: balance.usdValue };
    const amount = totals.usd ? totals.usd / (lastPriceUsdtSell || 1) : 0;
    return { amount, usdValue: amount * (lastPriceUsdtSell || 1) };
  }

  const balance = balanceMap.get(asset);
  if (balance) {
    return { amount: balance.total, usdValue: balance.usdValue };
  }

  if (fallbackUsdValue) {
    return { amount: 0, usdValue: fallbackUsdValue };
  }

  return { amount: 0, usdValue: 0 };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 12,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    color: "#c62828",
    fontSize: 16,
  },
  empty: {
    color: "#555",
    fontSize: 16,
  },
  scrollContent: {
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    padding: 16,
    backgroundColor: "#fafafa",
  },
  cardDisabled: {
    opacity: 0.6,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
  },
  detail: {
    fontSize: 15,
    marginBottom: 4,
  },
  action: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: "600",
    color: "#1b5e20",
  },
  hint: {
    marginTop: 8,
    fontSize: 13,
    color: "#0d47a1",
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#90a4ae",
    backgroundColor: "#fff",
  },
  chipActive: {
    backgroundColor: "#1b5e20",
    borderColor: "#1b5e20",
  },
  chipText: {
    fontSize: 14,
    color: "#37474f",
  },
  chipTextActive: {
    color: "#fff",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalContent: {
    width: "100%",
    borderRadius: 12,
    padding: 20,
    backgroundColor: "#fff",
    gap: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 4,
  },
  modalLabel: {
    fontSize: 14,
    color: "#424242",
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  modalButtonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  modalButton: {
    flex: 1,
  },
  success: {
    color: "#1b5e20",
    fontSize: 15,
  },
  modalHint: {
    fontSize: 13,
    color: "#455a64",
  },
});

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
  Alert,
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
  actualBaseAmountUnits?: number;
  minPrice?: number;
  maxPrice?: number;
  baseHoldUsd?: number;
  quoteHoldUsd?: number;
  maxBaseAllowed?: number;
  baseHoldingUsd?: number;
  quoteHoldingUsd?: number;
  slopeFraction?: number;
};

type SimulationResult = {
  status: "action" | "none" | "invalid";
  message: string;
  suggestedBaseAmount?: number;
  suggestedFiatValue?: number;
  action?: "buy" | "sell";
  operation?: Operation;
};

type PriceOverrideState = {
  input: string;
  result: SimulationResult | null;
  visible: boolean;
};

type RegisterFormState = {
  type: "long" | "short";
  openPrice: string;
  amount: string;
  openValueFiat: string;
  fiatCurrency: string;
  openFee: string;
  openFeeCurrency: string;
  openDate: string;
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
  const [suggestionModalVisible, setSuggestionModalVisible] = useState(false);
  const openPositionsByAssetRef = useRef<Map<string, OpenPositionsByAsset>>(new Map());
  const [priceOverrides, setPriceOverrides] = useState<Record<string, PriceOverrideState>>({});
  const [registerModalVisible, setRegisterModalVisible] = useState(false);
  const [registerTarget, setRegisterTarget] = useState<Operation | null>(null);
  const [registerForm, setRegisterForm] = useState<RegisterFormState>(() => createEmptyRegisterForm());
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);

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

      const usdtBuyPrice =
        typeof resolvedUsdtBuy === "number" && resolvedUsdtBuy > 0 ? resolvedUsdtBuy : null;
      const usdtSellPrice =
        typeof resolvedUsdtSell === "number" && resolvedUsdtSell > 0 ? resolvedUsdtSell : null;

      const lastPriceUsdtBuy = usdtBuyPrice ?? usdtSellPrice ?? 1;
      const lastPriceUsdtSell = usdtSellPrice ?? usdtBuyPrice ?? 1;

      const usdtUsdRate = (() => {
        if (usdtSellPrice) return usdtSellPrice;
        if (usdtBuyPrice) return usdtBuyPrice;
        return 1;
      })();

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
          fetchedPrice = await fetchAssetPrice(
            asset.symbol,
            lastPriceUsdtSell,
            usdToPen ?? 0
          );
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
                const isBadRequest =
                  updateErr &&
                  typeof updateErr === "object" &&
                  "response" in updateErr &&
                  (updateErr as any).response?.status === 400;
                if (!isBadRequest) {
                  console.warn("No se pudo actualizar límites para", asset.symbol, updateErr);
                }
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
          const action: "buy" | "sell" = baseDiffUsd > 0 ? "buy" : "sell";

          if (mode === "buy" && action !== "buy") {
            return;
          }

          if (mode === "sell" && action !== "sell") {
            return;
          }

          if (Math.abs(baseDiffUsd) <= BASE_TOLERANCE) {
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

          // Skip if below $10 threshold
          if (quoteValue < 10) {
            return;
          }

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
            buyPrice: isUsdtPair ? usdtBuyPrice ?? undefined : undefined,
            sellPrice: isUsdtPair ? usdtSellPrice ?? undefined : undefined,
            suggestedBaseAmount,
            suggestedFiatValue: quoteValue,
            targetBaseUsd,
            targetQuoteUsd,
            targetBasePercent: allocation > 0 ? targetBaseUsd / allocation : 0,
            actualBaseUsd,
            actualQuoteUsd,
            baseDiffUsd,
            actionMessage,
            actualBaseAmountUnits: baseHolding.amount,
            minPrice,
            maxPrice,
            baseHoldUsd,
            quoteHoldUsd,
            maxBaseAllowed,
            baseHoldingUsd: baseHolding.usdValue,
            quoteHoldingUsd: quoteHolding.usdValue,
            slopeFraction,
          };

          operationsResult.push(operation);
        };

        if (isUsdtPair) {
          if (usdtBuyPrice != null) {
            await evaluateScenario("buy", usdtBuyPrice, {
              allowUpdates: true,
              priceLabel: "PrecioCompraUSDT",
            });
          }
          if (usdtSellPrice != null) {
            await evaluateScenario("sell", usdtSellPrice, {
              allowUpdates: false,
              priceLabel: "PrecioVentaUSDT",
            });
          }
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

  const simulateOperation = useCallback(
    (op: Operation, overridePrice: number): SimulationResult => {
      if (!Number.isFinite(overridePrice) || overridePrice <= 0) {
        return {
          status: "invalid",
          message: "Ingresa un precio válido mayor a 0.",
        };
      }

      const price = Number(overridePrice);
      const baseUpper = op.baseAsset?.toUpperCase?.() ?? op.baseAsset;
      const quoteUpper = op.quoteAsset?.toUpperCase?.() ?? op.quoteAsset;
      const isUsdtPair = op.symbol === "USDTUSD";

      let min = Number.isFinite(op.minPrice) ? (op.minPrice as number) : price;
      let max = Number.isFinite(op.maxPrice) ? (op.maxPrice as number) : price;
      if (min > max) {
        const temp = min;
        min = max;
        max = temp;
      }

      const allocation = op.allocation;
      const baseHoldingAmount = op.actualBaseAmountUnits ?? 0;
      const baseHoldingUsd = op.baseHoldingUsd ?? op.actualBaseUsd;
      const quoteHoldingUsd = op.quoteHoldingUsd ?? op.actualQuoteUsd;
      const baseHoldUsd = op.baseHoldUsd ?? 0;
      const quoteHoldUsd = op.quoteHoldUsd ?? 0;
      const maxBaseAllowed = op.maxBaseAllowed ?? op.allocation;

      let actualBaseUsd = op.actualBaseUsd;
      if (baseUpper === "USD") {
        actualBaseUsd = baseHoldingUsd;
      } else if (Number.isFinite(baseHoldingAmount)) {
        actualBaseUsd = Number((baseHoldingAmount * price).toFixed(8));
      }
      if (!Number.isFinite(actualBaseUsd)) {
        actualBaseUsd = op.actualBaseUsd;
      }

      const actualQuoteUsd = quoteHoldingUsd;

      const priceRange = max - min;
      const normalized = priceRange === 0 ? 0.5 : clamp((price - min) / priceRange, 0, 1);
      let baseShare = clamp(1 - normalized, 0, 1);
      const desiredBaseUsd = allocation * baseShare;

      let targetBaseCandidate = desiredBaseUsd;
      const rawBaseDiff = desiredBaseUsd - actualBaseUsd;
      const rawSellUsd = rawBaseDiff < 0 ? -rawBaseDiff : 0;

      if (baseHoldUsd > 0) {
        const availableExcess = Math.max(0, actualBaseUsd - baseHoldUsd);
        if (rawSellUsd > 0) {
          if (rawSellUsd < baseHoldUsd || availableExcess <= BASE_TOLERANCE) {
            targetBaseCandidate = actualBaseUsd;
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

      const baseDiffUsd = Number((targetBaseUsd - actualBaseUsd).toFixed(8));

      if (Math.abs(baseDiffUsd) <= BASE_TOLERANCE) {
        return {
          status: "none",
          message: "Con este precio no se debe operar; la diferencia es despreciable.",
        };
      }

      const action: "buy" | "sell" = baseDiffUsd > 0 ? "buy" : "sell";
      const priceIsValid = Number.isFinite(price) && price > 0;
      let suggestedBaseAmount =
        baseUpper === "USD" || !priceIsValid
          ? Math.abs(baseDiffUsd)
          : Math.abs(baseDiffUsd) / price;

      if (!Number.isFinite(suggestedBaseAmount) || suggestedBaseAmount <= 0) {
        return {
          status: "none",
          message: "Con este precio no se debe operar.",
        };
      }

      suggestedBaseAmount = Number(suggestedBaseAmount.toFixed(8));

      const suggestedFiatValue = (() => {
        if (!priceIsValid) return Math.abs(baseDiffUsd);
        if (quoteUpper === "USD" || quoteUpper === "USDT" || quoteUpper === "USDC") {
          return Math.abs(baseDiffUsd);
        }
        return suggestedBaseAmount * price;
      })();

      // Skip suggesting operations if below $10 (both buy and sell)
      if (suggestedFiatValue < 10) {
        return {
          status: "none",
          message: "Operación omitida: monto menor a $10.",
        };
      }

      const approxLabel =
        quoteUpper === "USD" || quoteUpper === "USDT" || quoteUpper === "USDC"
          ? `$${Math.abs(baseDiffUsd).toFixed(2)}`
          : `${suggestedFiatValue.toFixed(2)} ${quoteUpper}`;

      const usdtLabel = action === "buy" ? "PrecioCompraUSDT" : "PrecioVentaUSDT";
      let actionMessage: string;
      if (action === "buy") {
        actionMessage = isUsdtPair
          ? `Comprar ${suggestedBaseAmount.toFixed(6)} ${op.baseAsset} (~${approxLabel}) usando ${op.quoteAsset} a $${price.toFixed(4)} (${usdtLabel}).`
          : `Comprar ${suggestedBaseAmount.toFixed(6)} ${op.baseAsset} (~${approxLabel}) usando ${op.quoteAsset}.`;
      } else {
        actionMessage = isUsdtPair
          ? `Vender ${suggestedBaseAmount.toFixed(6)} ${op.baseAsset} (~${approxLabel}) por ${op.quoteAsset} a $${price.toFixed(4)} (${usdtLabel}).`
          : `Vender ${suggestedBaseAmount.toFixed(6)} ${op.baseAsset} (~${approxLabel}) por ${op.quoteAsset}.`;
      }

      const simulatedOp: Operation = {
        ...op,
        price,
        action,
        actionMessage,
        baseDiffUsd,
        suggestedBaseAmount,
        suggestedFiatValue,
        actualBaseUsd,
        actualQuoteUsd,
        targetBaseUsd,
        targetQuoteUsd,
        targetBasePercent: allocation > 0 ? targetBaseUsd / allocation : 0,
      };

      const adjusted = adjustOperationForClosings(
        simulatedOp,
        openPositionsByAssetRef.current.get(op.assetId)
      );

      if (!adjusted) {
        return {
          status: "none",
          message: "A este precio no se debe operar (no hay cierres rentables).",
        };
      }

      return {
        status: "action",
        message: adjusted.actionMessage,
        suggestedBaseAmount: adjusted.suggestedBaseAmount,
        suggestedFiatValue: adjusted.suggestedFiatValue,
        action: adjusted.action,
        operation: adjusted,
      };
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

  useEffect(() => {
    setPriceOverrides(prev => {
      const next: Record<string, PriceOverrideState> = {};
      let changed = false;
      operations.forEach(op => {
        if (prev[op.id]) {
          next[op.id] = prev[op.id];
        }
      });
      if (Object.keys(next).length !== Object.keys(prev).length) {
        changed = true;
      }
      if (!changed) {
        for (const key of Object.keys(next)) {
          if (next[key] !== prev[key]) {
            changed = true;
            break;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [operations]);

  const handleSimulatedPriceChange = useCallback(
    (op: Operation, value: string) => {
      setPriceOverrides(prev => {
        const next = { ...prev };
        const price = parseNumberInput(value);
        const current = prev[op.id];
        let result: SimulationResult | null = null;
        if (value.trim().length === 0) {
          result = null;
        } else if (Number.isFinite(price) && price > 0) {
          result = simulateOperation(op, price);
        } else {
          result = {
            status: "invalid",
            message: "Ingresa un precio válido.",
          };
        }
        next[op.id] = {
          input: value,
          result,
          visible: current?.visible ?? true,
        };
        return next;
      });
    },
    [simulateOperation]
  );

  const togglePriceOverride = useCallback((opId: string) => {
    setPriceOverrides(prev => {
      const next = { ...prev };
      const current = next[opId];
      const visible = !(current?.visible ?? false);
      next[opId] = {
        input: current?.input ?? "",
        result: current?.result ?? null,
        visible,
      };
      return next;
    });
  }, []);

  const resolveOperationForAction = useCallback(
    (operation: Operation): Operation => {
      const override = priceOverrides[operation.id];
      const overrideResult = override?.result;
      if (overrideResult?.status === "action" && overrideResult.operation) {
        return overrideResult.operation;
      }
      return operation;
    },
    [priceOverrides]
  );

  const formatNumberForInput = (value: number | null | undefined, precision = 6) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    return value.toFixed(precision);
  };

  const handleOperationPress = useCallback(
    (operation: Operation) => {
      if (operation.action !== "sell" && operation.action !== "buy") return;
      const derivedOperation = resolveOperationForAction(operation);
      setSelectedOperation(derivedOperation);
      setSuggestionModalVisible(true);
    },
    [resolveOperationForAction]
  );

  const handleRegisterPress = useCallback(
    (operation: Operation) => {
      const derived = resolveOperationForAction(operation);
      const defaultType: "long" | "short" = derived.action === "sell" ? "short" : "long";
      const fiatCurrency = derived.quoteAsset?.toUpperCase?.() ?? "USDT";
      const pricePrecision = fiatCurrency === "USDT" ? 8 : 6;
      const defaultPrice = formatNumberForInput(derived.price, pricePrecision);
      const defaultAmount = formatNumberForInput(derived.suggestedBaseAmount, 8);
      const defaultFiat = formatNumberForInput(
        derived.suggestedFiatValue ??
          (typeof derived.price === "number" && typeof derived.suggestedBaseAmount === "number"
            ? derived.price * derived.suggestedBaseAmount
            : undefined),
        fiatCurrency === "USD" ? 2 : fiatCurrency === "USDT" ? 8 : 4
      );

      setRegisterTarget(derived);
      setRegisterForm({
        type: defaultType,
        openPrice: defaultPrice,
        amount: defaultAmount,
        openValueFiat: defaultFiat,
        fiatCurrency,
        openFee: "",
        openFeeCurrency: derived.isBinance ? "BNB" : "USD",
        openDate: "",
      });
      setRegisterError(null);
      setRegisterModalVisible(true);
    },
    [resolveOperationForAction]
  );

  const closeRegisterModal = useCallback(() => {
    setRegisterModalVisible(false);
    setRegisterTarget(null);
    setRegisterForm(createEmptyRegisterForm());
    setRegisterError(null);
  }, []);

  const handleRegisterFieldChange = useCallback(
    (field: keyof RegisterFormState, value: string) => {
      setRegisterForm(prev => ({ ...prev, [field]: value }));
    },
    []
  );

  const recalculateRegisterFiat = useCallback(() => {
    const price = parseNumberInput(registerForm.openPrice);
    const amount = parseNumberInput(registerForm.amount);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) {
      setRegisterError("Ingresa precio y cantidad válidos para recalcular.");
      return;
    }
    const computed = Number((price * amount).toFixed(8));
    setRegisterForm(prev => ({ ...prev, openValueFiat: computed.toString() }));
    setRegisterError(null);
  }, [registerForm.amount, registerForm.openPrice]);

  const handleRegisterSubmit = useCallback(async () => {
    if (!registerTarget) return;

    const price = parseNumberInput(registerForm.openPrice);
    const amount = parseNumberInput(registerForm.amount);
    let openValueFiat = parseNumberInput(registerForm.openValueFiat);
    const fee = parseNumberInput(registerForm.openFee);

    if (!Number.isFinite(price) || price <= 0) {
      setRegisterError("Ingresa un precio válido.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setRegisterError("Ingresa una cantidad válida.");
      return;
    }

    if (!Number.isFinite(openValueFiat) || openValueFiat <= 0) {
      openValueFiat = Number((price * amount).toFixed(8));
    }

    if (!Number.isFinite(openValueFiat) || openValueFiat <= 0) {
      setRegisterError("Ingresa un monto en fiat válido.");
      return;
    }

    if (openValueFiat < 10) {
      setRegisterError("El monto debe ser al menos $10.");
      return;
    }

    const fiatCurrency = (registerForm.fiatCurrency || registerTarget.quoteAsset || "USDT").toUpperCase();
    const normalizedType: "long" | "short" = registerForm.type === "short" ? "short" : "long";
    const feeCurrency = (registerForm.openFeeCurrency || fiatCurrency).toUpperCase();

    const payload: Record<string, unknown> = {
      asset: registerTarget.assetId,
      type: normalizedType,
      fiatCurrency,
      openPrice: price,
      amount,
      openValueFiat,
    };

    if (Number.isFinite(fee) && fee > 0) {
      payload.openFee = fee;
      payload.openFeeCurrency = feeCurrency;
    }

    if (registerForm.openDate.trim().length > 0) {
      const date = new Date(registerForm.openDate.trim());
      if (Number.isNaN(date.getTime())) {
        setRegisterError("Fecha inválida. Usa un formato ISO o deja el campo vacío.");
        return;
      }
      payload.openDate = date.toISOString();
    }

    setRegisterSubmitting(true);
    try {
      await api.post("/transactions", payload);
      Alert.alert("Transacción registrada", "La transacción se guardó correctamente.");
      closeRegisterModal();
      await loadData({ silent: true });
    } catch (err: any) {
      const message = err?.response?.data?.error ?? err?.message ?? "No se pudo registrar la transacción.";
      setRegisterError(typeof message === "string" ? message : "No se pudo registrar la transacción.");
    } finally {
      setRegisterSubmitting(false);
    }
  }, [closeRegisterModal, loadData, registerForm, registerTarget]);

  const closeSuggestionModal = useCallback(() => {
    setSuggestionModalVisible(false);
    setSelectedOperation(null);
  }, []);

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
          const tradeHint =
            op.action === "sell"
              ? "Pulsa para ver la sugerencia de venta."
              : "Pulsa para ver la sugerencia de compra.";
          const overrideState = priceOverrides[op.id];
          const simulatedPriceText = overrideState?.input ?? "";
          const simulationResult = overrideState?.result ?? null;
          const simulationIsAction = simulationResult?.status === "action";
          const simulationIsInvalid = simulationResult?.status === "invalid";
          const simulationText = simulationResult?.message;
          const overrideVisible = overrideState?.visible ?? false;

          return (
            <View key={op.id} style={[styles.card, !isActionSupported && styles.cardDisabled]}>
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
              <Text style={styles.action}>{op.actionMessage}</Text>

              {isActionSupported ? (
                <>
                  <View style={styles.customToggleRow}>
                    <TouchableOpacity
                      style={styles.customToggle}
                      onPress={() => togglePriceOverride(op.id)}
                    >
                      <Text style={styles.customToggleIcon}>{overrideVisible ? "✖️" : "🧮"}</Text>
                    </TouchableOpacity>
                  </View>
                  {overrideVisible ? (
                    <View style={styles.customSection}>
                      <Text style={styles.customLabel}>Simular con otro precio</Text>
                      <TextInput
                        style={styles.customInput}
                        value={simulatedPriceText}
                        placeholder={`Ej. ${op.price.toFixed(4)}`}
                        onChangeText={text => handleSimulatedPriceChange(op, text)}
                        keyboardType="numeric"
                      />
                      {simulationText ? (
                        <Text
                          style={[
                            styles.customResult,
                            simulationIsAction && styles.customResultOk,
                            (simulationResult?.status === "none" || simulationIsInvalid) && styles.customResultWarn,
                          ]}
                        >
                          {simulationText}
                        </Text>
                      ) : null}
                      {simulationIsAction &&
                        simulationResult?.suggestedBaseAmount != null &&
                        simulationResult?.suggestedFiatValue != null && (
                          <Text style={styles.customDetail}>
                            Cantidad sugerida: {formatAssetAmount(simulationResult.suggestedBaseAmount, op.baseAsset)}{' '}
                            {op.baseAsset} ({formatQuoteValue(simulationResult.suggestedFiatValue, op.quoteAsset)})
                          </Text>
                        )}
                    </View>
                  ) : null}
                  <TouchableOpacity
                    style={styles.cardButton}
                    onPress={() => handleOperationPress(op)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cardButtonText}>
                      {op.action === "buy" ? "Ver sugerencia de compra" : "Ver sugerencia de venta"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.cardButton, styles.cardButtonSecondary]}
                    onPress={() => handleRegisterPress(op)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cardButtonText}>Registrar transacción</Text>
                  </TouchableOpacity>
                  <Text style={styles.hint}>{tradeHint}</Text>
                </>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    );
  }, [
    error,
    handleOperationPress,
    handleSimulatedPriceChange,
    loading,
    operations,
    priceOverrides,
    refreshHandler,
    refreshing,
    togglePriceOverride,
    handleRegisterPress,
  ]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📊 Transacciones sugeridas</Text>
      {content}

      <Modal
        visible={suggestionModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeSuggestionModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedOperation ? (
              <>
                <Text style={styles.modalTitle}>{selectedOperation.symbol}</Text>
                <Text style={styles.modalLabel}>
                  Precio actual: ${selectedOperation.price.toFixed(4)}
                </Text>
                <Text style={styles.modalLabel}>
                  {selectedOperation.action === "buy" ? "Total a comprar" : "Total a vender"}
                </Text>
                <Text style={styles.modalValue}>
                  {formatAssetAmount(selectedOperation.suggestedBaseAmount, selectedOperation.baseAsset)}{' '}
                  {selectedOperation.baseAsset} ({
                    formatQuoteValue(selectedOperation.suggestedFiatValue, selectedOperation.quoteAsset)
                  })
                </Text>
                <TouchableOpacity
                  style={[styles.cardButton, styles.modalCloseButton]}
                  onPress={closeSuggestionModal}
                  activeOpacity={0.85}
                >
                  <Text style={styles.cardButtonText}>Cerrar</Text>
                </TouchableOpacity>
              </>
            ) : (
              <ActivityIndicator size="large" />
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={registerModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeRegisterModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {registerTarget ? (
              <>
                <Text style={styles.modalTitle}>Registrar {registerTarget.symbol}</Text>
                <Text style={styles.customDetail}>
                  Base: {registerTarget.baseAsset} | Quote: {registerTarget.quoteAsset}
                </Text>
                {registerError ? (
                  <Text style={[styles.customResult, styles.customResultWarn, styles.modalError]}>
                    {registerError}
                  </Text>
                ) : null}
                <Text style={styles.modalLabel}>Tipo de posición</Text>
                <View style={styles.modalTypeRow}>
                  <TouchableOpacity
                    style={[
                      styles.modalTypeButton,
                      registerForm.type === "long" && styles.modalTypeButtonActive,
                    ]}
                    onPress={() => setRegisterForm(prev => ({ ...prev, type: "long" }))}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.modalTypeButtonText,
                        registerForm.type === "long" && styles.modalTypeButtonTextActive,
                      ]}
                    >
                      Long
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalTypeButton,
                      registerForm.type === "short" && styles.modalTypeButtonActive,
                    ]}
                    onPress={() => setRegisterForm(prev => ({ ...prev, type: "short" }))}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.modalTypeButtonText,
                        registerForm.type === "short" && styles.modalTypeButtonTextActive,
                      ]}
                    >
                      Short
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalLabel}>Precio de apertura</Text>
                <TextInput
                  style={styles.customInput}
                  value={registerForm.openPrice}
                  onChangeText={value => handleRegisterFieldChange("openPrice", value)}
                  keyboardType="numeric"
                  placeholder="Precio (ej. 175.50)"
                />

                <Text style={styles.modalLabel}>Cantidad en base ({registerTarget.baseAsset})</Text>
                <TextInput
                  style={styles.customInput}
                  value={registerForm.amount}
                  onChangeText={value => handleRegisterFieldChange("amount", value)}
                  keyboardType="numeric"
                  placeholder="Cantidad (ej. 0.42)"
                />

                <Text style={styles.modalLabel}>Total en fiat ({registerForm.fiatCurrency || registerTarget.quoteAsset})</Text>
                <TextInput
                  style={styles.customInput}
                  value={registerForm.openValueFiat}
                  onChangeText={value => handleRegisterFieldChange("openValueFiat", value)}
                  keyboardType="numeric"
                  placeholder="Total (ej. 100.00)"
                />
                <TouchableOpacity
                  style={styles.helperButton}
                  onPress={recalculateRegisterFiat}
                  activeOpacity={0.8}
                >
                  <Text style={styles.helperButtonText}>Recalcular total con precio × cantidad</Text>
                </TouchableOpacity>

                <Text style={styles.modalLabel}>Moneda fiat</Text>
                <TextInput
                  style={styles.customInput}
                  value={registerForm.fiatCurrency}
                  onChangeText={value => handleRegisterFieldChange("fiatCurrency", value.toUpperCase())}
                  autoCapitalize="characters"
                  placeholder="USDT"
                />

                <Text style={styles.modalLabel}>Fee de apertura (opcional)</Text>
                <TextInput
                  style={styles.customInput}
                  value={registerForm.openFee}
                  onChangeText={value => handleRegisterFieldChange("openFee", value)}
                  keyboardType="numeric"
                  placeholder="0"
                />

                <Text style={styles.modalLabel}>Moneda del fee</Text>
                <View style={styles.modalTypeRow}>
                  {["BNB", "USDT", "USD"].map(currency => {
                    const isActive = registerForm.openFeeCurrency === currency;
                    return (
                      <TouchableOpacity
                        key={currency}
                        style={[styles.modalTypeButton, isActive && styles.modalTypeButtonActive]}
                        onPress={() => setRegisterForm(prev => ({ ...prev, openFeeCurrency: currency }))}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[styles.modalTypeButtonText, isActive && styles.modalTypeButtonTextActive]}
                        >
                          {currency}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.modalLabel}>Fecha de apertura (opcional)</Text>
                <TextInput
                  style={styles.customInput}
                  value={registerForm.openDate}
                  onChangeText={value => handleRegisterFieldChange("openDate", value)}
                  placeholder="Ej. 2024-05-30T14:30:00"
                />

                <TouchableOpacity
                  style={[
                    styles.cardButton,
                    styles.cardButtonSecondary,
                    registerSubmitting && styles.cardButtonDisabled,
                  ]}
                  onPress={handleRegisterSubmit}
                  activeOpacity={0.8}
                  disabled={registerSubmitting}
                >
                  <Text style={styles.cardButtonText}>
                    {registerSubmitting ? "Guardando..." : "Registrar transacción"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.cardButton,
                    styles.cardButtonGhost,
                    registerSubmitting && styles.cardButtonDisabled,
                  ]}
                  onPress={closeRegisterModal}
                  activeOpacity={0.8}
                  disabled={registerSubmitting}
                >
                  <Text style={styles.cardButtonText}>Cancelar</Text>
                </TouchableOpacity>
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

const createEmptyRegisterForm = (): RegisterFormState => ({
  type: "long",
  openPrice: "",
  amount: "",
  openValueFiat: "",
  fiatCurrency: "",
  openFee: "",
  openFeeCurrency: "USDT",
  openDate: "",
});

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
  customSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    gap: 8,
  },
  customToggleRow: {
    marginTop: 12,
    alignItems: "flex-start",
  },
  customToggle: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#90a4ae",
    backgroundColor: "#fff",
  },
  customToggleIcon: {
    fontSize: 18,
  },
  customLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  customInput: {
    borderWidth: 1,
    borderColor: "#d0d0d0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    color: "#333",
  },
  customResult: {
    fontSize: 14,
    color: "#333",
  },
  customResultOk: {
    color: "#2e7d32",
  },
  customResultWarn: {
    color: "#c62828",
  },
  customDetail: {
    fontSize: 13,
    color: "#555",
  },
  cardButton: {
    marginTop: 8,
    backgroundColor: "#1976d2",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  cardButtonSecondary: {
    backgroundColor: "#2e7d32",
  },
  cardButtonGhost: {
    backgroundColor: "#546e7a",
  },
  cardButtonDisabled: {
    opacity: 0.6,
  },
  cardButtonText: {
    color: "#fff",
    fontWeight: "600",
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
    marginBottom: 4,
  },
  modalValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1b5e20",
    marginBottom: 12,
  },
  modalCloseButton: {
    marginTop: 8,
  },
  modalTypeRow: {
    flexDirection: "row",
    gap: 8,
  },
  modalTypeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#90a4ae",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  modalTypeButtonActive: {
    backgroundColor: "#1976d2",
    borderColor: "#1976d2",
  },
  modalTypeButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  modalTypeButtonTextActive: {
    color: "#fff",
  },
  modalError: {
    marginTop: 4,
  },
  helperButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#1976d2",
  },
  helperButtonText: {
    color: "#1976d2",
    fontWeight: "600",
  },
});

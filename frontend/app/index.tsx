import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Button,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  FlatList,
  TouchableOpacity,
  Modal,
} from "react-native";
import api from "../constants/api";

interface ConfigDoc {
  _id: string;
  name: string;
  total: number;
}

interface AssetDoc {
  _id: string;
  symbol?: string;
  initialInvestment?: number | Record<string, unknown> | null;
  type?: string;
}

interface UpdateUsdtResponse {
  message?: string;
  buyConfig: ConfigDoc;
  sellConfig: ConfigDoc;
  candle: {
    closeTime: string;
    close: number;
  };
}

type StockSuggestion = {
  symbol: string;
  name: string;
  exchange?: string;
  type?: string;
};

type NewAssetDraft =
  | {
      type: "crypto";
      symbol: string;
      exchange: string;
    }
  | {
      type: "stock";
      symbol: string;
      exchange?: string;
      name?: string;
    };

type DeletableAsset = {
  _id: string;
  symbol?: string;
  type?: string;
};

type BinanceBalanceEntry = {
  asset: string;
  total: number;
  usdValue: number;
};

const findConfigByNames = (docs: ConfigDoc[], names: string[]) =>
  docs.find(doc => names.some(name => doc?.name === name)) ?? null;

const formatNumber = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) ? value.toString() : "";

const parseInput = (value: string) => {
  const parsed = parseFloat(value.replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : NaN;
};

const getInitialInvestmentAmount = (
  initialInvestment?: number | Record<string, unknown> | null
) => {
  if (initialInvestment == null) return null;
  if (typeof initialInvestment === "number") return initialInvestment;
  if (typeof (initialInvestment as { USD?: unknown }).USD === "number") {
    return (initialInvestment as { USD: number }).USD;
  }
  if (typeof (initialInvestment as { amount?: unknown }).amount === "number") {
    return (initialInvestment as { amount: number }).amount;
  }
  return null;
};

export default function Index() {
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [usdConfig, setUsdConfig] = useState<ConfigDoc | null>(null);
  const [penConfig, setPenConfig] = useState<ConfigDoc | null>(null);
  const [usdtBuyConfig, setUsdtBuyConfig] = useState<ConfigDoc | null>(null);
  const [usdtSellConfig, setUsdtSellConfig] = useState<ConfigDoc | null>(null);
  const [assets, setAssets] = useState<AssetDoc[]>([]);
  const [lastCreatedAssetTotal, setLastCreatedAssetTotal] = useState<number | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [deletingAsset, setDeletingAsset] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [binanceBalances, setBinanceBalances] = useState<BinanceBalanceEntry[]>([]);
  const [binanceTotals, setBinanceTotals] = useState<{ usd: number; pen: number } | null>(null);
  const [penUsdRate, setPenUsdRate] = useState<number | null>(null);
  const [vooMarketPrice, setVooMarketPrice] = useState<number | null>(null);

  const [usdInput, setUsdInput] = useState("");
  const [penInput, setPenInput] = useState("");
  const [usdtBuyInput, setUsdtBuyInput] = useState("");
  const [usdtSellInput, setUsdtSellInput] = useState("");
  const [showAddAssetOptions, setShowAddAssetOptions] = useState(false);
  const [showCryptoSelector, setShowCryptoSelector] = useState(false);
  const [cryptoSymbols, setCryptoSymbols] = useState<string[]>([]);
  const [cryptoSearch, setCryptoSearch] = useState("");
  const [cryptoLoading, setCryptoLoading] = useState(false);
  const [cryptoError, setCryptoError] = useState<string | null>(null);
  const [showStockSelector, setShowStockSelector] = useState(false);
  const [stockSearch, setStockSearch] = useState("");
  const [stockResults, setStockResults] = useState<StockSuggestion[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [newAssetDraft, setNewAssetDraft] = useState<NewAssetDraft | null>(null);
  const [savingNewAsset, setSavingNewAsset] = useState(false);
  const [newAssetError, setNewAssetError] = useState<string | null>(null);
  const [showDeleteList, setShowDeleteList] = useState(false);
  const [stockInputs, setStockInputs] = useState<Record<string, string>>({});
  const [stockSavingMap, setStockSavingMap] = useState<Record<string, boolean>>({});
  const [stockErrorMap, setStockErrorMap] = useState<Record<string, string | null>>({});

  const [savingUsd, setSavingUsd] = useState(false);
  const [savingPen, setSavingPen] = useState(false);
  const [savingUsdt, setSavingUsdt] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const [configRes, assetsRes] = await Promise.all([
          api.get<ConfigDoc[]>("/config-info"),
          api.get<AssetDoc[]>("/assets"),
        ]);

        const configData = Array.isArray(configRes.data) ? configRes.data : [];
        const assetsData = Array.isArray(assetsRes.data) ? assetsRes.data : [];
        setAssets(assetsData);

        const usdDoc = configData.find(doc => doc?.name === "totalUSD") ?? null;
        const penDoc =
          configData.find(doc => doc?.name === "totalPEN" || doc?.name === "totalPen") ??
          null;
        const buyDoc = findConfigByNames(configData, ["lastPriceUsdtBuy", "PrecioCompraUSDT"]);
        const sellDoc = findConfigByNames(configData, ["lastPriceUsdtSell", "PrecioVentaUSDT"]);
        const lastCreatedDoc = configData.find(doc => doc?.name === "TotalUltimoActivoCreado") ?? null;

        if (usdDoc) {
          setUsdConfig(usdDoc);
          setUsdInput(formatNumber(usdDoc.total));
        }
        if (penDoc) {
          setPenConfig(penDoc);
          setPenInput(formatNumber(penDoc.total));
        }
        if (buyDoc) {
          setUsdtBuyConfig(buyDoc);
          setUsdtBuyInput(formatNumber(buyDoc.total));
        }
        if (sellDoc) {
          setUsdtSellConfig(sellDoc);
          setUsdtSellInput(formatNumber(sellDoc.total));
        }
        if (lastCreatedDoc) {
          setLastCreatedAssetTotal(lastCreatedDoc.total);
        } else {
          setLastCreatedAssetTotal(null);
        }
      } catch (err) {
        console.error("❌ Error al obtener configuración:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  useEffect(() => {
    const fetchBinanceTotals = async () => {
      try {
        const res = await api.get<{ totals?: { usd: number; pen: number }; balances?: BinanceBalanceEntry[] }>(
          "/binance/balances"
        );
        if (Array.isArray(res.data?.balances)) {
          setBinanceBalances(res.data.balances);
        }
        if (res.data?.totals) {
          setBinanceTotals(res.data.totals);
        }
      } catch (err) {
        console.error("❌ Error obteniendo totales de Binance:", err);
      }
    };

    fetchBinanceTotals();
  }, []);

  useEffect(() => {
    const fetchPenRate = async () => {
      try {
        const res = await fetch("https://open.er-api.com/v6/latest/PEN");
        const data = await res.json();
        if (data.result === "success" && typeof data.rates?.USD === "number") {
          setPenUsdRate(data.rates.USD);
        }
      } catch (err) {
        console.error("❌ Error obteniendo tipo de cambio PEN/USD:", err);
      }
    };

    fetchPenRate();
  }, []);

  useEffect(() => {
    const hasVoo = assets.some(asset => asset.symbol?.toUpperCase() === "VOO");
    if (!hasVoo) {
      setVooMarketPrice(null);
      return;
    }

    let cancelled = false;

    const fetchVoo = async () => {
      try {
        const res = await fetch(
          "https://query1.finance.yahoo.com/v8/finance/chart/VOO?interval=1d&range=1d"
        );
        if (!res.ok) return;
        const data = await res.json();
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        if (!cancelled && typeof price === "number") {
          setVooMarketPrice(price);
        }
      } catch (err) {
        console.error("❌ Error obteniendo precio de VOO:", err);
      }
    };

    fetchVoo();

    return () => {
      cancelled = true;
    };
  }, [assets]);

  const parsedUsd = useMemo(() => parseInput(usdInput), [usdInput]);
  const parsedPen = useMemo(() => parseInput(penInput), [penInput]);
  const parsedBuy = useMemo(() => parseInput(usdtBuyInput), [usdtBuyInput]);
  const parsedSell = useMemo(() => parseInput(usdtSellInput), [usdtSellInput]);
  const canSaveUsd =
    !!usdConfig && !savingUsd && !Number.isNaN(parsedUsd) && parsedUsd !== usdConfig.total;
  const canSavePen =
    !!penConfig && !savingPen && !Number.isNaN(parsedPen) && parsedPen !== penConfig.total;
  const canSaveUsdt =
    !!usdtBuyConfig &&
    !!usdtSellConfig &&
    !savingUsdt &&
    !Number.isNaN(parsedBuy) &&
    !Number.isNaN(parsedSell) &&
    (parsedBuy !== usdtBuyConfig.total || parsedSell !== usdtSellConfig.total);

  const filteredCryptoSymbols = useMemo(() => {
    const query = cryptoSearch.trim().toUpperCase();
    if (!query) return cryptoSymbols;
    return cryptoSymbols.filter(symbol => symbol.includes(query));
  }, [cryptoSymbols, cryptoSearch]);

  const stockAssets = useMemo(
    () => assets.filter(asset => (asset.type ?? "").toLowerCase() === "stock"),
    [assets]
  );

  const deletableAssets = useMemo<DeletableAsset[]>(() => {
    return assets
      .filter(asset => (asset.type ?? "").toLowerCase() !== "fiat")
      .map(asset => ({
        _id: asset._id,
        symbol: asset.symbol,
        type: asset.type,
      }));
  }, [assets]);

  useEffect(() => {
    if (selectedAssetId && !assets.some(asset => asset._id === selectedAssetId)) {
      setSelectedAssetId(null);
    }
  }, [assets, selectedAssetId]);

  useEffect(() => {
    const inputs: Record<string, string> = {};
    stockAssets.forEach(asset => {
      const amount = getInitialInvestmentAmount(asset.initialInvestment);
      inputs[asset._id] = formatNumber(amount ?? null);
    });
    setStockInputs(inputs);
    setStockErrorMap({});
    setStockSavingMap({});
  }, [stockAssets]);

  const stockHoldings = useMemo(() => {
    return stockAssets.map(asset => ({
      symbol: asset.symbol?.toUpperCase() ?? "",
      amount: getInitialInvestmentAmount(asset.initialInvestment) ?? 0,
    }));
  }, [stockAssets]);

  const stockBalances = useMemo(() => {
    return stockAssets.map(asset => {
      const symbol = asset.symbol?.toUpperCase() ?? "";
      const inputValue = stockInputs[asset._id] ?? "";
      const parsed = parseInput(inputValue);
      const fallbackAmount = getInitialInvestmentAmount(asset.initialInvestment) ?? 0;
      const amount = Number.isNaN(parsed) ? fallbackAmount : parsed;
      const isVoo = symbol === "VOO";
      const usdValue = isVoo && typeof vooMarketPrice === "number" && vooMarketPrice > 0
        ? amount * vooMarketPrice
        : amount;
      return {
        id: asset._id,
        asset: symbol,
        total: amount,
        usdValue,
      };
    });
  }, [stockAssets, stockInputs, vooMarketPrice]);

  const effectiveUsdTotal = useMemo(() => {
    return !Number.isNaN(parsedUsd) ? parsedUsd : usdConfig?.total ?? 0;
  }, [parsedUsd, usdConfig]);

  const effectivePenTotal = useMemo(() => {
    return !Number.isNaN(parsedPen) ? parsedPen : penConfig?.total ?? 0;
  }, [parsedPen, penConfig]);

  const extendedBalances = useMemo(() => {
    const list: { asset: string; total: number; usdValue: number }[] = [];
    binanceBalances.forEach(balance => {
      if (balance?.usdValue > 0) {
        list.push({
          asset: balance.asset,
          total: balance.total,
          usdValue: balance.usdValue,
        });
      }
    });

    stockBalances.forEach(balance => {
      if (balance.usdValue > 0) {
        list.push({ asset: balance.asset, total: balance.total, usdValue: balance.usdValue });
      }
    });

    if (effectiveUsdTotal > 0) {
      list.push({ asset: "USD", total: effectiveUsdTotal, usdValue: effectiveUsdTotal });
    }
    if (effectivePenTotal > 0) {
      const usdEquivalent = penUsdRate ? effectivePenTotal * penUsdRate : 0;
      if (usdEquivalent > 0) {
        list.push({ asset: "PEN", total: effectivePenTotal, usdValue: usdEquivalent });
      }
    }

    return list;
  }, [binanceBalances, stockBalances, effectiveUsdTotal, effectivePenTotal, penUsdRate]);

  const totalBalance = useMemo(() => {
    return extendedBalances.reduce((acc, item) => acc + item.usdValue, 0);
  }, [extendedBalances]);

  const nonFiatAssetsCount = useMemo(() => deletableAssets.length, [deletableAssets]);

  const requiredBalance = useMemo(() => {
    const base = lastCreatedAssetTotal ?? 0;
    return base + nonFiatAssetsCount * 200 + 200;
  }, [lastCreatedAssetTotal, nonFiatAssetsCount]);

  const canAccessAddAsset = useMemo(() => totalBalance > requiredBalance, [totalBalance, requiredBalance]);

  const saveValue = async (
    config: ConfigDoc | null,
    parsed: number,
    setConfig: (config: ConfigDoc) => void,
    setInput: (value: string) => void,
    setSaving: (value: boolean) => void,
    successMessage: string,
    errorMessage: string
  ) => {
    if (!config || Number.isNaN(parsed)) return;
    try {
      setSaving(true);
      await api.put(`/config-info/${config._id}`, { total: parsed });
      const updated = { ...config, total: parsed };
      setConfig(updated);
      setInput(formatNumber(parsed));
      setFeedback(successMessage);
    } catch (err) {
      console.error(errorMessage, err);
      setFeedback(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleFocusValue = (
    currentValue: number | null | undefined,
    input: string,
    setInput: (value: string) => void
  ) => {
    const formatted = formatNumber(currentValue);
    if (formatted && input === formatted) {
      setInput("");
    }
  };

  const handleStockInputChange = useCallback((assetId: string, value: string) => {
    setStockInputs(prev => ({ ...prev, [assetId]: value }));
    setStockErrorMap(prev => ({ ...prev, [assetId]: null }));
  }, []);

  const handleSaveStockValue = useCallback(
    async (asset: AssetDoc) => {
      const rawValue = stockInputs[asset._id] ?? "";
      const parsed = parseInput(rawValue);
      if (Number.isNaN(parsed) || parsed < 0) {
        setStockErrorMap(prev => ({ ...prev, [asset._id]: "Ingresa un número válido." }));
        return;
      }

      try {
        setStockSavingMap(prev => ({ ...prev, [asset._id]: true }));
        const normalized = Number(parsed.toFixed(8));
        const payload = { initialInvestment: { amount: normalized } };
        const res = await api.put<AssetDoc>(`/assets/${asset._id}`, payload);
        const updatedAsset = res.data;
        if (updatedAsset) {
          setAssets(prev => prev.map(item => (item._id === asset._id ? updatedAsset : item)));
          setStockInputs(prev => ({ ...prev, [asset._id]: formatNumber(normalized) }));
          setStockErrorMap(prev => ({ ...prev, [asset._id]: null }));
        }
        setFeedback(`Total actualizado para ${asset.symbol ?? "activo"}`);
      } catch (err) {
        console.error(`❌ Error guardando total para ${asset.symbol ?? "activo"}:`, err);
        const message =
          (err as any)?.response?.data?.error ||
          (err as Error)?.message ||
          "No se pudo guardar el total.";
        setStockErrorMap(prev => ({ ...prev, [asset._id]: message }));
      } finally {
        setStockSavingMap(prev => ({ ...prev, [asset._id]: false }));
      }
    },
    [stockInputs]
  );

  const saveUsdtPrices = async () => {
    if (
      !usdtBuyConfig ||
      !usdtSellConfig ||
      Number.isNaN(parsedBuy) ||
      Number.isNaN(parsedSell)
    ) {
      return;
    }

    try {
      setSavingUsdt(true);
      const res = await api.put<UpdateUsdtResponse>("/config-info/usdt/prices", {
        buyPrice: parsedBuy,
        sellPrice: parsedSell,
      });
      const data = res.data;

      if (data?.buyConfig) {
        setUsdtBuyConfig(data.buyConfig);
        setUsdtBuyInput(formatNumber(data.buyConfig.total));
      } else {
        setUsdtBuyConfig({ ...usdtBuyConfig, total: parsedBuy });
        setUsdtBuyInput(formatNumber(parsedBuy));
      }

      if (data?.sellConfig) {
        setUsdtSellConfig(data.sellConfig);
        setUsdtSellInput(formatNumber(data.sellConfig.total));
      } else {
        setUsdtSellConfig({ ...usdtSellConfig, total: parsedSell });
        setUsdtSellInput(formatNumber(parsedSell));
      }

      setFeedback(data?.message ?? "Precios USDT guardados correctamente.");
    } catch (err) {
      console.error("❌ Error guardando precios USDT:", err);
      setFeedback("No se pudieron guardar los precios USDT.");
    } finally {
      setSavingUsdt(false);
    }
  };

  const toggleAddAssetOptions = useCallback(() => {
    setShowAddAssetOptions(prev => {
      const next = !prev;
      if (!next) {
        setShowCryptoSelector(false);
        setShowStockSelector(false);
        setCryptoSearch("");
        setStockSearch("");
        setStockResults([]);
        setCryptoError(null);
        setStockError(null);
        setNewAssetDraft(null);
        setSavingNewAsset(false);
        setNewAssetError(null);
        setDeletingAsset(false);
        setSelectedAssetId(null);
        setDeleteError(null);
      } else {
        setShowDeleteList(false);
        setSelectedAssetId(null);
        setDeleteError(null);
        setDeletingAsset(false);
      }
      return next;
    });
  }, []);

  const toggleDeleteList = useCallback(() => {
    setShowDeleteList(prev => {
      const next = !prev;
      if (next) {
        setShowAddAssetOptions(false);
        setShowCryptoSelector(false);
        setShowStockSelector(false);
        setNewAssetDraft(null);
        setSavingNewAsset(false);
        setNewAssetError(null);
        setDeletingAsset(false);
      } else {
        setSelectedAssetId(null);
        setDeleteError(null);
        setDeletingAsset(false);
      }
      return next;
    });
  }, []);

  const loadCryptoPairs = useCallback(async () => {
    if (cryptoSymbols.length || cryptoLoading) {
      return;
    }
    try {
      setCryptoLoading(true);
      setCryptoError(null);
      const response = await fetch("https://api.binance.com/api/v3/exchangeInfo");
      if (!response.ok) {
        throw new Error(`Estado ${response.status}`);
      }
      const data = await response.json();
      const pairs: string[] = Array.isArray(data?.symbols)
        ? data.symbols
            .filter((item: any) => item?.quoteAsset === "USDT" && item?.status === "TRADING")
            .map((item: any) => String(item.symbol))
        : [];
      pairs.sort();
      setCryptoSymbols(pairs);
    } catch (err) {
      console.error("❌ Error cargando pares de Binance:", err);
      setCryptoError("No se pudieron cargar los pares de Binance.");
    } finally {
      setCryptoLoading(false);
    }
  }, [cryptoSymbols.length, cryptoLoading]);

  const handleSelectCrypto = useCallback(() => {
    setShowCryptoSelector(true);
    setShowStockSelector(false);
    setCryptoSearch("");
    setCryptoError(null);
    setNewAssetError(null);
    setSavingNewAsset(false);
    loadCryptoPairs();
  }, [loadCryptoPairs]);

  const handleSelectCryptoPair = useCallback(
    (symbol: string) => {
      setNewAssetDraft({ type: "crypto", symbol, exchange: "BINANCE" });
      setFeedback(`Par seleccionado: ${symbol}`);
      setNewAssetError(null);
      setSavingNewAsset(false);
      setShowCryptoSelector(false);
      setShowStockSelector(false);
      setShowAddAssetOptions(false);
      setCryptoSearch("");
    },
    []
  );

  const handleCloseCryptoSelector = useCallback(() => {
    setShowCryptoSelector(false);
    setShowAddAssetOptions(false);
    setCryptoSearch("");
    setSavingNewAsset(false);
    setNewAssetError(null);
  }, []);

  const handleSelectStock = useCallback(() => {
    setShowStockSelector(true);
    setShowCryptoSelector(false);
    setStockSearch("");
    setStockResults([]);
    setStockError(null);
    setStockLoading(false);
    setSavingNewAsset(false);
    setNewAssetError(null);
  }, []);

  const handleCloseStockSelector = useCallback(() => {
    setShowStockSelector(false);
    setShowAddAssetOptions(false);
    setStockSearch("");
    setStockResults([]);
    setStockError(null);
    setStockLoading(false);
    setSavingNewAsset(false);
    setNewAssetError(null);
  }, []);

  const handleSelectStockSuggestion = useCallback((suggestion: StockSuggestion) => {
    setNewAssetDraft({
      type: "stock",
      symbol: suggestion.symbol,
      exchange: "etoro",
      name: suggestion.name,
    });
    const displayName = suggestion.name
      ? `${suggestion.symbol} · ${suggestion.name}`
      : suggestion.symbol;
    setFeedback(`Activo seleccionado: ${displayName}`);
    setNewAssetError(null);
    setSavingNewAsset(false);
    setShowStockSelector(false);
    setShowAddAssetOptions(false);
    setStockSearch("");
    setStockResults([]);
  }, []);

  const handleDeleteAsset = useCallback(async () => {
    if (!selectedAssetId || deletingAsset) return;
    try {
      setDeletingAsset(true);
      setDeleteError(null);
      await api.delete(`/assets/${selectedAssetId}`);
      setFeedback("Activo borrado correctamente.");
      setAssets(prev => prev.filter(asset => asset._id !== selectedAssetId));
      setSelectedAssetId(null);
    } catch (err) {
      console.error("❌ Error borrando activo:", err);
      const message =
        (err as any)?.response?.data?.error ||
        (err as Error)?.message ||
        "No se pudo borrar el activo.";
      setDeleteError(message);
    } finally {
      setDeletingAsset(false);
    }
  }, [selectedAssetId, deletingAsset]);

  const handleSaveNewAsset = useCallback(async () => {
    if (!newAssetDraft || savingNewAsset) return;

    try {
      setSavingNewAsset(true);
      setNewAssetError(null);

      const payload: Record<string, unknown> = {
        symbol: newAssetDraft.symbol,
        type: newAssetDraft.type,
        initialInvestment: null,
        currentBalance: totalBalance,
      };

      if (newAssetDraft.type === "crypto") {
        payload.exchange = newAssetDraft.exchange;
      } else {
        const exchangeName = newAssetDraft.exchange?.trim();
        if (!exchangeName) {
          throw new Error("No se identificó el exchange para el activo seleccionado.");
        }
        payload.exchange = exchangeName;
      }

      await api.post<{ asset?: AssetDoc }>("/assets", payload);

      const assetsRes = await api.get<AssetDoc[]>("/assets");
      const assetsData = Array.isArray(assetsRes.data) ? assetsRes.data : [];
      setAssets(assetsData);

      setLastCreatedAssetTotal(totalBalance);

      setFeedback(`Activo ${newAssetDraft.symbol} guardado correctamente.`);
      setNewAssetDraft(null);
      setShowAddAssetOptions(false);
    } catch (err) {
      console.error("❌ Error guardando nuevo activo:", err);
      const message =
        (err as any)?.response?.data?.error ||
        (err as Error)?.message ||
        "No se pudo guardar el activo.";
      setNewAssetError(message);
    } finally {
      setSavingNewAsset(false);
    }
  }, [newAssetDraft, savingNewAsset, totalBalance]);

  useEffect(() => {
    if (!showStockSelector) {
      return;
    }

    const term = stockSearch.trim();
    if (term.length < 2) {
      setStockResults([]);
      setStockError(null);
      setStockLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const fetchStocks = async () => {
      try {
        setStockLoading(true);
        setStockError(null);
        const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
          term
        )}&quotesCount=20&newsCount=0`; 
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Estado ${response.status}`);
        }
        const data = await response.json();
        const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
        const suggestions: StockSuggestion[] = quotes
          .filter((item: any) => {
            const type = String(item?.quoteType || item?.typeDisp || "").toUpperCase();
            return type.includes("EQUITY") || type.includes("ETF");
          })
          .map((item: any) => ({
            symbol: String(item?.symbol ?? ""),
            name: String(item?.shortname || item?.longname || item?.symbol || ""),
            exchange: item?.exchDisp || item?.exchange,
            type: item?.typeDisp || item?.quoteType,
          }))
          .filter(item => item.symbol);

        if (!cancelled) {
          setStockResults(suggestions);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("❌ Error buscando símbolos en Yahoo:", error);
        if (!cancelled) {
          setStockError("No se pudieron cargar los símbolos.");
        }
      } finally {
        if (!cancelled) {
          setStockLoading(false);
        }
      }
    };

    const timeout = setTimeout(fetchStocks, 350);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [stockSearch, showStockSelector]);

  return (
    <>
      <Modal
        visible={showCryptoSelector}
        animationType="slide"
        transparent
        onRequestClose={handleCloseCryptoSelector}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Selecciona un par con USDT</Text>
            <TextInput
              style={styles.modalSearch}
              value={cryptoSearch}
              onChangeText={text => setCryptoSearch(text)}
              placeholder="Buscar par (ej. BTCUSDT)"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {cryptoError && <Text style={styles.errorText}>{cryptoError}</Text>}
            {cryptoLoading ? (
              <ActivityIndicator style={styles.modalLoader} />
            ) : (
              <FlatList
                data={filteredCryptoSymbols}
                keyExtractor={item => item}
                style={styles.modalList}
                contentContainerStyle={
                  filteredCryptoSymbols.length ? undefined : styles.modalEmptyContainer
                }
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalItem}
                    onPress={() => handleSelectCryptoPair(item)}
                  >
                    <Text style={styles.modalItemSymbol}>{item}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={!cryptoError ? (
                  <Text style={styles.emptyText}>No se encontraron resultados.</Text>
                ) : null}
              />
            )}
            <View style={styles.modalActions}>
              <Button title="Cerrar" onPress={handleCloseCryptoSelector} color="#546e7a" />
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showStockSelector}
        animationType="slide"
        transparent
        onRequestClose={handleCloseStockSelector}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Buscar acción o ETF</Text>
            <TextInput
              style={styles.modalSearch}
              value={stockSearch}
              onChangeText={text => setStockSearch(text)}
              placeholder="Ingresa símbolo o nombre"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {stockSearch.trim().length < 2 && !stockLoading && !stockError ? (
              <Text style={styles.modalHelper}>Escribe al menos 2 caracteres para buscar.</Text>
            ) : null}
            {stockError && <Text style={styles.errorText}>{stockError}</Text>}
            {stockLoading ? (
              <ActivityIndicator style={styles.modalLoader} />
            ) : (
              <FlatList
                data={stockResults}
                keyExtractor={item => `${item.symbol}-${item.exchange ?? ""}`}
                style={styles.modalList}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={
                  stockResults.length
                    ? undefined
                    : stockSearch.trim().length >= 2
                    ? styles.modalEmptyContainer
                    : undefined
                }
                ListEmptyComponent={
                  stockSearch.trim().length >= 2 && !stockError ? (
                    <Text style={styles.emptyText}>No se encontraron resultados.</Text>
                  ) : null
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalItem}
                    onPress={() => handleSelectStockSuggestion(item)}
                  >
                    <Text style={styles.modalItemSymbol}>{item.symbol}</Text>
                    <Text style={styles.modalItemName}>{item.name}</Text>
                    {item.exchange ? (
                      <Text style={styles.modalItemMeta}>
                        {(item.exchange ?? "").toString()} · {(item.type ?? "").toString()}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                )}
              />
            )}
            <View style={styles.modalActions}>
              <Button title="Cerrar" onPress={handleCloseStockSelector} color="#546e7a" />
            </View>
          </View>
        </View>
      </Modal>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            loading ? styles.centerContent : null,
          ]}
          keyboardShouldPersistTaps="handled"
        >
        {loading ? (
          <ActivityIndicator size="large" />
        ) : (
          <>
            <View style={styles.section}>
              <View style={styles.primaryActionsRow}>
                <View style={styles.primaryActionButton}>
                  <TouchableOpacity
                    style={[
                      styles.primaryActionTouchable,
                      canAccessAddAsset
                        ? styles.primaryActionEnabled
                        : styles.primaryActionDisabled,
                    ]}
                    activeOpacity={0.85}
                    onPress={() => {
                      if (!canAccessAddAsset) {
                        setFeedback(
                          `Necesitas un balance mayor a ${requiredBalance.toFixed(2)} USD para añadir un activo. Balance actual: ${totalBalance.toFixed(2)} USD`
                        );
                        return;
                      }
                      toggleAddAssetOptions();
                    }}
                  >
                    <Text
                      style={[
                        styles.primaryActionText,
                        !canAccessAddAsset && styles.primaryActionTextDisabled,
                      ]}
                    >
                      Añadir nuevo activo
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.primaryActionButton}>
                  <TouchableOpacity
                    style={[
                      styles.primaryActionTouchable,
                      styles.primaryActionDanger,
                      showDeleteList && styles.primaryActionDangerActive,
                    ]}
                    activeOpacity={0.85}
                    onPress={toggleDeleteList}
                  >
                    <Text style={styles.primaryActionDangerText}>
                      {showDeleteList ? "Ocultar lista" : "Borrar activo"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              {showAddAssetOptions && (
                <View style={styles.addAssetOptions}>
                  <Button title="Crypto" onPress={handleSelectCrypto} />
                  <Button title="Stock" onPress={handleSelectStock} />
                </View>
              )}
              {showDeleteList && (
                <View style={styles.deleteListContainer}>
                  <Text style={styles.deleteListTitle}>Activos disponibles para borrar</Text>
                  {deletableAssets.length ? (
                    deletableAssets.map(asset => {
                      const isSelected = selectedAssetId === asset._id;
                      return (
                        <TouchableOpacity
                          key={asset._id}
                          style={[styles.deleteListItem, isSelected && styles.deleteListItemSelected]}
                          onPress={() => {
                            setSelectedAssetId(isSelected ? null : asset._id);
                            setDeleteError(null);
                          }}
                        >
                          <Text style={styles.deleteListSymbol}>{asset.symbol}</Text>
                          <Text style={styles.deleteListType}>{asset.type ?? ""}</Text>
                        </TouchableOpacity>
                      );
                    })
                  ) : (
                    <Text style={styles.deleteEmptyText}>No hay activos disponibles.</Text>
                  )}
                  {selectedAssetId && (
                    <View style={styles.deleteActions}>
                      {deleteError && <Text style={styles.errorText}>{deleteError}</Text>}
                      <Button
                        title={deletingAsset ? "Borrando..." : "Confirmar borrado"}
                        color="#c62828"
                        onPress={handleDeleteAsset}
                        disabled={deletingAsset}
                      />
                    </View>
                  )}
                </View>
              )}
            </View>

            {newAssetDraft && (
              <View style={styles.newAssetContainer}>
                <Text style={styles.newAssetLabel}>
                  Nuevo {newAssetDraft.type === "crypto" ? "par" : "activo"} seleccionado:
                  {" "}
                  <Text style={styles.newAssetSymbol}>{newAssetDraft.symbol}</Text>
                  {newAssetDraft.type === "stock" && newAssetDraft.name
                    ? ` · ${newAssetDraft.name}`
                    : ""}
                </Text>
                {newAssetError && <Text style={styles.errorText}>{newAssetError}</Text>}
                <Button
                  title={savingNewAsset ? "Guardando..." : "Guardar"}
                  onPress={handleSaveNewAsset}
                  disabled={savingNewAsset}
                />
              </View>
            )}

            <View style={styles.section}>
              <View style={styles.card}>
                <Text style={styles.label}>Total USD</Text>
                <TextInput
                  style={styles.input}
                  value={usdInput}
                  onChangeText={setUsdInput}
                keyboardType="numeric"
                placeholder="Ingrese total en USD"
                onFocus={() => handleFocusValue(usdConfig?.total, usdInput, setUsdInput)}
              />
              {canSaveUsd && (
                <Button
                  title={savingUsd ? "Guardando..." : "Guardar"}
                  onPress={() =>
                    saveValue(
                      usdConfig,
                      parsedUsd,
                      updated => setUsdConfig(updated),
                      setUsdInput,
                      setSavingUsd,
                      "Total USD guardado correctamente.",
                      "No se pudo guardar Total USD."
                    )
                  }
                  disabled={savingUsd}
                />
              )}
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.card}>
                <Text style={styles.label}>Total PEN</Text>
                <TextInput
                  style={styles.input}
                  value={penInput}
                  onChangeText={setPenInput}
                keyboardType="numeric"
                placeholder="Ingrese total en PEN"
                onFocus={() => handleFocusValue(penConfig?.total, penInput, setPenInput)}
              />
              {canSavePen && (
                <Button
                  title={savingPen ? "Guardando..." : "Guardar"}
                  onPress={() =>
                    saveValue(
                      penConfig,
                      parsedPen,
                      updated => setPenConfig(updated),
                      setPenInput,
                      setSavingPen,
                      "Total PEN guardado correctamente.",
                      "No se pudo guardar Total PEN."
                    )
                  }
                  disabled={savingPen}
                />
              )}
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.card, styles.halfCard]}>
                <Text style={styles.label}>Precio compra USDT</Text>
                <TextInput
                  style={styles.input}
                  value={usdtBuyInput}
                  onChangeText={setUsdtBuyInput}
                  keyboardType="numeric"
                  placeholder="Ingrese precio de compra"
                  onFocus={() =>
                    handleFocusValue(usdtBuyConfig?.total, usdtBuyInput, setUsdtBuyInput)
                  }
                />
              </View>

              <View style={[styles.card, styles.halfCard]}>
                <Text style={styles.label}>Precio venta USDT</Text>
                <TextInput
                  style={styles.input}
                  value={usdtSellInput}
                  onChangeText={setUsdtSellInput}
                  keyboardType="numeric"
                  placeholder="Ingrese precio de venta"
                  onFocus={() =>
                    handleFocusValue(usdtSellConfig?.total, usdtSellInput, setUsdtSellInput)
                  }
                />
              </View>
            </View>

            <View style={styles.section}>
              {canSaveUsdt && (
                <Button
                  title={savingUsdt ? "Guardando..." : "Guardar precios USDT"}
                  onPress={saveUsdtPrices}
                  disabled={savingUsdt}
                />
              )}
            </View>

            {stockAssets.length > 0 && (
              <View style={styles.section}>
                {stockAssets.map(asset => {
                  const inputValue = stockInputs[asset._id] ?? "";
                  const saving = stockSavingMap[asset._id] ?? false;
                  const errorMessage = stockErrorMap[asset._id] ?? null;
                  const initialAmount = getInitialInvestmentAmount(asset.initialInvestment);
                  const formattedInitial = formatNumber(initialAmount ?? null);

                  return (
                    <View key={asset._id} style={styles.card}>
                      <Text style={styles.label}>Total {asset.symbol ?? "activo"}</Text>
                      <TextInput
                        style={styles.input}
                        value={inputValue}
                        onChangeText={value => handleStockInputChange(asset._id, value)}
                        keyboardType="numeric"
                        placeholder={`Ingrese total en ${asset.symbol ?? "activo"}`}
                        onFocus={() => {
                          if (inputValue === formattedInitial) {
                            handleStockInputChange(asset._id, "");
                          }
                        }}
                      />
                      {errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
                      <Button
                        title={saving ? "Guardando..." : "Guardar"}
                        onPress={() => handleSaveStockValue(asset)}
                        disabled={saving}
                      />
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

          {feedback && <Text style={styles.feedback}>{feedback}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  centerContent: {
    justifyContent: "center",
  },
  section: {
    width: "90%",
    marginBottom: 16,
  },
  row: {
    width: "90%",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 16,
  },
  card: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    padding: 16,
    backgroundColor: "#fafafa",
    alignItems: "center",
    gap: 12,
  },
  halfCard: {
    flex: 1,
  },
  label: {
    fontSize: 18,
    fontWeight: "600",
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 18,
    backgroundColor: "#fff",
  },
  feedback: {
    marginTop: 12,
    fontSize: 16,
    color: "#2e7d32",
  },
  addAssetOptions: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-evenly",
    gap: 16,
  },
  primaryActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  primaryActionButton: {
    flex: 1,
  },
  primaryActionTouchable: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryActionEnabled: {
    backgroundColor: "#1e88e5",
  },
  primaryActionDisabled: {
    backgroundColor: "#9e9e9e",
  },
  primaryActionText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  primaryActionTextDisabled: {
    color: "#f5f5f5",
  },
  primaryActionDanger: {
    backgroundColor: "#c62828",
  },
  primaryActionDangerActive: {
    backgroundColor: "#b71c1c",
  },
  primaryActionDangerText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  newAssetContainer: {
    width: "90%",
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dce3eb",
    backgroundColor: "#f5f9ff",
    padding: 16,
    gap: 12,
    alignItems: "center",
  },
  newAssetLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2933",
  },
  newAssetSymbol: {
    fontWeight: "700",
    color: "#0d47a1",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    width: "100%",
    maxHeight: "80%",
    borderRadius: 16,
    backgroundColor: "#ffffff",
    padding: 20,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#263238",
  },
  modalSearch: {
    borderWidth: 1,
    borderColor: "#b0bec5",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: "#fafafa",
  },
  modalLoader: {
    marginTop: 8,
  },
  modalList: {
    flexGrow: 0,
    maxHeight: 320,
  },
  modalEmptyContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 24,
  },
  modalItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#d0d8e5",
    marginBottom: 10,
  },
  modalHelper: {
    fontSize: 14,
    color: "#607d8b",
  },
  modalItemSymbol: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1f2933",
  },
  modalItemName: {
    fontSize: 14,
    color: "#425466",
    marginTop: 2,
  },
  modalItemMeta: {
    fontSize: 12,
    color: "#78909c",
    marginTop: 2,
  },
  modalActions: {
    marginTop: 4,
    alignItems: "flex-end",
  },
  deleteListContainer: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e0e7ef",
    backgroundColor: "#f9fbff",
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
  },
  deleteListTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1f2933",
  },
  deleteListItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: "#dbe4f3",
    borderRadius: 8,
  },
  deleteListItemSelected: {
    backgroundColor: "#ffe9e9",
  },
  deleteListSymbol: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0d47a1",
  },
  deleteListType: {
    fontSize: 14,
    color: "#607d8b",
    textTransform: "uppercase",
  },
  deleteActions: {
    marginTop: 12,
    gap: 8,
  },
  deleteEmptyText: {
    fontSize: 14,
    color: "#607d8b",
    fontStyle: "italic",
  },
  errorText: {
    color: "#c62828",
    fontSize: 14,
  },
});

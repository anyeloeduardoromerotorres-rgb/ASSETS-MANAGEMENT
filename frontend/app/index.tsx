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
import { calculateTotalBalances } from "../utils/calculateTotalBalances";
import TrendRunnerTemporaryBalances from "../components/TrendRunnerTemporaryBalances";

interface ConfigDoc {
  _id: string;
  name: string;
  total: number;
}

// Documento minimo que esta pantalla necesita de cada asset.
interface AssetDoc {
  _id: string;
  symbol?: string;
  initialInvestment?: number | Record<string, unknown> | null;
  allocationPercentage?: number;
  totalCapitalWhenLastAdded?: number;
  type?: string;
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

type WalletPercentageRow = {
  key: string;
  assetId: string | null;
  symbol: string;
  type: string;
  isNew: boolean;
};

type BinanceBalanceEntry = {
  asset: string;
  total: number;
  usdValue: number;
};

// Helpers pequenos para normalizar datos antes de usarlos en estado o calculos.
const findConfigByNames = (docs: ConfigDoc[], names: string[]) =>
  docs.find(doc => names.some(name => doc?.name === name)) ?? null;

const formatNumber = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) ? value.toString() : "";

const parseInput = (value: string) => {
  const parsed = parseFloat(value.replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : NaN;
};

const roundToEight = (value: number) => Number(value.toFixed(8));
const CASH_LIKE_ASSETS = new Set(["SHV"]);

const isCashLikeAsset = (asset: Pick<AssetDoc, "symbol">) =>
  CASH_LIKE_ASSETS.has(String(asset.symbol ?? "").toUpperCase());

const isCashLikeDraft = (asset: Pick<NewAssetDraft, "symbol">) =>
  CASH_LIKE_ASSETS.has(String(asset.symbol ?? "").toUpperCase());

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
  // Estado general de pantalla: carga inicial y mensajes visibles para el usuario.
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Documentos de configuracion persistidos en el backend.
  const [usdConfig, setUsdConfig] = useState<ConfigDoc | null>(null);
  const [usdtSellConfig, setUsdtSellConfig] = useState<ConfigDoc | null>(null);
  const [etoroConfig, setEtoroConfig] = useState<ConfigDoc | null>(null);
  const [totalUsdConfig, setTotalUsdConfig] = useState<ConfigDoc | null>(null);
  const [shvConfig, setShvConfig] = useState<ConfigDoc | null>(null);
  const [assets, setAssets] = useState<AssetDoc[]>([]);
  const [lastCreatedAssetTotal, setLastCreatedAssetTotal] = useState<number | null>(null);

  // Estado del flujo para borrar activos.
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [deletingAsset, setDeletingAsset] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Datos externos usados para calcular el balance total disponible.
  const [binanceBalances, setBinanceBalances] = useState<BinanceBalanceEntry[]>([]);
  const [binanceTotals, setBinanceTotals] = useState<{ usd: number; pen: number } | null>(null);
  const [vooMarketPrice, setVooMarketPrice] = useState<number | null>(null);

  // Inputs controlados para editar configuraciones numericas.
  const [usdInput, setUsdInput] = useState("");
  const [etoroUsdInput, setEtoroUsdInput] = useState("");
  const [shvInput, setShvInput] = useState("");

  // Estado del flujo para agregar un nuevo asset crypto o stock.
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
  const [walletPercentageInputs, setWalletPercentageInputs] = useState<Record<string, string>>({});
  const [savingNewAsset, setSavingNewAsset] = useState(false);
  const [newAssetError, setNewAssetError] = useState<string | null>(null);
  const [showDeleteList, setShowDeleteList] = useState(false);

  // Estado por asset para editar los montos de acciones/ETFs.
  const [stockInputs, setStockInputs] = useState<Record<string, string>>({});
  const [stockSavingMap, setStockSavingMap] = useState<Record<string, boolean>>({});
  const [stockErrorMap, setStockErrorMap] = useState<Record<string, string | null>>({});
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});

  // Banderas de guardado independientes para evitar dobles submits.
  const [savingUsd, setSavingUsd] = useState(false);
  const [savingEtoro, setSavingEtoro] = useState(false);
  const [savingShv, setSavingShv] = useState(false);

  // Carga inicial: configuraciones financieras y lista de assets registrados.
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

        // Buscar docs específicos para BCP, Etoro y Total USD (sumatoria)
        const usdDoc = configData.find(doc => doc?.name === "totalUSDBCP") ?? null;
        const etoroDoc = configData.find(doc => doc?.name === "totalUSDEtoro") ?? null;
        const totalUsdDoc = configData.find(doc => doc?.name === "totalUSD") ?? null;
        let shvDoc = configData.find(doc => doc?.name === "totalSHV") ?? null;
        const sellDoc = findConfigByNames(configData, ["PrecioVentaUSDT", "lastPriceUsdtSell"]);
        const lastCreatedDoc = configData.find(doc => doc?.name === "TotalUltimoActivoCreado") ?? null;

        if (usdDoc) {
          setUsdConfig(usdDoc);
          setUsdInput(formatNumber(usdDoc.total));
        }
        if (etoroDoc) {
          setEtoroConfig(etoroDoc);
          setEtoroUsdInput(formatNumber(etoroDoc.total));
        } else {
          setEtoroUsdInput("");
        }
        if (totalUsdDoc) {
          setTotalUsdConfig(totalUsdDoc);
        } else {
          setTotalUsdConfig(null);
        }
        if (!shvDoc) {
          const createdShv = await api.post<ConfigDoc>("/config-info", {
            name: "totalSHV",
            description: "Total invertido en SHV",
            total: 0,
          });
          shvDoc = createdShv.data;
        }
        if (shvDoc) {
          setShvConfig(shvDoc);
          setShvInput(formatNumber(shvDoc.total));
        }
        if (sellDoc) {
          setUsdtSellConfig(sellDoc);
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

  // Carga los balances de Binance para alimentar el calculo de patrimonio total.
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

  // VOO se consulta aparte porque tambien puede existir como stock registrado.
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

  // Valores numericos derivados desde inputs de texto.
  const parsedUsd = useMemo(() => parseInput(usdInput), [usdInput]);
  const parsedEtoroUsd = useMemo(() => parseInput(etoroUsdInput), [etoroUsdInput]);
  const parsedShv = useMemo(() => parseInput(shvInput), [shvInput]);
  const canSaveUsd =
    !!usdConfig && !savingUsd && !Number.isNaN(parsedUsd) && parsedUsd !== usdConfig.total;
  const canSaveEtoro =
    !!etoroConfig && !savingEtoro && !Number.isNaN(parsedEtoroUsd) && parsedEtoroUsd !== etoroConfig.total;
  const canSaveShv =
    !!shvConfig && !savingShv && !Number.isNaN(parsedShv) && parsedShv !== shvConfig.total;

  // Filtro local de pares Binance ya descargados.
  const filteredCryptoSymbols = useMemo(() => {
    const query = cryptoSearch.trim().toUpperCase();
    if (!query) return cryptoSymbols;
    return cryptoSymbols.filter(symbol => symbol.includes(query));
  }, [cryptoSymbols, cryptoSearch]);

  // Subconjunto de assets que representan acciones o ETFs.
  const stockAssets = useMemo(
    () =>
      assets.filter(
        asset => (asset.type ?? "").toLowerCase() === "stock" && !isCashLikeAsset(asset)
      ),
    [assets]
  );

  const sortedStockAssets = useMemo(() => {
    return [...stockAssets].sort((a, b) => {
      const aSymbol = a.symbol?.toUpperCase() ?? "";
      const bSymbol = b.symbol?.toUpperCase() ?? "";
      if (aSymbol === "SHV" && bSymbol !== "SHV") return -1;
      if (bSymbol === "SHV" && aSymbol !== "SHV") return 1;
      return aSymbol.localeCompare(bSymbol);
    });
  }, [stockAssets]);

  const nonFiatAssets = useMemo(
    () =>
      assets.filter(
        asset => (asset.type ?? "").toLowerCase() !== "fiat" && !isCashLikeAsset(asset)
      ),
    [assets]
  );

  // Solo se permite borrar activos de inversion, no fiat ni cash-like.
  const deletableAssets = useMemo<DeletableAsset[]>(() => {
    return assets
      .filter(asset => (asset.type ?? "").toLowerCase() !== "fiat" && !isCashLikeAsset(asset))
      .map(asset => ({
        _id: asset._id,
        symbol: asset.symbol,
        type: asset.type,
      }));
  }, [assets]);

  // Si se borra o refresca el asset seleccionado, evita mantener una seleccion invalida.
  useEffect(() => {
    if (selectedAssetId && !assets.some(asset => asset._id === selectedAssetId)) {
      setSelectedAssetId(null);
    }
  }, [assets, selectedAssetId]);

  // Sincroniza inputs de stocks cada vez que cambia la lista de acciones registradas.
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

  // Consulta el precio actual de un stock/ETF en Yahoo Finance.
  const fetchStockPrice = useCallback(async (symbol: string) => {
    const normalized = symbol?.toUpperCase?.();
    if (!normalized || normalized === "VOO") return;
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(normalized)}?interval=1d&range=1d`
      );
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof price === "number" && price > 0) {
        setStockPrices(prev => {
          if (prev[normalized] === price) return prev;
          return { ...prev, [normalized]: price };
        });
      }
    } catch (err) {
      console.error(`❌ Error obteniendo precio de ${normalized}:`, err);
    }
  }, []);

  // Refresca precios de acciones registradas, excepto VOO que tiene su propio flujo.
  useEffect(() => {
    const symbols = Array.from(
      new Set(
        [
          ...stockAssets.map(asset => asset.symbol?.toUpperCase()),
          "SHV",
        ]
          .filter((symbol): symbol is string => Boolean(symbol))
      )
    );
    symbols.forEach(sym => {
      if (sym === "VOO") return;
      fetchStockPrice(sym);
    });
  }, [stockAssets, fetchStockPrice]);

  // Convierte montos de acciones a valor USD usando precios de mercado cuando existen.
  const stockBalances = useMemo(() => {
    return stockAssets.map(asset => {
      const symbol = asset.symbol?.toUpperCase() ?? "";
      const amount = getInitialInvestmentAmount(asset.initialInvestment) ?? 0;
      const isVoo = symbol === "VOO";
      const knownPrice = !isVoo ? stockPrices[symbol] : undefined;
      const usdValue =
        isVoo && typeof vooMarketPrice === "number" && vooMarketPrice > 0
          ? amount * vooMarketPrice
          : typeof knownPrice === "number" && Number.isFinite(knownPrice) && knownPrice > 0
          ? amount * knownPrice
          : amount;
      return {
        id: asset._id,
        asset: symbol,
        total: amount,
        usdValue,
      };
    });
  }, [stockAssets, vooMarketPrice, stockPrices]);

  // Precio de venta USDT usado como conversion conservadora para saldos USDT.
  const usdtSellPrice = useMemo(() => {
    const raw = Number(usdtSellConfig?.total);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  }, [usdtSellConfig]);

  // Ajusta el valor USD de USDT y descarta balances sin valor.
  const adjustedBinanceBalances = useMemo(() => {
    return binanceBalances.map(balance => {
      if (balance.asset === "USDT") {
        return {
          ...balance,
          usdValue: balance.total * usdtSellPrice,
        };
      }
      return balance;
    }).filter(b => b.usdValue > 0);
  }, [binanceBalances, usdtSellPrice]);

  const usdTotalFromConfig = totalUsdConfig?.total ?? binanceTotals?.usd ?? 0;

  // Balance consolidado: Binance + fiat + acciones registradas.
  const { totalUsd: totalBalance } = useMemo(
    () =>
      calculateTotalBalances({
        balances: adjustedBinanceBalances,
        totals: { usd: usdTotalFromConfig, pen: 0 },
        usdtSellPrice,
        additionalBalances: [
          ...stockBalances,
          {
            id: shvConfig?._id ?? "totalSHV",
            asset: "SHV",
            total: parsedShv,
            usdValue:
              Number.isNaN(parsedShv) || !Number.isFinite(stockPrices.SHV)
                ? 0
                : parsedShv * stockPrices.SHV,
          },
        ],
      }),
    [
      adjustedBinanceBalances,
      stockBalances,
      shvConfig?._id,
      parsedShv,
      stockPrices.SHV,
      usdTotalFromConfig,
      usdtSellPrice,
    ]
  );

  const nonFiatAssetsCount = useMemo(() => deletableAssets.length, [deletableAssets]);

  // Regla de negocio para permitir agregar otro activo.
  const requiredBalance = useMemo(() => {
    const base = lastCreatedAssetTotal ?? 0;
    return base + nonFiatAssetsCount * 200 + 200;
  }, [lastCreatedAssetTotal, nonFiatAssetsCount]);

  const canAccessAddAsset = useMemo(() => totalBalance > requiredBalance, [totalBalance, requiredBalance]);

  const walletPercentageRows = useMemo(() => {
    const rows: WalletPercentageRow[] = nonFiatAssets.map(asset => ({
      key: asset._id,
      assetId: asset._id,
      symbol: asset.symbol ?? "Activo",
      type: asset.type ?? "",
      isNew: false,
    }));

    if (newAssetDraft && !isCashLikeDraft(newAssetDraft)) {
      rows.push({
        key: "__new_asset__",
        assetId: null,
        symbol: newAssetDraft.symbol,
        type: newAssetDraft.type,
        isNew: true,
      });
    }

    return rows;
  }, [nonFiatAssets, newAssetDraft]);

  const walletPercentageTotal = useMemo(() => {
    return walletPercentageRows.reduce((sum, row) => {
      const parsed = parseInput(walletPercentageInputs[row.key] ?? "");
      return sum + (Number.isNaN(parsed) ? 0 : parsed);
    }, 0);
  }, [walletPercentageRows, walletPercentageInputs]);

  const isWalletPercentageTotalValid = Math.abs(walletPercentageTotal - 100) < 0.000001;

  const canSaveNewAsset =
    !!newAssetDraft &&
    !savingNewAsset &&
    isWalletPercentageTotalValid &&
    walletPercentageRows.every(row => {
      const parsed = parseInput(walletPercentageInputs[row.key] ?? "");
      return !Number.isNaN(parsed) && parsed >= 0 && parsed <= 100;
    });

  // Limpia el input al enfocarlo si todavia contiene el valor actual guardado.
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

  // Actualiza un input de stock y limpia el error de ese asset.
  const handleStockInputChange = useCallback((assetId: string, value: string) => {
    setStockInputs(prev => ({ ...prev, [assetId]: value }));
    setStockErrorMap(prev => ({ ...prev, [assetId]: null }));
  }, []);

  const buildWalletPercentageInputs = useCallback(() => {
    const inputs: Record<string, string> = {};
    nonFiatAssets.forEach(asset => {
      inputs[asset._id] = formatNumber(asset.allocationPercentage ?? 0);
    });
    inputs.__new_asset__ = "";
    return inputs;
  }, [nonFiatAssets]);

  const handleWalletPercentageChange = useCallback((key: string, value: string) => {
    setWalletPercentageInputs(prev => ({ ...prev, [key]: value }));
    setNewAssetError(null);
  }, []);

  // Guarda el monto registrado para una accion/ETF en initialInvestment.
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

  // Guarda BCP y actualiza totalUSD = BCP + Etoro
  const saveBcpUsd = async () => {
    if (!usdConfig || Number.isNaN(parsedUsd)) return;
    try {
      setSavingUsd(true);
      // 1) Guardar BCP
      await api.put(`/config-info/${usdConfig._id}`, { total: parsedUsd });
      const updatedBcp = { ...usdConfig, total: parsedUsd };
      setUsdConfig(updatedBcp);
      setUsdInput(formatNumber(parsedUsd));

      // 2) Recalcular totalUSD
      const other = Number.isNaN(parsedEtoroUsd)
        ? (etoroConfig?.total ?? 0)
        : parsedEtoroUsd;
      const sum = parsedUsd + other;
      if (totalUsdConfig?._id) {
        await api.put(`/config-info/${totalUsdConfig._id}`, { total: sum });
        setTotalUsdConfig({ ...totalUsdConfig, total: sum });
      }

      setFeedback("Total USD (BCP) guardado y totalUSD actualizado.");
    } catch (err) {
      console.error("❌ Error guardando Total USD BCP:", err);
      setFeedback("No se pudo guardar Total USD BCP.");
    } finally {
      setSavingUsd(false);
    }
  };

  // Guarda Etoro y actualiza totalUSD = BCP + Etoro
  const saveEtoroUsd = async () => {
    if (!etoroConfig || Number.isNaN(parsedEtoroUsd)) return;
    try {
      setSavingEtoro(true);
      // 1) Guardar Etoro
      await api.put(`/config-info/${etoroConfig._id}`, { total: parsedEtoroUsd });
      const updatedEtoro = { ...etoroConfig, total: parsedEtoroUsd };
      setEtoroConfig(updatedEtoro);
      setEtoroUsdInput(formatNumber(parsedEtoroUsd));

      // 2) Recalcular totalUSD
      const other = Number.isNaN(parsedUsd)
        ? (usdConfig?.total ?? 0)
        : parsedUsd;
      const sum = other + parsedEtoroUsd;
      if (totalUsdConfig?._id) {
        await api.put(`/config-info/${totalUsdConfig._id}`, { total: sum });
        setTotalUsdConfig({ ...totalUsdConfig, total: sum });
      }

      setFeedback("Total USD (Etoro) guardado y totalUSD actualizado.");
    } catch (err) {
      console.error("❌ Error guardando Total USD Etoro:", err);
      setFeedback("No se pudo guardar Total USD Etoro.");
    } finally {
      setSavingEtoro(false);
    }
  };

  const saveShv = async () => {
    if (!shvConfig || Number.isNaN(parsedShv)) return;
    try {
      setSavingShv(true);
      const res = await api.put<ConfigDoc>(`/config-info/${shvConfig._id}`, { total: parsedShv });
      setShvConfig(res.data);
      setShvInput(formatNumber(res.data.total));
      setFeedback("Total SHV guardado correctamente.");
    } catch (err) {
      console.error("Error guardando Total SHV:", err);
      setFeedback("No se pudo guardar Total SHV.");
    } finally {
      setSavingShv(false);
    }
  };

  // Abre/cierra el flujo de alta de activos y resetea estados relacionados.
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
        setWalletPercentageInputs({});
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

  // Abre/cierra el flujo de borrado y lo mantiene separado del alta de activos.
  const toggleDeleteList = useCallback(() => {
    setShowDeleteList(prev => {
      const next = !prev;
      if (next) {
        setShowAddAssetOptions(false);
        setShowCryptoSelector(false);
        setShowStockSelector(false);
        setNewAssetDraft(null);
        setWalletPercentageInputs({});
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

  // Descarga una sola vez los pares USDT disponibles en Binance.
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

  // Muestra el selector de crypto y dispara la carga de pares si falta.
  const handleSelectCrypto = useCallback(() => {
    setShowCryptoSelector(true);
    setShowStockSelector(false);
    setCryptoSearch("");
    setCryptoError(null);
    setNewAssetError(null);
    setSavingNewAsset(false);
    loadCryptoPairs();
  }, [loadCryptoPairs]);

  // Guarda temporalmente el par elegido hasta que el usuario confirme.
  const handleSelectCryptoPair = useCallback(
    (symbol: string) => {
      setNewAssetDraft({ type: "crypto", symbol, exchange: "BINANCE" });
      setWalletPercentageInputs(buildWalletPercentageInputs());
      setFeedback(`Par seleccionado: ${symbol}`);
      setNewAssetError(null);
      setSavingNewAsset(false);
      setShowCryptoSelector(false);
      setShowStockSelector(false);
      setShowAddAssetOptions(false);
      setCryptoSearch("");
    },
    [buildWalletPercentageInputs]
  );

  // Cierra el selector de crypto y limpia busqueda/errores del flujo.
  const handleCloseCryptoSelector = useCallback(() => {
    setShowCryptoSelector(false);
    setShowAddAssetOptions(false);
    setCryptoSearch("");
    setSavingNewAsset(false);
    setNewAssetError(null);
  }, []);

  // Muestra el selector de acciones/ETFs.
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

  // Cierra el selector de acciones y descarta resultados de busqueda.
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

  // Guarda temporalmente la accion/ETF elegida hasta confirmar alta.
  const handleSelectStockSuggestion = useCallback((suggestion: StockSuggestion) => {
    setNewAssetDraft({
      type: "stock",
      symbol: suggestion.symbol,
      exchange: "etoro",
      name: suggestion.name,
    });
    setWalletPercentageInputs(buildWalletPercentageInputs());
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
  }, [buildWalletPercentageInputs]);

  // Borra el asset seleccionado y lo remueve del estado local.
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

  // Crea un asset en backend y refresca la lista completa para traer datos calculados.
  const handleSaveNewAsset = useCallback(async () => {
    if (!newAssetDraft || savingNewAsset) return;

    if (!isWalletPercentageTotalValid) {
      setNewAssetError("La suma de porcentajes debe ser 100.");
      return;
    }

    try {
      setSavingNewAsset(true);
      setNewAssetError(null);

      const draftIsCashLike = isCashLikeDraft(newAssetDraft);
      const newAssetPercentage = draftIsCashLike
        ? 0
        : parseInput(walletPercentageInputs.__new_asset__ ?? "");
      if (
        !draftIsCashLike &&
        (Number.isNaN(newAssetPercentage) || newAssetPercentage < 0 || newAssetPercentage > 100)
      ) {
        throw new Error("Ingresa un porcentaje valido para el nuevo activo.");
      }

      const assetsAllocationPercentages = nonFiatAssets.map(asset => {
        const allocationPercentage = parseInput(walletPercentageInputs[asset._id] ?? "");
        if (Number.isNaN(allocationPercentage) || allocationPercentage < 0 || allocationPercentage > 100) {
          throw new Error(`Ingresa un porcentaje valido para ${asset.symbol ?? "activo"}.`);
        }
        return {
          _id: asset._id,
          allocationPercentage: roundToEight(allocationPercentage),
        };
      });

      const payload: Record<string, unknown> = {
        symbol: newAssetDraft.symbol,
        type: newAssetDraft.type,
        initialInvestment: null,
        totalCapitalWhenLastAdded: totalBalance,
        allocationPercentage: roundToEight(newAssetPercentage),
        assets: assetsAllocationPercentages,
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

      if (!draftIsCashLike) {
        setLastCreatedAssetTotal(totalBalance);
      }

      setFeedback(`Activo ${newAssetDraft.symbol} guardado correctamente.`);
      setNewAssetDraft(null);
      setWalletPercentageInputs({});
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
  }, [
    isWalletPercentageTotalValid,
    newAssetDraft,
    nonFiatAssets,
    savingNewAsset,
    totalBalance,
    walletPercentageInputs,
  ]);

  // Busca acciones/ETFs en Yahoo con debounce y cancelacion de requests anteriores.
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
          .filter((item: StockSuggestion) => item.symbol);

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

  // Render principal: modales de seleccion arriba y formulario dentro del scroll.
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
                <View style={styles.walletAllocationList}>
                  {walletPercentageRows.map(row => {
                    const inputValue = walletPercentageInputs[row.key] ?? "";
                    const parsedPercentage = parseInput(inputValue);
                    const assignedCapital =
                      Number.isNaN(parsedPercentage) || parsedPercentage < 0
                        ? 0
                        : (totalBalance * parsedPercentage) / 100;

                    return (
                      <View key={row.key} style={styles.walletAllocationRow}>
                        <View style={styles.walletAllocationInfo}>
                          <Text style={styles.walletAllocationSymbol}>
                            {row.symbol}
                            {row.isNew ? " (nuevo)" : ""}
                          </Text>
                          <Text style={styles.walletAllocationMeta}>
                            {row.type.toUpperCase()} Â· ${assignedCapital.toFixed(2)}
                          </Text>
                        </View>
                        <TextInput
                          style={styles.walletAllocationInput}
                          value={inputValue}
                          onChangeText={value => handleWalletPercentageChange(row.key, value)}
                          keyboardType="numeric"
                          placeholder="%"
                        />
                      </View>
                    );
                  })}
                </View>
                <Text
                  style={[
                    styles.walletPercentageTotal,
                    isWalletPercentageTotalValid
                      ? styles.walletPercentageTotalValid
                      : styles.walletPercentageTotalInvalid,
                  ]}
                >
                  Suma: {walletPercentageTotal.toFixed(2)}%
                </Text>
                {newAssetError && <Text style={styles.errorText}>{newAssetError}</Text>}
                <TouchableOpacity
                  style={[
                    styles.saveAllocationButton,
                    canSaveNewAsset
                      ? styles.saveAllocationButtonReady
                      : styles.saveAllocationButtonDisabled,
                  ]}
                  activeOpacity={0.85}
                  onPress={handleSaveNewAsset}
                  disabled={!canSaveNewAsset}
                >
                  <Text
                    style={[
                      styles.saveAllocationButtonText,
                      !canSaveNewAsset && styles.saveAllocationButtonTextDisabled,
                    ]}
                  >
                    {savingNewAsset ? "Guardando..." : "Guardar"}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.row}>
              <View style={[styles.card, styles.halfCard]}>
                <Text style={styles.label}>Total USD en BCP</Text>
                <TextInput
                  style={styles.input}
                  value={usdInput}
                  onChangeText={setUsdInput}
                  keyboardType="numeric"
                  placeholder="Ingrese total en USD (BCP)"
                  onFocus={() => handleFocusValue(usdConfig?.total, usdInput, setUsdInput)}
                />
                {canSaveUsd && (
                  <Button
                    title={savingUsd ? "Guardando..." : "Guardar"}
                    onPress={saveBcpUsd}
                    disabled={savingUsd}
                  />
                )}
              </View>

              <View style={[styles.card, styles.halfCard]}>
                <Text style={styles.label}>Total USD en Etoro</Text>
                <TextInput
                  style={styles.input}
                  value={etoroUsdInput}
                  onChangeText={setEtoroUsdInput}
                  keyboardType="numeric"
                  placeholder="Ingrese total en USD (Etoro)"
                />
                {canSaveEtoro && (
                  <Button
                    title={savingEtoro ? "Guardando..." : "Guardar"}
                    onPress={saveEtoroUsd}
                    disabled={savingEtoro}
                  />
                )}
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.card}>
                <Text style={styles.label}>Total SHV</Text>
                <TextInput
                  style={styles.input}
                  value={shvInput}
                  onChangeText={setShvInput}
                  keyboardType="numeric"
                  placeholder="Ingrese total en SHV"
                  onFocus={() => handleFocusValue(shvConfig?.total, shvInput, setShvInput)}
                />
                {canSaveShv && (
                  <Button
                    title={savingShv ? "Guardando..." : "Guardar"}
                    onPress={saveShv}
                    disabled={savingShv}
                  />
                )}
              </View>
            </View>

            {sortedStockAssets.length > 0 && (
              <View style={styles.section}>
                {sortedStockAssets.map(asset => {
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

            <View style={styles.section}>
              <TrendRunnerTemporaryBalances
                includeCrypto={false}
                title="Trend Runner temporal en eToro"
              />
            </View>
          </>
        )}

          {feedback && <Text style={styles.feedback}>{feedback}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

// Estilos locales de la pantalla. No contienen logica de negocio.
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
  helperText: {
    fontSize: 14,
    color: "#607d8b",
    textAlign: "center",
  },
  emptyText: {
    fontSize: 14,
    color: "#607d8b",
    textAlign: "center",
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
  walletAllocationList: {
    width: "100%",
    gap: 8,
  },
  walletAllocationRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderWidth: 1,
    borderColor: "#d0d8e5",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  walletAllocationInfo: {
    flex: 1,
  },
  walletAllocationSymbol: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1f2933",
  },
  walletAllocationMeta: {
    marginTop: 2,
    fontSize: 13,
    color: "#607d8b",
  },
  walletAllocationInput: {
    width: 88,
    borderWidth: 1,
    borderColor: "#b0bec5",
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    textAlign: "right",
    fontSize: 16,
    backgroundColor: "#fff",
  },
  walletPercentageTotal: {
    alignSelf: "flex-end",
    fontSize: 16,
    fontWeight: "700",
  },
  walletPercentageTotalValid: {
    color: "#2e7d32",
  },
  walletPercentageTotalInvalid: {
    color: "#c62828",
  },
  saveAllocationButton: {
    minWidth: 140,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  saveAllocationButtonReady: {
    backgroundColor: "#2e7d32",
  },
  saveAllocationButtonDisabled: {
    backgroundColor: "#b0bec5",
  },
  saveAllocationButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  saveAllocationButtonTextDisabled: {
    color: "#eef3f6",
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


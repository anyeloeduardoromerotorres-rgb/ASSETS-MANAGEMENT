import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import api from "../constants/api";

type TransactionDoc = {
  _id: string;
  type: "long" | "short";
  status: "open" | "closed";
  asset: string | { _id?: string; symbol?: string };
  fiatCurrency: string;
  openDate: string;
  openPrice: number;
  amount: number;
  openValueFiat: number;
  openFee?: number;
  closeDate?: string;
  closePrice?: number;
  closeValueFiat?: number;
  closeFee?: number;
  profitPercent?: number;
  profitTotalFiat?: number;
};

type ConfigDoc = {
  _id: string;
  name: string;
  total: number;
};

const formatFiat = (value: number | undefined, currency: string) => {
  if (value == null || Number.isNaN(value)) return "-";
  const upper = currency?.toUpperCase?.() ?? "USD";
  const decimals = upper === "USDT" ? 8 : upper === "USD" || upper === "PEN" ? 3 : 2;
  return `${upper} ${value.toFixed(decimals)}`;
};

const formatBaseAmount = (value: number | undefined) => {
  if (value == null || Number.isNaN(value)) return "-";
  return value.toFixed(8);
};

const formatPrice = (value: number | undefined) => {
  if (value == null || Number.isNaN(value)) return "-";
  return value.toFixed(6);
};

const convertToUsd = (value: number | undefined, currency: string, penRate: number | null) => {
  if (value == null || Number.isNaN(value)) return 0;
  const upper = currency?.toUpperCase?.() ?? "USD";
  if (upper === "USD" || upper === "USDT") return value;
  if (upper === "PEN") {
    return penRate ? value * penRate : value;
  }
  return value;
};

const formatDate = (value?: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

const getAssetSymbol = (asset: TransactionDoc["asset"]) => {
  if (typeof asset === "string") return asset;
  return asset?.symbol ?? "-";
};

export default function HistoricoScreen() {
  const [transactions, setTransactions] = useState<TransactionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const [assetFilter, setAssetFilter] = useState<string>("all");
  const [assetOptions, setAssetOptions] = useState<string[]>([]);
  const [penUsdRate, setPenUsdRate] = useState<number | null>(null);
  const [usdtUsdPrice, setUsdtUsdPrice] = useState<number | null>(null);
  const [vooPrice, setVooPrice] = useState<number | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const priceSocketRef = useRef<WebSocket | null>(null);

  const loadTransactions = async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      const [txRes, configRes] = await Promise.all([
        api.get<TransactionDoc[]>("/transactions"),
        api.get<ConfigDoc[]>("/config-info"),
      ]);

      const list = Array.isArray(txRes.data) ? txRes.data : [];
      setTransactions(list);
      const symbols = Array.from(
        new Set(
          list
            .map(tx => getAssetSymbol(tx.asset))
            .filter(symbol => symbol && symbol !== "-")
        )
      ).sort();
      setAssetOptions(symbols);

      const configs = Array.isArray(configRes.data) ? configRes.data : [];
      const usdtPriceDoc = configs.find(doc =>
        ["PrecioVentaUSDT", "lastPriceUsdtSell", "PrecioCompraUSDT", "lastPriceUsdtBuy"].includes(
          doc.name
        )
      );
      setUsdtUsdPrice(usdtPriceDoc?.total ?? null);
    } catch (err) {
      console.error("❌ Error cargando transacciones:", err);
      setError("No se pudieron cargar las transacciones.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadTransactions();
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
    const hasVooOpen = transactions.some(
      tx => tx.status === "open" && getAssetSymbol(tx.asset)?.toUpperCase?.() === "VOO"
    );
    if (!hasVooOpen) return;

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
          setVooPrice(price);
        }
      } catch (err) {
        console.error("❌ Error obteniendo precio de VOO:", err);
      }
    };

    fetchVoo();

    return () => {
      cancelled = true;
    };
  }, [transactions]);

  useEffect(() => {
    const openSymbols = Array.from(
      new Set(
        transactions
          .filter(tx => tx.status === "open")
          .map(tx => getAssetSymbol(tx.asset)?.toUpperCase?.() ?? "")
          .filter(symbol =>
            symbol &&
            symbol !== "USDTUSD" &&
            symbol !== "USDPEN" &&
            symbol !== "VOO" &&
            (symbol.endsWith("USDT") || symbol.endsWith("USD"))
          )
      )
    );

    if (priceSocketRef.current) {
      priceSocketRef.current.close();
      priceSocketRef.current = null;
    }

    if (!openSymbols.length) {
      setLivePrices({});
      return;
    }

    const fetchInitialPrices = async () => {
      try {
        const entries = await Promise.all(
          openSymbols.map(async symbol => {
            try {
              const res = await fetch(
                `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
              );
              if (!res.ok) return null;
              const data = await res.json();
              const price = parseFloat(data?.price);
              if (!Number.isFinite(price)) return null;
              return { symbol, price };
            } catch {
              return null;
            }
          })
        );
        const snapshot: Record<string, number> = {};
        entries.forEach(entry => {
          if (entry) snapshot[entry.symbol] = entry.price;
        });
        if (Object.keys(snapshot).length) {
          setLivePrices(prev => ({ ...snapshot, ...prev }));
        }
      } catch (err) {
        console.error("❌ Error obteniendo precios iniciales:", err);
      }
    };

    fetchInitialPrices();

    const streams = openSymbols
      .map(symbol => `${symbol.toLowerCase()}@miniTicker`)
      .join("/");
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    priceSocketRef.current = ws;

    ws.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        const data = payload?.data ?? payload;
        const symbol = data?.s;
        const close = parseFloat(data?.c);
        if (!symbol || !Number.isFinite(close)) return;
        setLivePrices(prev => ({ ...prev, [symbol]: close }));
      } catch (err) {
        console.error("❌ Error procesando miniTicker:", err);
      }
    };
    ws.onerror = err => {
      console.error("❌ Error en WebSocket de precios:", err);
    };
    ws.onclose = () => {
      if (priceSocketRef.current === ws) {
        priceSocketRef.current = null;
      }
    };

    return () => {
      if (priceSocketRef.current === ws) {
        priceSocketRef.current = null;
      }
      ws.close();
    };
  }, [transactions]);

  useEffect(() => () => {
    if (priceSocketRef.current) {
      priceSocketRef.current.close();
      priceSocketRef.current = null;
    }
  }, []);

  const getCurrentPrice = (tx: TransactionDoc) => {
    const symbolUpper = getAssetSymbol(tx.asset)?.toUpperCase?.() ?? "";
    if (symbolUpper === "USDTUSD") {
      return usdtUsdPrice;
    }
    if (symbolUpper === "USDPEN") {
      return penUsdRate ? Number((1 / penUsdRate).toFixed(6)) : null;
    }
    if (symbolUpper === "VOO") {
      return vooPrice;
    }
    return livePrices[symbolUpper] ?? null;
  };

  const getPotentialInfo = (tx: TransactionDoc) => {
    const currentPrice = getCurrentPrice(tx);
    if (!Number.isFinite(currentPrice)) return null;

    const price = currentPrice as number;
    const currentValue = price * tx.amount;
    const openCost = tx.openValueFiat + (tx.openFee ?? 0);
    const openValueNet = tx.openValueFiat - (tx.openFee ?? 0);

    const profitFiat = tx.type === "long"
      ? currentValue - openCost
      : openValueNet - currentValue;

    const profitUsd = convertToUsd(profitFiat, tx.fiatCurrency, penUsdRate);

    return {
      price,
      currentValue,
      profitFiat,
      profitUsd,
    };
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const matchesStatus = statusFilter === "all" || tx.status === statusFilter;
      const symbol = getAssetSymbol(tx.asset);
      const matchesAsset = assetFilter === "all" || symbol === assetFilter;
      return matchesStatus && matchesAsset;
    });
  }, [transactions, statusFilter, assetFilter]);

  const totals = useMemo(() => {
    let closedUsd = 0;
    let openUsd = 0;
    filteredTransactions.forEach(tx => {
      if (tx.status === "closed") {
        closedUsd += convertToUsd(tx.profitTotalFiat ?? 0, tx.fiatCurrency, penUsdRate);
      } else {
        const info = getPotentialInfo(tx);
        if (info) {
          openUsd += info.profitUsd;
        }
      }
    });
    return { closedUsd, openUsd, total: closedUsd + openUsd };
  }, [filteredTransactions, penUsdRate, livePrices, usdtUsdPrice, vooPrice]);

  const renderItem = ({ item }: { item: TransactionDoc }) => {
    const symbol = getAssetSymbol(item.asset);
    const statusLabel = item.status === "closed" ? "Cerrada" : "Abierta";
    const potentialInfo = item.status === "open" ? getPotentialInfo(item) : null;
    const currentPriceLabel = potentialInfo ? formatPrice(potentialInfo.price) : "-";
    const potentialFiatLabel = potentialInfo
      ? formatFiat(potentialInfo.currentValue, item.fiatCurrency)
      : "-";
    const potentialProfitLabel = potentialInfo
      ? `USD ${potentialInfo.profitUsd.toFixed(2)}`
      : "-";

    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.symbol}>{symbol}</Text>
          <Text style={[styles.status, item.status === "closed" ? styles.closed : styles.open]}>
            {statusLabel}
          </Text>
        </View>
        <Text style={styles.subtitle}>{item.type === "long" ? "Long" : "Short"}</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Apertura:</Text>
          <Text style={styles.value}>{formatDate(item.openDate)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Precio apertura:</Text>
          <Text style={styles.value}>{formatPrice(item.openPrice)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Cantidad base:</Text>
          <Text style={styles.value}>{formatBaseAmount(item.amount)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Valor apertura:</Text>
          <Text style={styles.value}>{formatFiat(item.openValueFiat, item.fiatCurrency)}</Text>
        </View>
        {item.status === "closed" ? (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>Cierre:</Text>
              <Text style={styles.value}>{formatDate(item.closeDate)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Valor cierre:</Text>
              <Text style={styles.value}>{formatFiat(item.closeValueFiat, item.fiatCurrency)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Ganancia neta:</Text>
              <Text style={[styles.value, (item.profitTotalFiat ?? 0) >= 0 ? styles.profit : styles.loss]}>
                {formatFiat(item.profitTotalFiat ?? 0, item.fiatCurrency)}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>%:</Text>
              <Text style={[styles.value, (item.profitPercent ?? 0) >= 0 ? styles.profit : styles.loss]}>
                {(item.profitPercent ?? 0).toFixed(2)}%
              </Text>
            </View>
          </>
        ) : (
          <>
            <View style={styles.row}>
              <Text style={styles.label}>Precio actual:</Text>
              <Text style={styles.value}>{currentPriceLabel}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Valor hipotético:</Text>
              <Text style={styles.value}>{potentialFiatLabel}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Ganancia potencial (USD):</Text>
              <Text
                style={[
                  styles.value,
                  (potentialInfo?.profitUsd ?? 0) >= 0 ? styles.profit : styles.loss,
                ]}
              >
                {potentialProfitLabel}
              </Text>
            </View>
          </>
        )}
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.centerContent}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContent}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📈 Histórico de transacciones</Text>

      <View style={styles.summaryContainer}>
        <Text style={styles.summaryLabel}>Ganancia total</Text>
        <Text
          style={[styles.summaryValue, totals.total >= 0 ? styles.profit : styles.loss]}
        >
          USD {totals.total.toFixed(2)}
        </Text>
        <Text style={styles.summaryDetail}>
          Cerradas: USD {totals.closedUsd.toFixed(2)} · Potencial: USD {totals.openUsd.toFixed(2)}
        </Text>
      </View>

      <View style={styles.filtersContainer}>
        <Text style={styles.filterLabel}>Estado</Text>
        <View style={styles.chipRow}>
          {["all", "open", "closed"].map(option => (
            <Text
              key={option}
              style={[styles.chip, statusFilter === option && styles.chipActive]}
              onPress={() => setStatusFilter(option as typeof statusFilter)}
            >
              {option === "all" ? "Todos" : option === "open" ? "Abiertas" : "Cerradas"}
            </Text>
          ))}
        </View>

        <Text style={[styles.filterLabel, styles.assetLabel]}>Activo</Text>
        <View style={styles.chipRow}>
          <Text
            style={[styles.chip, assetFilter === "all" && styles.chipActive]}
            onPress={() => setAssetFilter("all")}
          >
            Todos
          </Text>
          {assetOptions.map(symbol => (
            <Text
              key={symbol}
              style={[styles.chip, assetFilter === symbol && styles.chipActive]}
              onPress={() => setAssetFilter(symbol)}
            >
              {symbol}
            </Text>
          ))}
        </View>
      </View>

      <FlatList
        data={filteredTransactions}
        keyExtractor={item => item._id}
        renderItem={renderItem}
        contentContainerStyle={
          filteredTransactions.length ? styles.listContent : styles.emptyContainer
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadTransactions({ silent: true });
            }}
          />
        }
        ListEmptyComponent={<Text style={styles.emptyText}>No hay transacciones registradas.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 12,
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  errorText: {
    fontSize: 16,
    color: "#c62828",
  },
  listContent: {
    paddingBottom: 24,
    gap: 12,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: "#616161",
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    padding: 16,
    backgroundColor: "#f9f9f9",
    gap: 6,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  symbol: {
    fontSize: 18,
    fontWeight: "700",
  },
  status: {
    fontSize: 13,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  closed: {
    backgroundColor: "#e8f5e9",
    color: "#1b5e20",
  },
  open: {
    backgroundColor: "#fff3e0",
    color: "#ef6c00",
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#424242",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  label: {
    fontSize: 14,
    color: "#616161",
  },
  value: {
    fontSize: 14,
    color: "#212121",
  },
  profit: {
    color: "#1b5e20",
  },
  loss: {
    color: "#c62828",
  },
  summaryContainer: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#f1f8e9",
    gap: 4,
  },
  summaryLabel: {
    fontSize: 14,
    color: "#546e7a",
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: "600",
  },
  summaryDetail: {
    fontSize: 13,
    color: "#546e7a",
  },
  filtersContainer: {
    marginBottom: 16,
    gap: 8,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#424242",
  },
  assetLabel: {
    marginTop: 8,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#90a4ae",
    borderRadius: 16,
    color: "#37474f",
  },
  chipActive: {
    backgroundColor: "#1b5e20",
    borderColor: "#1b5e20",
    color: "#fff",
  },
});

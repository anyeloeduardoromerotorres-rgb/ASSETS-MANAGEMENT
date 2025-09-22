// app/balances.tsx
import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import api from "../constants/api";

type Balance = {
  asset: string;
  total: number;
  usdValue: number;
};

type Totals = {
  usd: number;
  pen: number;
};

type AssetFromDB = {
  _id: string;
  symbol: string;
  type: "fiat" | "crypto" | "stock" | "commodity";
  initialInvestment?: number | Record<string, number>;
};

type StockHolding = {
  asset: string;
  total: number; // unidades (acciones) guardadas en la base
};

export default function BalancesScreen() {
  const [balances, setBalances] = useState<Balance[]>([]);
  const [totals, setTotals] = useState<Totals>({ usd: 0, pen: 0 });
  const [loading, setLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const listenKeyRef = useRef<string | null>(null);
  const [penPrice, setPenPrice] = useState<number | null>(null);
  const [stockHoldings, setStockHoldings] = useState<StockHolding[]>([]);
  const [vooPrice, setVooPrice] = useState<number | null>(null);

  const fetchBalances = async () => {
    try {
      const res = await api.get("/binance/balances");
      setBalances(res.data.balances);
      setTotals(res.data.totals);
    } catch (err) {
      console.error("❌ Error al traer balances:", err);
    } finally {
      setLoading(false);
    }
  };

  // ✅ Precio PEN/USD
  const fetchPenPrice = async () => {
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/PEN");
      const data = await res.json();
      if (data.result === "success" && data.rates?.USD) {
        setPenPrice(data.rates.USD);
        console.log("📊 Precio PEN/USD actualizado:", data.rates.USD);
      }
    } catch (err) {
      console.error("❌ Error al traer precio PEN/USD:", err);
    }
  };

  // ✅ Precio en tiempo real de VOO (Yahoo Finance)
  const fetchVooPrice = async () => {
    try {
      const res = await fetch(
        "https://query1.finance.yahoo.com/v8/finance/chart/VOO"
      );
      const data = await res.json();
      const price =
        data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
      if (price) {
        setVooPrice(price);
        console.log("📊 Precio VOO actualizado:", price);
      }
    } catch (err) {
      console.error("❌ Error al traer precio de VOO:", err);
    }
  };

  // ✅ WebSocket de Binance
  const initWebSocket = async () => {
    try {
      const res = await api.post("/binance/create-listen-key");
      listenKeyRef.current = res.data.listenKey;

      const ws = new WebSocket(
        `wss://stream.binance.com:9443/ws/${listenKeyRef.current}`
      );
      wsRef.current = ws;

      ws.onopen = () => console.log("✅ WebSocket conectado");
      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        if (data.e === "outboundAccountPosition") {
          console.log("🔄 Balance actualizado, recargando...");
          fetchBalances();
        }
      };

      ws.onclose = () => console.log("⚠️ WebSocket cerrado");
      ws.onerror = (err) => console.error("❌ WebSocket error:", err);
    } catch (err) {
      console.error("❌ Error iniciando WebSocket:", err);
    }
  };

  const keepAliveListenKey = async () => {
    if (!listenKeyRef.current) return;
    try {
      await api.put("/binance/keep-alive-listen-key", {
        listenKey: listenKeyRef.current,
      });
      console.log("🔄 listenKey renovado");
    } catch (err) {
      console.error("❌ Error al renovar listenKey:", err);
    }
  };

  // ✅ Traer activos de la base de datos (incluye VOO)
  const fetchAssets = async () => {
    try {
      const res = await api.get<AssetFromDB[]>("/assets");
      

      const stocks = res.data.filter((a: AssetFromDB) => a.type === "stock");

      const holdings: StockHolding[] = stocks.map((stock: AssetFromDB) => {
        let amount = 0;
        if (typeof stock.initialInvestment === "number") {
          amount = stock.initialInvestment;
        } else if (stock.initialInvestment) {
          if (typeof stock.initialInvestment["USD"] === "number") {
            amount = stock.initialInvestment["USD"];
          } else if (typeof (stock.initialInvestment as any).amount === "number") {
            amount = (stock.initialInvestment as any).amount;
          }
        }

        return {
          asset: stock.symbol,
          total: amount,
        };
      });

      console.log("📊 Stock holdings cargados:", holdings);
      setStockHoldings(holdings);
    } catch (err) {
      console.error("❌ Error al traer assets:", err);
    }
  };

  useEffect(() => {
    fetchBalances();
    fetchPenPrice();
    fetchVooPrice();
    fetchAssets();
    initWebSocket();

    const interval = setInterval(() => {
      keepAliveListenKey();
      fetchPenPrice();
      fetchVooPrice();
    }, 30 * 60 * 1000);

    return () => {
      clearInterval(interval);
      if (wsRef.current) wsRef.current.close();
    };
  }, [vooPrice]); // 👈 se vuelve a ejecutar cuando tenemos precio de VOO

  const stockBalances: Balance[] = stockHoldings.map((holding) => {
    const isVoo = holding.asset === "VOO";
    const hasPrice = typeof vooPrice === "number";

    const usdValue = isVoo
      ? hasPrice
        ? holding.total * (vooPrice as number)
        : holding.total
      : holding.total;

    return {
      asset: holding.asset,
      total: holding.total,
      usdValue,
    };
  });

  const extendedBalances: Balance[] = [
    ...balances,
    ...stockBalances,
    { asset: "USD", total: totals.usd, usdValue: totals.usd },
    {
      asset: "PEN",
      total: totals.pen,
      usdValue: penPrice ? totals.pen * penPrice : 0,
    },
  ].filter((b) => b.usdValue > 0);

  const totalUsd = extendedBalances.reduce(
    (acc, b) => acc + (b.asset === "PEN" && !penPrice ? 0 : b.usdValue),
    0
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>💰 Balances</Text>

      <View style={styles.totalsContainer}>
        <Text style={styles.totalText}>
          Total USD:{" "}
          {penPrice ? `$${totalUsd.toFixed(2)}` : "Cargando..."}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" />
      ) : extendedBalances.length === 0 ? (
        <Text style={styles.empty}>No tienes balances en este momento</Text>
      ) : (
        <ScrollView>
          {extendedBalances.map((b) => (
            <View key={b.asset} style={styles.row}>
              <Text style={styles.asset}>{b.asset}</Text>
              <Text style={styles.amount}>
                {["USDT", "USD", "PEN"].includes(b.asset)
                  ? b.total.toFixed(2)
                  : b.total.toFixed(8)}
              </Text>
              {b.asset === "PEN" && !penPrice ? (
                <Text style={styles.usd}>Cargando...</Text>
              ) : (
                <Text style={styles.usd}>${b.usdValue.toFixed(2)}</Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 12 },
  totalsContainer: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 12,
  },
  totalText: { fontSize: 18, fontWeight: "600", marginBottom: 4 },
  empty: { textAlign: "center", marginTop: 20, color: "#777" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  asset: { fontWeight: "bold", fontSize: 16 },
  amount: { fontSize: 16 },
  usd: { fontSize: 16, color: "#4caf50", fontWeight: "500" },
});

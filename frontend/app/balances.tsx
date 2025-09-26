// app/balances.tsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
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
  const [usdtSellPrice, setUsdtSellPrice] = useState<number | null>(null);
  const pricesRef = useRef<Record<string, number>>({}); // precio por asset (ej: BTC -> 63000)
  const [pricesTick, setPricesTick] = useState(0); // para forzar re-render al actualizar precios
  const priceWsRef = useRef<WebSocket | null>(null);

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

  // ✅ Stream de precios al contado (Binance) según balances actuales
  const startPriceStream = useCallback((assets: string[]) => {
    try {
      // Cerrar stream anterior si existe
      if (priceWsRef.current) {
        try { priceWsRef.current.close(); } catch {}
        priceWsRef.current = null;
      }

      // Armar lista de pares <ASSET>USDT para stream (excluye USD/USDT/PEN)
      const pairs = Array.from(new Set(
        assets
          .filter(a => a && !["USDT", "USD", "PEN"].includes(a))
          .map(a => `${a}USDT`)
      ));

      if (pairs.length === 0) return;

      const streams = pairs.map(p => `${p.toLowerCase()}@miniticker`).join("/");
      const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
      const ws = new WebSocket(url);
      priceWsRef.current = ws;

      ws.onopen = () => {
        // console.log("✅ Price stream conectado");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const data = msg?.data || msg; // combinado o simple
          const symbol: string | undefined = data?.s;
          const closeStr: string | undefined = data?.c; // last price
          if (!symbol || typeof closeStr !== "string") return;

          if (symbol.endsWith("USDT")) {
            const asset = symbol.replace(/USDT$/, "");
            const price = Number(closeStr);
            if (Number.isFinite(price)) {
              pricesRef.current[asset] = price;
              // gatillar re-render ligero
              setPricesTick(t => (t + 1) % 1_000_000);
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        // console.log("⚠️ Price stream cerrado");
      };

      ws.onerror = (err) => {
        // console.error("❌ Price stream error:", err);
      };
    } catch {}
  }, []);

  useEffect(() => {
    fetchBalances();
    fetchPenPrice();
    fetchVooPrice();
    fetchAssets();
    // Traer precio de venta USDT desde ConfigInfo (mismo que Index)
    (async () => {
      try {
        const res = await api.get("/config-info/name/PrecioVentaUSDT");
        const price = Number(res.data?.total);
        if (Number.isFinite(price)) setUsdtSellPrice(price);
      } catch (err) {
        console.error("❌ Error obteniendo PrecioVentaUSDT:", err);
      }
    })();
    initWebSocket();

    const interval = setInterval(() => {
      keepAliveListenKey();
      fetchPenPrice();
      fetchVooPrice();
    }, 30 * 60 * 1000);

    return () => {
      clearInterval(interval);
      if (priceWsRef.current) try { priceWsRef.current.close(); } catch {}
      if (wsRef.current) wsRef.current.close();
    };
  }, [vooPrice]); // 👈 se vuelve a ejecutar cuando tenemos precio de VOO

  // ✅ Refrescar al enfocar la pantalla
  useFocusEffect(
    useCallback(() => {
      fetchBalances();
      fetchPenPrice();
      fetchVooPrice();
      fetchAssets();
      (async () => {
        try {
          const res = await api.get("/config-info/name/PrecioVentaUSDT");
          const price = Number(res.data?.total);
          if (Number.isFinite(price)) setUsdtSellPrice(price);
        } catch {}
      })();
    }, [])
  );

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

  // Arrancar (o reiniciar) stream de precios cuando cambie la lista de assets
  useEffect(() => {
    const assets = balances.map(b => b.asset);
    startPriceStream(assets);
  }, [balances, startPriceStream]);

  const extendedBalances: Balance[] = [
    // Aplicar precios en tiempo real cuando existan
    ...balances.map(b => {
      if (b.asset === "USDT") {
        const price = usdtSellPrice ?? 1;
        return { ...b, usdValue: b.total * price };
      }
      const livePrice = pricesRef.current[b.asset];
      if (typeof livePrice === "number" && Number.isFinite(livePrice) && b.total > 0) {
        return { ...b, usdValue: b.total * livePrice };
      }
      return b;
    }),
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
          <View style={styles.headerRow}>
            <Text style={[styles.headerCell, styles.assetHeader]}>Activo</Text>
            <Text style={[styles.headerCell, styles.amountHeader]}>Cantidad</Text>
            <Text style={[styles.headerCell, styles.usdHeader]}>USD / Precio</Text>
          </View>

          {extendedBalances.map((b) => {
            let price: number | null = null;
            if (b.asset === 'USDT') price = usdtSellPrice ?? 1;
            else if (b.asset === 'USD') price = 1;
            else if (b.asset === 'PEN') price = penPrice ?? null;
            else if (typeof pricesRef.current[b.asset] === 'number') price = pricesRef.current[b.asset];
            if (price == null && b.total > 0) price = b.usdValue / b.total;

            const amountText = ['USDT', 'USD', 'PEN'].includes(b.asset)
              ? b.total.toFixed(2)
              : b.total.toFixed(8);
            const usdText = b.asset === 'PEN' && !penPrice ? 'Cargando...' : `$${b.usdValue.toFixed(2)}`;

            return (
              <View key={b.asset} style={styles.row}>
                <View style={[styles.cell, styles.cellAsset]}>
                  <Text style={styles.asset}>{b.asset}</Text>
                </View>
                <View style={[styles.cell, styles.cellAmount]}>
                  <Text style={styles.amount}>{amountText}</Text>
                </View>
                <View style={[styles.cell, styles.cellUsd]}>
                  <Text style={styles.usd}>{usdText}</Text>
                  <Text style={styles.price}>{price != null ? `$${price.toFixed(6)}` : '-'}</Text>
                </View>
              </View>
            );
          })}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    marginBottom: 4,
  },
  headerCell: { color: '#444', fontSize: 12, fontWeight: '700' },
  assetHeader: { flex: 1 },
  amountHeader: { flex: 1, textAlign: 'right' },
  usdHeader: { flex: 1.4, textAlign: 'right' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  cell: { paddingHorizontal: 4 },
  cellAsset: { flex: 1 },
  cellAmount: { flex: 1 },
  cellUsd: { flex: 1.4, alignItems: 'flex-end' },
  asset: { fontWeight: 'bold', fontSize: 16 },
  amount: { fontSize: 16, textAlign: 'right' },
  usd: { fontSize: 16, color: '#4caf50', fontWeight: '600', textAlign: 'right' },
  price: { fontSize: 12, color: '#666', textAlign: 'right' },
});

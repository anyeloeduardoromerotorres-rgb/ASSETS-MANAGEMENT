// app/prediccion.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, ScrollView, TextInput, TouchableOpacity } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import api from "../constants/api";
import { CONFIG_INFO_INITIAL_ID } from "../constants/config";
import { computeXIRR } from "../utils/xirrmanual"; // tu función XIRR

type CashFlow = { amount: number; when: Date };
type Balance = { asset: string; total: number; usdValue: number };
type Totals = { usd: number; pen: number };
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

type ProjectionResult =
  | { status: "success"; years: number; monthly: number; target: number }
  | { status: "not_reached" }
  | { status: "invalid" }
  | { status: "negative" };

const parseNumberInput = (value: string | null | undefined): number | null => {
  if (value === undefined || value === null) return null;
  const sanitized = value.replace(/[^0-9,.-]/g, "").replace(/,/g, ".");
  if (sanitized.trim() === "" || sanitized === "-" || sanitized === "." || sanitized === "-.") {
    return null;
  }
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function PrediccionScreen() {
  const [loading, setLoading] = useState(true);
  const [totalUsd, setTotalUsd] = useState<number | null>(null);
  const [xirr, setXirr] = useState<number | null>(null);
  const [withdrawPercentage, setWithdrawPercentage] = useState<number | null>(null);
  const [applyWithdrawal, setApplyWithdrawal] = useState<boolean>(false);
  const [startOfYear, setStartOfYear] = useState<string>("");
  const [rentabilidadInput, setRentabilidadInput] = useState<string>("");
  const [withdrawInput, setWithdrawInput] = useState<string>("30");
  const [minWithdrawInput, setMinWithdrawInput] = useState<string>("900");
  const [startInitialized, setStartInitialized] = useState(false);
  const [rentInitialized, setRentInitialized] = useState(false);
  // Para actualizar los defaults si cambian los valores base (sin pisar ediciones del usuario)
  const [autoStartDefault, setAutoStartDefault] = useState<string | null>(null);
  const [autoRentDefault, setAutoRentDefault] = useState<string | null>(null);
  const [isEditingStart, setIsEditingStart] = useState(false);
  const [isEditingRent, setIsEditingRent] = useState(false);

  // ====== Estado y refs para replicar cálculo de Balances ======
  const [balances, setBalances] = useState<Balance[]>([]);
  const [totals, setTotals] = useState<Totals>({ usd: 0, pen: 0 });
  const wsRef = useRef<WebSocket | null>(null);
  const listenKeyRef = useRef<string | null>(null);
  const [penPrice, setPenPrice] = useState<number | null>(null);
  const [stockHoldings, setStockHoldings] = useState<StockHolding[]>([]);
  const [vooPrice, setVooPrice] = useState<number | null>(null);
  const [usdtSellPrice, setUsdtSellPrice] = useState<number | null>(null);
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});
  const pricesRef = useRef<Record<string, number>>({});
  const [pricesTick, setPricesTick] = useState(0); // tick para re-render al llegar precios
  const priceWsRef = useRef<WebSocket | null>(null);

  // Flujos de caja para XIRR
  const [initialFlow, setInitialFlow] = useState<CashFlow | null>(null);
  const [flows, setFlows] = useState<CashFlow[]>([]);

  const resetInputsToDefaults = useCallback(() => {
    setStartInitialized(false);
    setRentInitialized(false);
    setStartOfYear("");
    setRentabilidadInput("");
    setWithdrawInput("30");
    setMinWithdrawInput("900");
    setApplyWithdrawal(false);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      resetInputsToDefaults();

      // 1️⃣ Traer inversión inicial (flujo negativo)
      const resInit = await api.get(`/config-info/${CONFIG_INFO_INITIAL_ID}`);
      const inversionInicial: CashFlow = {
        amount: -Math.abs(resInit.data.total),
        when: new Date(resInit.data.createdAt),
      };
      setInitialFlow(inversionInicial);

      // 2️⃣ Traer depósitos y retiros
      const resFlows = await api.get("/depositewithdrawal");
      const flowsData: any[] = Array.isArray(resFlows.data) ? resFlows.data : [];
      const depositosRetiros: CashFlow[] = flowsData.map((cf: any) => {
        const kind = String(cf.transaction || '').toLowerCase();
        const isWithdrawal = kind === 'retiro';
        const amt = Math.abs(Number(cf.quantity || 0));
        const when = new Date(cf.createdAt);
        return { amount: isWithdrawal ? Math.abs(amt) : -Math.abs(amt), when };
      });
      setFlows([inversionInicial, ...depositosRetiros]);

      // 3️⃣ Traer fuentes usadas por Balances
      const res = await api.get("/binance/balances");
      setBalances(res.data.balances);
      setTotals(res.data.totals);

      const [penRes, vooRes, assetsRes] = await Promise.all([
        fetch("https://open.er-api.com/v6/latest/PEN").then(r => r.json()).catch(() => null),
        fetch("https://query1.finance.yahoo.com/v8/finance/chart/VOO").then(r => r.json()).catch(() => null),
        api.get<AssetFromDB[]>("/assets").catch(() => ({ data: [] as AssetFromDB[] } as any)),
      ]);

      const penRate = penRes?.result === "success" && penRes?.rates?.USD ? penRes.rates.USD : null;
      if (penRate != null) {
        setPenPrice(penRate);
      }
      const voo = vooRes?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
      if (voo) {
        setVooPrice(voo);
      }

      const stocks = (Array.isArray(assetsRes?.data) ? assetsRes.data : []).filter((a: AssetFromDB) => a.type === "stock");
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
        return { asset: stock.symbol, total: amount };
      });
      setStockHoldings(holdings);

      try {
        const conf = await api.get("/config-info/name/PrecioVentaUSDT");
        const price = Number(conf.data?.total);
        if (Number.isFinite(price)) {
          setUsdtSellPrice(price);
        }
      } catch {}
    } catch (err) {
      console.error("❌ Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  }, [resetInputsToDefaults]);

  const hasFetchedOnFocus = useRef(false);

  useFocusEffect(
    useCallback(() => {
      hasFetchedOnFocus.current = true;
      fetchData();
    }, [fetchData])
  );

  useEffect(() => {
    if (!hasFetchedOnFocus.current) {
      fetchData();
    }
  }, [fetchData]);

  useEffect(() => {
    if (totalUsd !== null && totalUsd > 0) {
      const v = totalUsd.toFixed(2);
      const shouldApply = (!startInitialized || startOfYear === autoStartDefault) && !isEditingStart;
      if (shouldApply) {
        setStartOfYear(v);
        setAutoStartDefault(v);
        setStartInitialized(true);
      }
    }
  }, [totalUsd, startInitialized, startOfYear, autoStartDefault, isEditingStart]);

  useEffect(() => {
    if (xirr !== null && totalUsd !== null && totalUsd > 0) {
      const v = (xirr * 100).toFixed(2);
      const shouldApply = (!rentInitialized || rentabilidadInput === autoRentDefault) && !isEditingRent;
      if (shouldApply) {
        setRentabilidadInput(v);
        setAutoRentDefault(v);
        setRentInitialized(true);
      }
    }
  }, [xirr, totalUsd, rentInitialized, rentabilidadInput, autoRentDefault, isEditingRent]);

  const projection = useMemo<ProjectionResult | null>(() => {
    if (totalUsd === null) return null;

    const initialCapitalInput = parseNumberInput(startOfYear);
    const initialCapital = initialCapitalInput ?? totalUsd;

    const rentabilidadPctInput = parseNumberInput(rentabilidadInput);
    const rentabilidadFallback = xirr !== null ? xirr * 100 : null;
    const ratePct = rentabilidadPctInput ?? rentabilidadFallback;
    if (ratePct === null) return { status: "invalid" };
    const rate = ratePct / 100;

    if (rate <= 0) {
      return { status: "negative" };
    }

    const withdrawPctInput = parseNumberInput(withdrawInput);
    const withdrawFallback =
      withdrawPercentage !== null ? withdrawPercentage * 100 : null;
    const withdrawPct = withdrawPctInput ?? withdrawFallback ?? 0;
    const withdrawFraction = Math.min(Math.max(withdrawPct / 100, 0), 1);

    if (withdrawFraction <= 0) {
      return { status: "not_reached" };
    }

    const minMonthlyInput = parseNumberInput(minWithdrawInput);
    const minMonthly = minMonthlyInput ?? 0;

    if (initialCapital <= 0 || minMonthly <= 0) {
      return { status: "invalid" };
    }

    let capital = initialCapital;
    const maxYears = 10000; // resguardo, pero permite un horizonte amplio

    for (let year = 1; year <= maxYears; year++) {
      const endCapital = capital * (1 + rate);
      const gains = Math.max(endCapital - capital, 0);
      const withdrawal = gains * withdrawFraction;
      const monthly = withdrawal / 12;

      if (monthly >= minMonthly) {
        return { status: "success", years: year, monthly, target: minMonthly };
      }

      const nextCapital = applyWithdrawal ? endCapital - withdrawal : endCapital;
      if (nextCapital <= 0) break;
      capital = nextCapital;
    }

    return { status: "not_reached" };
  }, [
    applyWithdrawal,
    minWithdrawInput,
    rentabilidadInput,
    startOfYear,
    totalUsd,
    withdrawInput,
    withdrawPercentage,
    xirr,
  ]);

  const defaultStartValue = totalUsd !== null ? totalUsd.toFixed(2) : "";
  const defaultRentValue = xirr !== null ? (xirr * 100).toFixed(2) : "";
  const defaultMinWithdrawValue = "900";
  const defaultWithdrawValue = "30";

  // ====== Lógica de precios/sockets idéntica a Balances ======
  const fetchBalancesLikeBalancesScreen = useCallback(async () => {
    try {
      const res = await api.get("/binance/balances");
      setBalances(res.data.balances);
      setTotals(res.data.totals);
    } catch (err) {
      console.error("❌ Error al traer balances:", err);
    }
  }, []);

  const fetchPenPriceLikeBalances = useCallback(async () => {
    try {
      const res = await fetch("https://open.er-api.com/v6/latest/PEN");
      const data = await res.json();
      if (data.result === "success" && data.rates?.USD) {
        setPenPrice(data.rates.USD);
      }
    } catch (err) {
      console.error("❌ Error al traer precio PEN/USD:", err);
    }
  }, []);

  const fetchVooPriceLikeBalances = useCallback(async () => {
    try {
      const res = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/VOO");
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
      if (price) setVooPrice(price);
    } catch (err) {
      console.error("❌ Error al traer precio de VOO:", err);
    }
  }, []);

  const initWebSocket = useCallback(async () => {
    try {
      const res = await api.post("/binance/create-listen-key");
      listenKeyRef.current = res.data.listenKey;
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${listenKeyRef.current}`);
      wsRef.current = ws;
      ws.onopen = () => {};
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.e === "outboundAccountPosition") {
          fetchBalancesLikeBalancesScreen();
        }
      };
      ws.onclose = () => {};
      ws.onerror = () => {};
    } catch (err) {
      console.error("❌ Error iniciando WebSocket:", err);
    }
  }, [fetchBalancesLikeBalancesScreen]);

  const keepAliveListenKey = useCallback(async () => {
    if (!listenKeyRef.current) return;
    try {
      await api.put("/binance/keep-alive-listen-key", { listenKey: listenKeyRef.current });
    } catch (err) {
      console.error("❌ Error al renovar listenKey:", err);
    }
  }, []);

  const fetchAssetsLikeBalances = useCallback(async () => {
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
        return { asset: stock.symbol, total: amount };
      });
      setStockHoldings(holdings);
    } catch (err) {
      console.error("❌ Error al traer assets:", err);
    }
  }, []);

  const fetchStockPrice = useCallback(async (symbol: string) => {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
      );
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof price === 'number' && price > 0) {
        setStockPrices(prev => ({ ...prev, [symbol]: price }));
      }
    } catch (err) {
      console.error(`❌ Error al traer precio de ${symbol}:`, err);
    }
  }, []);

  useEffect(() => {
    const symbols = stockHoldings.map(s => s.asset).filter(Boolean);
    symbols.forEach(sym => fetchStockPrice(sym));
  }, [stockHoldings, fetchStockPrice]);

  // Calcular totalUsd exactamente como Balances
  useEffect(() => {
    const compute = () => {
      if (!balances) return;
      // USDT con precio configurado
      const usdtPrice = usdtSellPrice ?? 1;
      // Construir balances extendidos como en balances.tsx
      const mapped = [
        ...balances.map(b => {
          if (b.asset === 'USDT') {
            return { ...b, usdValue: b.total * usdtPrice };
          }
          const live = pricesRef.current[b.asset];
          if (typeof live === 'number' && Number.isFinite(live) && b.total > 0) {
            return { ...b, usdValue: b.total * live };
          }
          return b;
        }),
        // stocks desde holdings (precio VOO por ahora si aplica)
        ...stockHoldings.map(holding => {
          const { asset, total } = holding;
          let price: number | null = null;
          if (asset === 'VOO') price = typeof vooPrice === 'number' ? vooPrice : null;
          else if (typeof stockPrices[asset] === 'number') price = stockPrices[asset];
          const usdValue = price != null ? total * price : total;
          return { asset, total, usdValue } as Balance;
        }),
        { asset: 'USD', total: totals.usd, usdValue: totals.usd },
        { asset: 'PEN', total: totals.pen, usdValue: penPrice ? totals.pen * penPrice : 0 },
      ].filter(b => b.usdValue > 0);

      const sum = mapped.reduce((acc, b) => acc + (b.asset === 'PEN' && !penPrice ? 0 : b.usdValue), 0);
      setTotalUsd(sum);
    };
    compute();
  }, [balances, totals, usdtSellPrice, stockHoldings, vooPrice, penPrice, pricesTick]);

  const startPriceStream = useCallback((assets: string[]) => {
    try {
      if (priceWsRef.current) {
        try { priceWsRef.current.close(); } catch {}
        priceWsRef.current = null;
      }
      const pairs = Array.from(new Set(
        assets
          .filter(a => a && ["USDT", "USD", "PEN"].indexOf(a) === -1)
          .map(a => `${a}USDT`)
      ));
      if (pairs.length === 0) return;
      const streams = pairs.map(p => `${p.toLowerCase()}@miniticker`).join("/");
      const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
      const ws = new WebSocket(url);
      priceWsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const data = msg?.data || msg;
          const symbol: string | undefined = data?.s;
          const closeStr: string | undefined = data?.c;
          if (!symbol || typeof closeStr !== "string") return;
          if (symbol.endsWith("USDT")) {
            const asset = symbol.replace(/USDT$/, "");
            const price = Number(closeStr);
            if (Number.isFinite(price)) {
              pricesRef.current[asset] = price;
              setPricesTick(t => (t + 1) % 1_000_000);
            }
          }
        } catch {}
      };
    } catch {}
  }, []);

  // Arrancar (o reiniciar) stream de precios cuando cambie la lista de assets
  useEffect(() => {
    const assets = balances.map(b => b.asset);
    startPriceStream(assets);
  }, [balances, startPriceStream]);

  // Ciclo de vida principal (similar a Balances)
  useEffect(() => {
    fetchBalancesLikeBalancesScreen();
    fetchPenPriceLikeBalances();
    fetchVooPriceLikeBalances();
    fetchAssetsLikeBalances();
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
      fetchPenPriceLikeBalances();
      fetchVooPriceLikeBalances();
    }, 30 * 60 * 1000);

    return () => {
      clearInterval(interval);
      if (priceWsRef.current) try { priceWsRef.current.close(); } catch {}
      if (wsRef.current) wsRef.current.close();
    };
  }, [fetchBalancesLikeBalancesScreen, fetchPenPriceLikeBalances, fetchVooPriceLikeBalances, fetchAssetsLikeBalances, initWebSocket, keepAliveListenKey]);

  // Refrescar al enfocar la pantalla
  useFocusEffect(
    useCallback(() => {
      fetchBalancesLikeBalancesScreen();
      fetchPenPriceLikeBalances();
      fetchVooPriceLikeBalances();
      fetchAssetsLikeBalances();
      (async () => {
        try {
          const res = await api.get("/config-info/name/PrecioVentaUSDT");
          const price = Number(res.data?.total);
          if (Number.isFinite(price)) setUsdtSellPrice(price);
        } catch {}
      })();
    }, [fetchBalancesLikeBalancesScreen, fetchPenPriceLikeBalances, fetchVooPriceLikeBalances, fetchAssetsLikeBalances])
  );

  // Balances de acciones (VOO usa precio si existe)
  const stockBalances: Balance[] = useMemo(() => {
    return stockHoldings.map((holding) => {
      const isVoo = holding.asset === "VOO";
      const hasPrice = typeof vooPrice === "number";
      const usdValue = isVoo
        ? hasPrice
          ? holding.total * (vooPrice as number)
          : holding.total
        : holding.total;
      return { asset: holding.asset, total: holding.total, usdValue };
    });
  }, [stockHoldings, vooPrice, pricesTick]);

  // Construir extendedBalances igual que en Balances
  const extendedBalances: Balance[] = useMemo(() => {
    return [
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
      { asset: "PEN", total: totals.pen, usdValue: penPrice ? totals.pen * penPrice : 0 },
    ].filter((b) => b.usdValue > 0);
  }, [balances, stockBalances, totals, penPrice, usdtSellPrice, pricesTick]);

  const totalUsdCalculated = useMemo(() => {
    return extendedBalances.reduce((acc, b) => acc + (b.asset === "PEN" && !penPrice ? 0 : b.usdValue), 0);
  }, [extendedBalances, penPrice]);

  // Mantener totalUsd en sync con el cálculo de Balances
  useEffect(() => {
    if (Number.isFinite(totalUsdCalculated)) {
      setTotalUsd(totalUsdCalculated);
    }
  }, [totalUsdCalculated]);

  // Recalcular XIRR y % de retiro cuando haya flujos + totalUsd
  useEffect(() => {
    if (initialFlow == null || totalUsd == null) return;
    const flowsLocal = flows.length ? flows : [initialFlow];

    const totalDepositos = flowsLocal
      .filter(f => f.amount < 0)
      .reduce((acc, f) => acc + Math.abs(f.amount), 0);
    const totalRetiros = flowsLocal
      .filter(f => f.amount > 0)
      .reduce((acc, f) => acc + f.amount, 0);
    const retiroPct = totalDepositos > 0 ? totalRetiros / totalDepositos : 0;
    setWithdrawPercentage(retiroPct);

    const flowsForXirr = [...flowsLocal, { amount: totalUsd, when: new Date() }];
    // inputs de XIRR ya preparados en flowsForXirr
    let xirrResult = computeXIRR(flowsForXirr);
    if (xirrResult == null) {
      const startValue = Math.abs(initialFlow.amount);
      const endValue = totalUsd;
      const startDate = initialFlow.when;
      const endDate = new Date();
      const years = (endDate.getTime() - startDate.getTime()) / (365 * 24 * 3600 * 1000);
      const cagr = Math.pow(endValue / startValue, 1 / years) - 1;
      setXirr(cagr);
    } else {
      setXirr(xirrResult);
    }
  }, [initialFlow, flows, totalUsd]);
  

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📈 Predicción Financiera</Text>

      {loading ? (
        <ActivityIndicator size="large" />
      ) : (
        <ScrollView>
          <Text style={styles.text}>
            Total USD actual: {totalUsd?.toFixed(2)}
          </Text>
          <Text style={styles.text}>
            {xirr !== null
              ? `Rentabilidad ${xirr * 100 >= 0 ? "" : "-"}${(xirr * 100).toFixed(2)}%`
              : "No se pudo calcular"}
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Inicio de año</Text>
            <TextInput
              style={styles.input}
              placeholder={
                totalUsd !== null ? totalUsd.toFixed(2) : "Ingresa monto"
              }
              value={startOfYear}
              onChangeText={setStartOfYear}
              onFocus={() => {
                setIsEditingStart(true);
                if (startOfYear === defaultStartValue) setStartOfYear("");
              }}
              onBlur={() => setIsEditingStart(false)}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Rentabilidad</Text>
            <TextInput
              style={styles.input}
              placeholder={
                xirr !== null ? `${(xirr * 100).toFixed(2)}%` : "Ingresa rentabilidad"
              }
              value={rentabilidadInput}
              onChangeText={setRentabilidadInput}
              onFocus={() => {
                setIsEditingRent(true);
                if (rentabilidadInput === defaultRentValue) setRentabilidadInput("");
              }}
              onBlur={() => setIsEditingRent(false)}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Mínimo para retirar</Text>
            <TextInput
              style={styles.input}
              placeholder="$900"
              value={minWithdrawInput}
              onChangeText={setMinWithdrawInput}
              onFocus={() => {
                if (minWithdrawInput === defaultMinWithdrawValue) {
                  setMinWithdrawInput("");
                }
              }}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>% Retiro</Text>
            <TextInput
              style={styles.input}
              placeholder={
                withdrawPercentage !== null
                  ? `${(withdrawPercentage * 100).toFixed(2)}%`
                  : "Ingresa porcentaje"
              }
              value={withdrawInput}
              onChangeText={setWithdrawInput}
              onFocus={() => {
                if (withdrawInput === defaultWithdrawValue) {
                  setWithdrawInput("");
                }
              }}
              keyboardType="numeric"
            />
          </View>

          <TouchableOpacity
            style={[styles.checkboxContainer, applyWithdrawal && styles.checkboxChecked]}
            onPress={() => setApplyWithdrawal(prev => !prev)}
          >
            <View style={[styles.checkbox, applyWithdrawal && styles.checkboxInner]} />
            <Text style={styles.checkboxLabel}>¿Aplicar retiro?</Text>
          </TouchableOpacity>

          {projection && (
            <View style={styles.resultContainer}>
              {projection.status === "success" ? (
                <Text style={styles.resultText}>
                  {`En ${projection.years} ${projection.years === 1 ? "año" : "años"} tu retiro mensual estimado sería de `}
                  <Text style={styles.resultHighlight}>
                    {`$${projection.monthly.toFixed(2)}`}
                  </Text>
                  {`, superando tu objetivo de $${projection.target.toFixed(2)}.`}
                </Text>
              ) : projection.status === "not_reached" ? (
                <Text style={styles.resultText}>
                  Con los parámetros actuales no alcanzas el retiro mínimo.
                </Text>
              ) : projection.status === "negative" ? (
                <Text style={styles.resultText}>
                  Con una rentabilidad no positiva no alcanzarás la meta de retiro.
                </Text>
              ) : (
                <Text style={styles.resultText}>
                  No se pudo calcular la proyección. Revisa los valores ingresados.
                </Text>
              )}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 12 },
  text: { fontSize: 18, marginBottom: 8 },
  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 16, fontWeight: "600", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  checkboxContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#333",
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxInner: {
    backgroundColor: "#4caf50",
    borderColor: "#4caf50",
  },
  checkboxChecked: {
    opacity: 0.9,
  },
  checkboxLabel: { fontSize: 16 },
  resultContainer: {
    marginTop: 20,
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#f0f7f0",
    borderWidth: 1,
    borderColor: "#d7ead7",
  },
  resultText: { fontSize: 16, lineHeight: 22 },
  resultHighlight: { fontWeight: "bold" },
});

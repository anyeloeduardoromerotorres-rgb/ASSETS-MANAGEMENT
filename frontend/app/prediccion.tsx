// app/prediccion.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, ScrollView, TextInput, TouchableOpacity, useWindowDimensions } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import api from "../constants/api";
import { CONFIG_INFO_INITIAL_ID } from "../constants/config";
import { computeXIRR } from "../utils/xirrmanual"; // tu función XIRR
import { calculateTotalBalances } from "../utils/calculateTotalBalances";
import TrendRunnerTemporaryBalances from "../components/TrendRunnerTemporaryBalances";
import { useTrendRunnerOpenBalances } from "../utils/useTrendRunnerOpenBalances";

/** Representa un flujo de caja (depósito, retiro, inversión inicial, etc.) */
type CashFlow = { amount: number; when: Date };

/** Representa el balance de un activo individual con su valor en USD */
type Balance = { asset: string; total: number; usdValue: number };

/** Representa los totales de la cartera en USD y PEN */
type Totals = { usd: number; pen: number };

/** Representa un activo traído de la base de datos con su información de inversión */
type AssetFromDB = {
  _id: string;
  symbol: string;
  type: "fiat" | "crypto" | "stock" | "commodity";
  initialInvestment?: number | Record<string, number>;
};

/** Representa una posición en acciones con cantidad de unidades */
type StockHolding = {
  asset: string;
  total: number; // unidades (acciones) guardadas en la base
};

const CASH_LIKE_SYMBOLS = new Set(["SHV"]);

/** Representa el resultado de la proyección financiera a futuro */
type ProjectionResult =
  | { status: "success"; years: number; monthly: number; target: number }
  | { status: "not_reached" }
  | { status: "invalid" }
  | { status: "negative" };

type CapitalSnapshot = {
  _id?: string;
  dateKey: string;
  date?: string;
  totalUsd: number;
  source?: "frontend" | "server";
};

type PeriodKey = "1d" | "1w" | "1m" | "1y" | "5y" | "all";

type GainPeriod = {
  key: PeriodKey;
  label: string;
  shortLabel: string;
  days: number | null;
};

type ChartPoint = CapitalSnapshot & {
  time: number;
};

type PeriodGain = {
  period: GainPeriod;
  startSnapshot: ChartPoint | null;
  endSnapshot: ChartPoint | null;
  gain: number;
  gainPct: number | null;
  points: ChartPoint[];
};

const GAIN_PERIODS: GainPeriod[] = [
  { key: "1d", label: "Un dia", shortLabel: "1D", days: 1 },
  { key: "1w", label: "Una semana", shortLabel: "1S", days: 7 },
  { key: "1m", label: "Un mes", shortLabel: "1M", days: 30 },
  { key: "1y", label: "Un ano", shortLabel: "1A", days: 365 },
  { key: "5y", label: "5 anos", shortLabel: "5A", days: 365 * 5 },
  { key: "all", label: "Desde el primer dia", shortLabel: "Todo", days: null },
];

const CHART_HEIGHT = 190;
const SNAPSHOT_SAVE_INTERVAL_MS = 5 * 60 * 1000;
const SNAPSHOT_SAVE_MIN_DELTA = 1;

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const shortDateFormatter = new Intl.DateTimeFormat("es-PE", {
  day: "2-digit",
  month: "short",
  year: "2-digit",
});

const getLocalDateKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseSnapshotDate = (snapshot: CapitalSnapshot): Date => {
  if (snapshot.date) {
    const parsed = new Date(snapshot.date);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date(`${snapshot.dateKey}T00:00:00`);
};

const toChartPoint = (snapshot: CapitalSnapshot): ChartPoint | null => {
  const totalUsd = Number(snapshot.totalUsd);
  const date = parseSnapshotDate(snapshot);
  if (!snapshot.dateKey || !Number.isFinite(totalUsd) || Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    ...snapshot,
    totalUsd,
    time: date.getTime(),
  };
};

const mergeCapitalSnapshot = (
  history: CapitalSnapshot[],
  snapshot: CapitalSnapshot
): CapitalSnapshot[] => {
  const byDate = new Map<string, CapitalSnapshot>();
  for (const item of history) {
    if (item?.dateKey) byDate.set(item.dateKey, item);
  }
  byDate.set(snapshot.dateKey, snapshot);

  return Array.from(byDate.values()).sort(
    (a, b) => parseSnapshotDate(a).getTime() - parseSnapshotDate(b).getTime()
  );
};

const formatSignedCurrency = (value: number): string => {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${currencyFormatter.format(Math.abs(value))}`;
};

const formatSignedPercent = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return "-";
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${Math.abs(value).toFixed(2)}%`;
};

const formatDateLabel = (snapshot: ChartPoint | null): string =>
  snapshot ? shortDateFormatter.format(new Date(snapshot.time)) : "-";

const buildPeriodGain = (
  history: CapitalSnapshot[],
  period: GainPeriod,
  now = new Date()
): PeriodGain => {
  const points = history
    .map(toChartPoint)
    .filter((point): point is ChartPoint => point !== null)
    .sort((a, b) => a.time - b.time);

  if (points.length === 0) {
    return {
      period,
      startSnapshot: null,
      endSnapshot: null,
      gain: 0,
      gainPct: null,
      points: [],
    };
  }

  const endSnapshot = points[points.length - 1];
  const startTime =
    period.days === null
      ? points[0].time
      : now.getTime() - period.days * 24 * 60 * 60 * 1000;

  const beforeOrAtStart = [...points].reverse().find(point => point.time <= startTime);
  const afterOrAtStart = points.find(point => point.time >= startTime);
  const startSnapshot =
    period.days === null ? points[0] : beforeOrAtStart ?? afterOrAtStart ?? points[0];

  const rangePoints = points.filter(point => point.time >= startSnapshot.time);
  const dedupedPoints = [startSnapshot, ...rangePoints].filter(
    (point, index, arr) => arr.findIndex(item => item.dateKey === point.dateKey) === index
  );

  const gain = endSnapshot.totalUsd - startSnapshot.totalUsd;
  const gainPct = startSnapshot.totalUsd > 0 ? (gain / startSnapshot.totalUsd) * 100 : null;

  return {
    period,
    startSnapshot,
    endSnapshot,
    gain,
    gainPct,
    points: dedupedPoints,
  };
};

function CapitalHistoryChart({
  points,
  width,
  height,
}: {
  points: ChartPoint[];
  width: number;
  height: number;
}) {
  const leftPadding = 12;
  const rightPadding = 12;
  const topPadding = 18;
  const bottomPadding = 26;
  const plotWidth = Math.max(width - leftPadding - rightPadding, 1);
  const plotHeight = Math.max(height - topPadding - bottomPadding, 1);
  const sortedPoints = [...points].sort((a, b) => a.time - b.time);
  const values = sortedPoints.map(point => point.totalUsd);
  const minValue = values.length ? Math.min(...values) : 0;
  const maxValue = values.length ? Math.max(...values) : 0;
  const valueRange = maxValue - minValue;
  const timeMin = sortedPoints[0]?.time ?? 0;
  const timeMax = sortedPoints[sortedPoints.length - 1]?.time ?? timeMin;
  const timeRange = timeMax - timeMin;

  const plotted = sortedPoints.map((point, index) => {
    const x =
      sortedPoints.length === 1
        ? leftPadding + plotWidth / 2
        : leftPadding +
          (timeRange > 0
            ? ((point.time - timeMin) / timeRange) * plotWidth
            : (index / Math.max(sortedPoints.length - 1, 1)) * plotWidth);
    const y =
      valueRange > 0
        ? topPadding + (1 - (point.totalUsd - minValue) / valueRange) * plotHeight
        : topPadding + plotHeight / 2;

    return { ...point, x, y };
  });

  const segments = plotted.slice(1).map((point, index) => {
    const previous = plotted[index];
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    return {
      key: `${previous.dateKey}-${point.dateKey}`,
      left: previous.x + dx / 2 - length / 2,
      top: previous.y + dy / 2 - 1,
      width: length,
      angle,
    };
  });

  return (
    <View>
      <View style={[styles.chartBox, { width, height }]}>
        {[0, 1, 2].map(row => (
          <View
            key={row}
            style={[
              styles.chartGridLine,
              { top: topPadding + (plotHeight / 2) * row, left: leftPadding, width: plotWidth },
            ]}
          />
        ))}

        {segments.map(segment => (
          <View
            key={segment.key}
            style={[
              styles.chartSegment,
              {
                left: segment.left,
                top: segment.top,
                width: segment.width,
                transform: [{ rotate: `${segment.angle}rad` }],
              },
            ]}
          />
        ))}

        {plotted.map(point => (
          <View
            key={point.dateKey}
            style={[styles.chartPoint, { left: point.x - 4, top: point.y - 4 }]}
          />
        ))}

        <Text style={[styles.chartValueLabel, { top: 0, left: leftPadding }]}>
          {currencyFormatter.format(maxValue)}
        </Text>
        <Text style={[styles.chartValueLabel, { bottom: 2, left: leftPadding }]}>
          {currencyFormatter.format(minValue)}
        </Text>
      </View>
    </View>
  );
}

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
  const { width: viewportWidth } = useWindowDimensions();
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
  const [penPrice, setPenPrice] = useState<number | null>(null);
  const [stockHoldings, setStockHoldings] = useState<StockHolding[]>([]);
  const [vooPrice, setVooPrice] = useState<number | null>(null);
  const [usdtSellPrice, setUsdtSellPrice] = useState<number | null>(null);
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});
  const [shvTotal, setShvTotal] = useState(0);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const priceWsRef = useRef<WebSocket | null>(null);
  const snapshotSaveRef = useRef<{ dateKey: string; totalUsd: number; savedAt: number } | null>(null);

  // Flujos de caja para XIRR
  const [initialFlow, setInitialFlow] = useState<CashFlow | null>(null);
  const [flows, setFlows] = useState<CashFlow[]>([]);
  const [capitalHistory, setCapitalHistory] = useState<CapitalSnapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedGainPeriod, setSelectedGainPeriod] = useState<PeriodKey>("1m");
  const { balances: trendRunnerBalances } = useTrendRunnerOpenBalances();
  const trendRunnerBalancesForTotal = useMemo(
    () => trendRunnerBalances.filter((balance) => balance.market !== "crypto"),
    [trendRunnerBalances]
  );

  const fetchCapitalHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const res = await api.get<CapitalSnapshot[]>("/capital-history");
      setCapitalHistory(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Error al traer historial de capital:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

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

      const stocks = (Array.isArray(assetsRes?.data) ? assetsRes.data : []).filter(
        (a: AssetFromDB) => a.type === "stock" && !CASH_LIKE_SYMBOLS.has(a.symbol?.toUpperCase())
      );
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
        const [conf, shvConf] = await Promise.all([
          api.get("/config-info/name/PrecioVentaUSDT"),
          api.get("/config-info/name/totalSHV"),
        ]);
        const price = Number(conf.data?.total);
        const shv = Number(shvConf.data?.total);
        if (Number.isFinite(price)) {
          setUsdtSellPrice(price);
        }
        if (Number.isFinite(shv)) {
          setShvTotal(shv);
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
      fetchCapitalHistory();
    }, [fetchData, fetchCapitalHistory])
  );

  useEffect(() => {
    if (!hasFetchedOnFocus.current) {
      fetchData();
      fetchCapitalHistory();
    }
  }, [fetchData, fetchCapitalHistory]);

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

  const fetchAssetsLikeBalances = useCallback(async () => {
    try {
      const res = await api.get<AssetFromDB[]>("/assets");
      const stocks = res.data.filter(
        (a: AssetFromDB) => a.type === "stock" && !CASH_LIKE_SYMBOLS.has(a.symbol?.toUpperCase())
      );
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
    const symbols = [...stockHoldings.map(s => s.asset), "SHV"].filter(Boolean);
    symbols.forEach(sym => fetchStockPrice(sym));
  }, [stockHoldings, fetchStockPrice]);

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
              setLivePrices(prev => (
                prev[asset] === price ? prev : { ...prev, [asset]: price }
              ));
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
        const [res, shvRes] = await Promise.all([
          api.get("/config-info/name/PrecioVentaUSDT"),
          api.get("/config-info/name/totalSHV"),
        ]);
        const price = Number(res.data?.total);
        const shv = Number(shvRes.data?.total);
        if (Number.isFinite(price)) setUsdtSellPrice(price);
        if (Number.isFinite(shv)) setShvTotal(shv);
      } catch (err) {
        console.error("❌ Error obteniendo PrecioVentaUSDT:", err);
      }
    })();
    const interval = setInterval(() => {
      fetchBalancesLikeBalancesScreen();
      fetchPenPriceLikeBalances();
      fetchVooPriceLikeBalances();
    }, 60 * 1000);

    return () => {
      clearInterval(interval);
      if (priceWsRef.current) try { priceWsRef.current.close(); } catch {}
    };
  }, [fetchBalancesLikeBalancesScreen, fetchPenPriceLikeBalances, fetchVooPriceLikeBalances, fetchAssetsLikeBalances]);

  // Refrescar al enfocar la pantalla
  useFocusEffect(
    useCallback(() => {
      fetchBalancesLikeBalancesScreen();
      fetchPenPriceLikeBalances();
      fetchVooPriceLikeBalances();
      fetchAssetsLikeBalances();
      (async () => {
        try {
          const [res, shvRes] = await Promise.all([
            api.get("/config-info/name/PrecioVentaUSDT"),
            api.get("/config-info/name/totalSHV"),
          ]);
          const price = Number(res.data?.total);
          const shv = Number(shvRes.data?.total);
          if (Number.isFinite(price)) setUsdtSellPrice(price);
          if (Number.isFinite(shv)) setShvTotal(shv);
        } catch {}
      })();
    }, [fetchBalancesLikeBalancesScreen, fetchPenPriceLikeBalances, fetchVooPriceLikeBalances, fetchAssetsLikeBalances])
  );

  // Balances de acciones (VOO usa precio si existe)
  const stockBalances: Balance[] = useMemo(() => {
    return stockHoldings.map((holding) => {
      const isVoo = holding.asset === "VOO";
      const price = isVoo
        ? typeof vooPrice === "number"
          ? vooPrice
          : null
        : typeof stockPrices[holding.asset] === "number"
          ? stockPrices[holding.asset]
          : null;
      const usdValue = price != null ? holding.total * price : holding.total;
      return { asset: holding.asset, total: holding.total, usdValue };
    });
  }, [stockHoldings, vooPrice, stockPrices]);

  const { totalUsd: totalUsdCalculated } = useMemo(
    () =>
      calculateTotalBalances({
        balances,
        totals,
        penPrice,
        usdtSellPrice,
        livePrices,
        additionalBalances: [
          ...stockBalances,
          ...trendRunnerBalancesForTotal,
          {
            asset: "SHV",
            total: shvTotal,
            usdValue:
              typeof stockPrices.SHV === "number" && Number.isFinite(stockPrices.SHV)
                ? shvTotal * stockPrices.SHV
                : 0,
          },
        ],
      }),
    [balances, stockBalances, trendRunnerBalancesForTotal, totals, penPrice, usdtSellPrice, livePrices, shvTotal, stockPrices.SHV]
  );

  // Mantener totalUsd en sync con el cálculo de Balances
  useEffect(() => {
    if (Number.isFinite(totalUsdCalculated)) {
      setTotalUsd(totalUsdCalculated);
    }
  }, [totalUsdCalculated]);

  useEffect(() => {
    if (totalUsd == null || !Number.isFinite(totalUsd) || totalUsd <= 0) return;

    const dateKey = getLocalDateKey();
    const roundedTotal = Number(totalUsd.toFixed(2));
    const now = Date.now();
    const previousSave = snapshotSaveRef.current;
    const shouldSave =
      !previousSave ||
      previousSave.dateKey !== dateKey ||
      (now - previousSave.savedAt >= SNAPSHOT_SAVE_INTERVAL_MS &&
        Math.abs(previousSave.totalUsd - roundedTotal) >= SNAPSHOT_SAVE_MIN_DELTA);

    if (!shouldSave) return;

    snapshotSaveRef.current = { dateKey, totalUsd: roundedTotal, savedAt: now };

    let cancelled = false;
    api
      .post<CapitalSnapshot>("/capital-history", {
        dateKey,
        totalUsd: roundedTotal,
        source: "frontend",
      })
      .then(res => {
        if (cancelled) return;
        const savedSnapshot: CapitalSnapshot = res.data?.dateKey
          ? res.data
          : {
              dateKey,
              date: new Date().toISOString(),
              totalUsd: roundedTotal,
              source: "frontend",
            };
        setCapitalHistory(prev => mergeCapitalSnapshot(prev, savedSnapshot));
      })
      .catch(err => {
        if (!cancelled) {
          console.error("Error guardando capital diario:", err);
          snapshotSaveRef.current = previousSave;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [totalUsd]);

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

  const capitalHistoryWithCurrent = useMemo(() => {
    if (totalUsd == null || !Number.isFinite(totalUsd) || totalUsd <= 0) {
      return capitalHistory;
    }

    return mergeCapitalSnapshot(capitalHistory, {
      dateKey: getLocalDateKey(),
      date: new Date().toISOString(),
      totalUsd: Number(totalUsd.toFixed(2)),
      source: "frontend",
    });
  }, [capitalHistory, totalUsd]);

  const periodGains = useMemo(
    () => GAIN_PERIODS.map(period => buildPeriodGain(capitalHistoryWithCurrent, period)),
    [capitalHistoryWithCurrent]
  );

  const selectedGain =
    periodGains.find(item => item.period.key === selectedGainPeriod) ?? periodGains[2];
  const chartWidth = Math.min(680, Math.max(220, viewportWidth - 56));
  

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

          <TrendRunnerTemporaryBalances title="Trend Runner temporal" balances={trendRunnerBalances} />

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

          <View style={styles.historySection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Avance de ganancias</Text>
              {historyLoading && <ActivityIndicator size="small" />}
            </View>

            <View style={styles.periodTabs}>
              {GAIN_PERIODS.map(period => {
                const active = selectedGainPeriod === period.key;
                return (
                  <TouchableOpacity
                    key={period.key}
                    style={[styles.periodTab, active && styles.periodTabActive]}
                    onPress={() => setSelectedGainPeriod(period.key)}
                  >
                    <Text style={[styles.periodTabText, active && styles.periodTabTextActive]}>
                      {period.shortLabel}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.selectedSummary}>
              <Text style={styles.selectedPeriodLabel}>{selectedGain.period.label}</Text>
              <Text
                style={[
                  styles.selectedGainValue,
                  selectedGain.gain >= 0 ? styles.positiveText : styles.negativeText,
                ]}
              >
                {formatSignedCurrency(selectedGain.gain)}
              </Text>
              <Text style={styles.selectedMeta}>
                {formatDateLabel(selectedGain.startSnapshot)} a {formatDateLabel(selectedGain.endSnapshot)}
                {"  "}({formatSignedPercent(selectedGain.gainPct)})
              </Text>
              <Text style={styles.selectedMeta}>
                Capital actual:{" "}
                {currencyFormatter.format(selectedGain.endSnapshot?.totalUsd ?? totalUsd ?? 0)}
              </Text>
            </View>

            {selectedGain.points.length > 0 ? (
              <>
                <CapitalHistoryChart
                  points={selectedGain.points}
                  width={chartWidth}
                  height={CHART_HEIGHT}
                />
                <View style={[styles.chartDateRow, { width: chartWidth }]}>
                  <Text style={styles.chartDateText}>
                    {formatDateLabel(selectedGain.points[0] ?? null)}
                  </Text>
                  <Text style={styles.chartDateText}>
                    {formatDateLabel(selectedGain.points[selectedGain.points.length - 1] ?? null)}
                  </Text>
                </View>
              </>
            ) : (
              <Text style={styles.emptyHistory}>Todavia no hay historial guardado.</Text>
            )}

            <View style={styles.periodSummaryGrid}>
              {periodGains.map(item => {
                const active = selectedGainPeriod === item.period.key;
                return (
                  <TouchableOpacity
                    key={item.period.key}
                    style={[styles.periodSummaryCard, active && styles.periodSummaryCardActive]}
                    onPress={() => setSelectedGainPeriod(item.period.key)}
                  >
                    <Text style={styles.periodSummaryLabel}>{item.period.label}</Text>
                    <Text
                      style={[
                        styles.periodSummaryValue,
                        item.gain >= 0 ? styles.positiveText : styles.negativeText,
                      ]}
                    >
                      {formatSignedCurrency(item.gain)}
                    </Text>
                    <Text style={styles.periodSummaryPct}>{formatSignedPercent(item.gainPct)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
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
  historySection: {
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  sectionHeaderRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 20, fontWeight: "700", color: "#111827" },
  periodTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  periodTab: {
    minWidth: 46,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  periodTabActive: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  periodTabText: { fontSize: 14, fontWeight: "700", color: "#4b5563" },
  periodTabTextActive: { color: "#1d4ed8" },
  selectedSummary: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 8,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  selectedPeriodLabel: { fontSize: 14, fontWeight: "700", color: "#374151" },
  selectedGainValue: { marginTop: 6, fontSize: 28, fontWeight: "800" },
  selectedMeta: { marginTop: 4, fontSize: 13, color: "#6b7280" },
  positiveText: { color: "#15803d" },
  negativeText: { color: "#b91c1c" },
  chartBox: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  chartGridLine: {
    position: "absolute",
    height: 1,
    backgroundColor: "#edf2f7",
  },
  chartSegment: {
    position: "absolute",
    height: 2,
    borderRadius: 2,
    backgroundColor: "#2563eb",
  },
  chartPoint: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2563eb",
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  chartValueLabel: {
    position: "absolute",
    fontSize: 11,
    color: "#6b7280",
    backgroundColor: "rgba(255,255,255,0.85)",
    paddingRight: 4,
  },
  chartDateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    marginBottom: 14,
  },
  chartDateText: { fontSize: 12, color: "#6b7280" },
  emptyHistory: {
    paddingVertical: 18,
    textAlign: "center",
    color: "#6b7280",
  },
  periodSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 24,
  },
  periodSummaryCard: {
    width: "48%",
    minHeight: 96,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  periodSummaryCardActive: {
    borderColor: "#2563eb",
    backgroundColor: "#f8fbff",
  },
  periodSummaryLabel: { fontSize: 12, fontWeight: "700", color: "#4b5563" },
  periodSummaryValue: { marginTop: 8, fontSize: 17, fontWeight: "800" },
  periodSummaryPct: { marginTop: 4, fontSize: 12, color: "#6b7280" },
});

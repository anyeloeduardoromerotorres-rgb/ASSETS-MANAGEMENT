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

      // 1️⃣ Traer inversión inicial
      const resInit = await api.get(`/config-info/${CONFIG_INFO_INITIAL_ID}`);
      const inversionInicial: CashFlow = {
        amount: -Math.abs(resInit.data.total), // ⚠️ negativo
          when: new Date(resInit.data.createdAt),
        };

        // 2️⃣ Traer depósitos y retiros
        const resFlows = await api.get("/depositewithdrawal");
        const flowsData: any[] = Array.isArray(resFlows.data) ? resFlows.data : [];
        const depositosRetiros: CashFlow[] = flowsData.map((cf: any) => ({
          amount: cf.transaction === "retiro" ? Math.abs(cf.quantity) : -Math.abs(cf.quantity),
          when: new Date(cf.createdAt),
        }));

        // 3️⃣ Preparar cashflows
        const flows = [inversionInicial, ...depositosRetiros];

        // 4️⃣ Calcular total USD actual
        const resBalances = await api.get("/binance/balances");
        const assetsPromise = api.get<AssetFromDB[]>("/assets");
        const penRatePromise = fetch("https://open.er-api.com/v6/latest/PEN")
          .then(res => res.json())
          .then(data => (data.result === "success" && data.rates?.USD ? data.rates.USD : null))
          .catch(() => null);
        const vooPricePromise = fetch("https://query1.finance.yahoo.com/v8/finance/chart/VOO")
          .then(res => res.json())
          .then(data => data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null)
          .catch(() => null);

        const [resAssets, penRate, vooPrice] = await Promise.all([
          assetsPromise,
          penRatePromise,
          vooPricePromise,
        ]);

        const balances: Balance[] = resBalances.data.balances;
        const totals: Totals = resBalances.data.totals;
        const assetsData = Array.isArray(resAssets.data) ? resAssets.data : [];
        const stockUsd = assetsData
          .filter(asset => asset.type === "stock")
          .reduce((acc, asset) => {
            let amount = 0;

            if (typeof asset.initialInvestment === "number") {
              amount = asset.initialInvestment;
            } else if (asset.initialInvestment) {
              if (typeof asset.initialInvestment["USD"] === "number") {
                amount = asset.initialInvestment["USD"];
              } else if (typeof (asset.initialInvestment as any).amount === "number") {
                amount = (asset.initialInvestment as any).amount;
              }
            }

            if (asset.symbol === "VOO" && typeof vooPrice === "number") {
              return acc + amount * vooPrice;
            }

            return acc + amount;
          }, 0);

        const totalUSD =
          balances.reduce((acc, b) => acc + b.usdValue, 0) +
          totals.usd +
          (penRate ? totals.pen * penRate : 0) +
          stockUsd;
        setTotalUsd(totalUSD);

        // 5️⃣ Determinar si usamos CAGR o XIRR
        const entradas = flows.filter(f => f.amount < 0).length;
        const salidas = flows.filter(f => f.amount > 0).length;

        const totalDepositos = flows
          .filter(f => f.amount < 0)
          .reduce((acc, f) => acc + Math.abs(f.amount), 0);
        const totalRetiros = flows
          .filter(f => f.amount > 0)
          .reduce((acc, f) => acc + f.amount, 0);
        const retiroPct = totalDepositos > 0 ? totalRetiros / totalDepositos : 0;
        setWithdrawPercentage(retiroPct);

        if (entradas < 1 || salidas < 1) {
          // CAGR
          const startValue = Math.abs(inversionInicial.amount);
          const endValue = totalUSD;
          const startDate = inversionInicial.when;
          const endDate = new Date();
          const years = (endDate.getTime() - startDate.getTime()) / (365 * 24 * 3600 * 1000);
          const cagr = Math.pow(endValue / startValue, 1 / years) - 1;
          setXirr(cagr);
        } else {
          // XIRR
          const xirrResult = computeXIRR(flows);
          setXirr(xirrResult);
        }
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
    if (!startInitialized && totalUsd !== null) {
      setStartOfYear(totalUsd.toFixed(2));
      setStartInitialized(true);
    }
  }, [startInitialized, totalUsd]);

  useEffect(() => {
    if (!rentInitialized && xirr !== null) {
      setRentabilidadInput((xirr * 100).toFixed(2));
      setRentInitialized(true);
    }
  }, [rentInitialized, xirr]);

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
                if (startOfYear === defaultStartValue) {
                  setStartOfYear("");
                }
              }}
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
                if (rentabilidadInput === defaultRentValue) {
                  setRentabilidadInput("");
                }
              }}
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

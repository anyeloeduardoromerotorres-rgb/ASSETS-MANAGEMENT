// app/prediccion.tsx
import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, ScrollView } from "react-native";
import api from "../constants/api";
import { computeXIRR } from "../utils/xirrmanual"; // tu función XIRR

type CashFlow = { amount: number; when: Date };
type Balance = { asset: string; total: number; usdValue: number };
type Totals = { usd: number; pen: number };

export default function PrediccionScreen() {
  const [loading, setLoading] = useState(true);
  const [totalUsd, setTotalUsd] = useState<number | null>(null);
  const [xirr, setXirr] = useState<number | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // 1️⃣ Traer inversión inicial
        const resInit = await api.get("/api/config-info/68c7955b5b8d3693b916d59a");
        const inversionInicial: CashFlow = {
          amount: -Math.abs(resInit.data.total), // ⚠️ negativo
          when: new Date(resInit.data.createdAt),
        };

        // 2️⃣ Traer depósitos y retiros
        const resFlows = await api.get("/api/deposits-withdrawals");
        const depositosRetiros: CashFlow[] = resFlows.data.map((cf: any) => ({
          amount: cf.transaction === "retiro" ? Math.abs(cf.quantity) : -Math.abs(cf.quantity),
          when: new Date(cf.createdAt),
        }));

        // 3️⃣ Preparar cashflows
        const flows = [inversionInicial, ...depositosRetiros];

        // 4️⃣ Calcular total USD actual
        const resBalances = await api.get("/api/binance/balances");
        const balances: Balance[] = resBalances.data.balances;
        const totals: Totals = resBalances.data.totals;
        const totalUSD = balances.reduce((acc, b) => acc + b.usdValue, 0) + totals.usd;
        setTotalUsd(totalUSD);

        // 5️⃣ Determinar si usamos CAGR o XIRR
        const entradas = flows.filter(f => f.amount < 0).length;
        const salidas = flows.filter(f => f.amount > 0).length;

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
    };

    fetchData();
  }, []);

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
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 12 },
  text: { fontSize: 18, marginBottom: 8 },
});

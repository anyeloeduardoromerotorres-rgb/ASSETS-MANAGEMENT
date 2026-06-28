import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import api from "../constants/api";

type TrendBalance = {
  asset: string;
  total: number;
  usdValue: number;
  market: "etf" | "stock" | "adr" | "crypto";
  temporary?: boolean;
};

type Props = {
  title?: string;
  includeCrypto?: boolean;
};

const fmt = (value: number, decimals = 2) =>
  Number.isFinite(value) ? value.toFixed(decimals) : "-";

export default function TrendRunnerTemporaryBalances({
  title = "Posiciones temporales Trend Runner",
  includeCrypto = true,
}: Props) {
  const [balances, setBalances] = useState<TrendBalance[]>([]);
  const [loading, setLoading] = useState(false);

  const loadBalances = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<TrendBalance[]>("/trend-runner/balances/open");
      const rows = Array.isArray(res.data) ? res.data : [];
      setBalances(includeCrypto ? rows : rows.filter((row) => row.market !== "crypto"));
    } catch (error) {
      setBalances([]);
    } finally {
      setLoading(false);
    }
  }, [includeCrypto]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  useFocusEffect(
    useCallback(() => {
      loadBalances();
    }, [loadBalances])
  );

  if (loading && balances.length === 0) {
    return (
      <View style={styles.box}>
        <ActivityIndicator size="small" />
      </View>
    );
  }

  if (!balances.length) return null;

  return (
    <View style={styles.box}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>
        Informativo: no modifica la asignacion principal de ASSETS-MANAGEMENT.
      </Text>
      {balances.map((balance) => (
        <View key={balance.asset} style={styles.row}>
          <View>
            <Text style={styles.symbol}>{balance.asset}</Text>
            <Text style={styles.market}>{balance.market.toUpperCase()}</Text>
          </View>
          <View style={styles.values}>
            <Text style={styles.amount}>{fmt(balance.total, 8)}</Text>
            <Text style={styles.usd}>${fmt(balance.usdValue)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#dce3eb",
    backgroundColor: "#f8fbff",
    padding: 12,
    gap: 8,
    marginTop: 12,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0d47a1",
  },
  note: {
    fontSize: 12,
    color: "#607d8b",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#e3edf7",
    paddingTop: 8,
  },
  symbol: {
    fontSize: 15,
    fontWeight: "800",
    color: "#263238",
  },
  market: {
    fontSize: 12,
    color: "#607d8b",
  },
  values: {
    alignItems: "flex-end",
  },
  amount: {
    fontSize: 14,
    color: "#263238",
  },
  usd: {
    fontSize: 13,
    color: "#2e7d32",
    fontWeight: "700",
  },
});

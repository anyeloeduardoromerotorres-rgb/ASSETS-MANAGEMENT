import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import api from "../constants/api";
import type { BalanceEntry } from "./calculateTotalBalances";

export type TrendRunnerOpenBalance = BalanceEntry & {
  openValueFiat?: number;
  unrealizedUsd?: number;
  currentPrice?: number | null;
  market?: "etf" | "stock" | "adr" | "crypto";
  temporary?: boolean;
};

type Options = {
  includeCrypto?: boolean;
  enabled?: boolean;
};

export function useTrendRunnerOpenBalances({
  includeCrypto = true,
  enabled = true,
}: Options = {}) {
  const [balances, setBalances] = useState<TrendRunnerOpenBalance[]>([]);
  const [loading, setLoading] = useState(false);

  const loadBalances = useCallback(async () => {
    if (!enabled) return;

    try {
      setLoading(true);
      const res = await api.get<TrendRunnerOpenBalance[]>("/trend-runner/balances/open");
      const rows = Array.isArray(res.data) ? res.data : [];
      setBalances(includeCrypto ? rows : rows.filter((row) => row.market !== "crypto"));
    } catch {
      setBalances([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, includeCrypto]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  useFocusEffect(
    useCallback(() => {
      loadBalances();
    }, [loadBalances])
  );

  return {
    balances,
    loading,
    refresh: loadBalances,
  };
}

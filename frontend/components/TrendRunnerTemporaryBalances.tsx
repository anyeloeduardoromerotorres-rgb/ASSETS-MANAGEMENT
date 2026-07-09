import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { TrendRunnerOpenBalance, useTrendRunnerOpenBalances } from "../utils/useTrendRunnerOpenBalances";

type TrendBalance = TrendRunnerOpenBalance;

type Props = {
  title?: string;
  includeCrypto?: boolean;
  balances?: TrendBalance[];
};

const fmt = (value: number, decimals = 2) =>
  Number.isFinite(value) ? value.toFixed(decimals) : "-";

export default function TrendRunnerTemporaryBalances({
  title = "Posiciones temporales Trend Runner",
  includeCrypto = true,
  balances: externalBalances,
}: Props) {
  const { balances: fetchedBalances, loading } = useTrendRunnerOpenBalances({
    includeCrypto,
    enabled: externalBalances == null,
  });
  const rawBalances = externalBalances ?? fetchedBalances;
  const balances = includeCrypto
    ? rawBalances
    : rawBalances.filter((balance) => balance.market !== "crypto");
  const totalCurrentUsd = balances.reduce((sum, balance) => sum + balance.usdValue, 0);
  const totalUnrealizedUsd = balances.reduce(
    (sum, balance) => sum + (balance.unrealizedUsd ?? 0),
    0
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
        Valor actual de posiciones abiertas. Se incluye en el Total USD; la asignacion principal sigue separada.
      </Text>
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total actual</Text>
        <View style={styles.values}>
          <Text style={styles.totalValue}>${fmt(totalCurrentUsd)}</Text>
          <Text style={[styles.pnl, totalUnrealizedUsd >= 0 ? styles.pnlPositive : styles.pnlNegative]}>
            PnL ${fmt(totalUnrealizedUsd)}
          </Text>
        </View>
      </View>
      {balances.map((balance) => (
        <View key={balance.asset} style={styles.row}>
          <View>
            <Text style={styles.symbol}>{balance.asset}</Text>
            <Text style={styles.market}>{balance.market ? balance.market.toUpperCase() : "TREND"}</Text>
          </View>
          <View style={styles.values}>
            <Text style={styles.amount}>{fmt(balance.total, 8)}</Text>
            <Text style={styles.usd}>${fmt(balance.usdValue)}</Text>
            <Text style={styles.price}>
              Precio {balance.currentPrice ? `$${fmt(balance.currentPrice, 6)}` : "-"}
            </Text>
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
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#d5e5f6",
    paddingTop: 8,
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: "#263238",
  },
  totalValue: {
    fontSize: 15,
    color: "#0d47a1",
    fontWeight: "800",
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
  price: {
    fontSize: 12,
    color: "#607d8b",
  },
  pnl: {
    fontSize: 12,
    fontWeight: "700",
  },
  pnlPositive: {
    color: "#2e7d32",
  },
  pnlNegative: {
    color: "#b71c1c",
  },
});

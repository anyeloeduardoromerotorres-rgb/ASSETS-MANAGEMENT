import { View, Text, StyleSheet } from "react-native";

export default function BalancesScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>📊 Balances</Text>
      <Text>Aquí verás tus balances y precios en tiempo real.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 10,
  },
});

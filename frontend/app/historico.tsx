import { View, Text, StyleSheet } from "react-native";


export default function HistoricoScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>📈 Histórico</Text>
      <Text>Aquí se mostrará el historial de precios.</Text>
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

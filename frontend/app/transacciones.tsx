import { View, Text, StyleSheet } from "react-native";


export default function PrediccionScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>🔮 Predicción</Text>
      <Text>Aquí se mostrarán análisis y predicciones.</Text>
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
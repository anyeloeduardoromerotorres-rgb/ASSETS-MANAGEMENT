import { useState } from "react";
import { View, Text, StyleSheet, Button, TextInput, Alert } from "react-native";
import { Picker } from "@react-native-picker/picker";
import { INITIAL_CAPITAL } from "../constants/config";
import api from "../constants/api"; // 👈 importamos la instancia

export default function InversionesScreen() {
  const [mode, setMode] = useState<"deposit" | "withdraw" | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "PEN">("USD");

  const handleAdd = async () => {
    if (!amount || isNaN(Number(amount))) {
      Alert.alert("Error", "Por favor ingresa un número válido.");
      return;
    }

    try {
      const res = await api.post("/depositewithdrawal", {
        transaction: mode === "deposit" ? "Deposito" : "Retiro",
        quantity: amount,
        currency, // "USD" o "PEN"
      });

      Alert.alert(
        "Éxito",
        `${mode === "deposit" ? "Depósito" : "Retiro"} guardado`
      );
    } catch (error: any) {
      console.error(error);
      Alert.alert(
        "Error",
        error.response?.data?.error || "No se pudo guardar la transacción"
      );
    }

    // Reiniciar estado
    setAmount("");
    setCurrency("USD");
    setMode(null);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📊 Inversiones</Text>
      <Text style={styles.capital}>
        Capital inicial: ${INITIAL_CAPITAL.toFixed(2)}
      </Text>

      {mode === null ? (
        <View style={styles.buttonsRow}>
          <View style={styles.buttonWrapper}>
            <Button title="➕ Agregar Depósito" onPress={() => setMode("deposit")} />
          </View>
          <View style={styles.buttonWrapper}>
            <Button title="➖ Agregar Retiro" onPress={() => setMode("withdraw")} />
          </View>
        </View>
      ) : (
        <View>
          <TextInput
            style={styles.input}
            placeholder="Ingresa un monto"
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
          />

          {/* Menú desplegable de moneda */}
          <Picker selectedValue={currency} onValueChange={setCurrency}>
            <Picker.Item label="USD" value="USD" />
            <Picker.Item label="PEN" value="PEN" />
          </Picker>

          <Button
            title={mode === "deposit" ? "Agregar Depósito" : "Agregar Retiro"}
            onPress={handleAdd}
          />
          <Button
            title="⬅️ Volver"
            color="gray"
            onPress={() => {
              setAmount("");
              setCurrency("USD");
              setMode(null);
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 15 },
  capital: { fontSize: 18, marginBottom: 20 },
  buttonsRow: { flexDirection: "row", justifyContent: "space-between" },
  buttonWrapper: { flex: 1, marginHorizontal: 5 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 10,
    marginBottom: 10,
    borderRadius: 5,
    fontSize: 16,
  },
});

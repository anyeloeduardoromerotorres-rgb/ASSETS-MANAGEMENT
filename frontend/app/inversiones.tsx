import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Button,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { Picker } from "@react-native-picker/picker";
import { CONFIG_INFO_INITIAL_ID } from "../constants/config";
import api from "../constants/api";

type Investment = {
  _id?: string;
  transaction: "Deposito" | "Retiro";
  quantity: number;
  currency?: "USD" | "PEN";
  createdAt?: string;
};

export default function InversionesScreen() {
  const [mode, setMode] = useState<"deposit" | "withdraw" | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "PEN">("USD");
  const [editingId, setEditingId] = useState<string | null>(null);

  const [investments, setInvestments] = useState<Investment[] | null>(null);
  const [loadingInvestments, setLoadingInvestments] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [initialCapital, setInitialCapital] = useState<number | null>(null);

  useEffect(() => {
    fetchInitialCapital();
    fetchInvestments();
  }, []);

  const totalCapital = useMemo(() => {
    if (initialCapital === null) return null;
    if (!investments) return initialCapital;
    const deposits = investments
      .filter((inv) => inv.transaction === "Deposito")
      .reduce((acc, inv) => acc + Number(inv.quantity), 0);
    const withdrawals = investments
      .filter((inv) => inv.transaction === "Retiro")
      .reduce((acc, inv) => acc + Number(inv.quantity), 0);
    return initialCapital + deposits - withdrawals;
  }, [initialCapital, investments]);

  const fetchInitialCapital = async () => {
    try {
      const res = await api.get(`/config-info/${CONFIG_INFO_INITIAL_ID}`);
      const total = Number(res.data?.total);
      if (!isNaN(total)) {
        setInitialCapital(total);
      } else {
        setInitialCapital(0);
      }
    } catch (err) {
      console.error("Error al obtener capital inicial:", err);
      setInitialCapital(0);
    }
  };

  const handleUpdate = async () => {
    if (!editingId) return;
    if (!amount || isNaN(Number(amount))) {
      Alert.alert("Error", "Por favor ingresa un número válido.");
      return;
    }
    try {
      await api.put(`/depositewithdrawal/${editingId}`,
        {
          transaction: mode === "deposit" ? "Deposito" : "Retiro",
          quantity: Number(amount),
          currency,
        }
      );
      Alert.alert("Éxito", "Transacción actualizada");
      await fetchInvestments();
    } catch (err: any) {
      console.error("Error actualizando transacción:", err);
      Alert.alert("Error", err?.response?.data?.error ?? "No se pudo actualizar la transacción");
    }
    setAmount("");
    setCurrency("USD");
    setMode(null);
    setEditingId(null);
  };

  const handleAdd = async () => {
    if (!amount || isNaN(Number(amount))) {
      Alert.alert("Error", "Por favor ingresa un número válido.");
      return;
    }

    try {
      await api.post("/depositewithdrawal", {
        transaction: mode === "deposit" ? "Deposito" : "Retiro",
        quantity: Number(amount),
        currency,
      });

      Alert.alert("Éxito", `${mode === "deposit" ? "Depósito" : "Retiro"} guardado`);
      await fetchInvestments();
    } catch (err: any) {
      console.error("Error guardando transacción:", err);
      Alert.alert("Error", err?.response?.data?.error ?? "No se pudo guardar la transacción");
    }

    setAmount("");
    setCurrency("USD");
    setMode(null);
    setEditingId(null);
  };

  const fetchInvestments = async () => {
    setLoadingInvestments(true);
    setLoadError(null);
    try {
      const res = await api.get("/depositewithdrawal");
      if (!Array.isArray(res.data)) throw new Error("Respuesta inválida del servidor");
      setInvestments(res.data);
    } catch (err: any) {
      console.error("Error al cargar inversiones:", err);
      setLoadError(err?.message ?? "Network Error");
      setInvestments([]);
    } finally {
      setLoadingInvestments(false);
    }
  };

  const startEdit = (inv: Investment) => {
    setEditingId(inv._id ?? null);
    setMode(inv.transaction === "Deposito" ? "deposit" : "withdraw");
    setAmount(String(inv.quantity ?? ""));
    setCurrency((inv.currency as any) ?? "USD");
  };

  const handleDelete = async (inv: Investment) => {
    if (!inv._id) return;
    Alert.alert(
      "Confirmar",
      "¿Deseas eliminar esta transacción?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              await api.delete(`/depositewithdrawal/${inv._id}`);
              await fetchInvestments();
            } catch (err: any) {
              console.error("Error eliminando transacción:", err);
              Alert.alert("Error", err?.response?.data?.error ?? "No se pudo eliminar");
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📊 Inversiones</Text>
      <Text style={styles.capital}>
        Capital inicial: {initialCapital !== null ? `$${initialCapital.toFixed(2)}` : "Cargando..."}
      </Text>
      <Text style={styles.totalCapital}>
        Capital total: {totalCapital !== null ? `$${totalCapital.toFixed(2)}` : "Cargando..."}
      </Text>

      {mode === null ? (
        <>
          <View style={styles.buttonsRow}>
            <View style={styles.buttonWrapper}>
              <Button title="➕ Agregar Depósito" onPress={() => setMode("deposit")} />
            </View>
            <View style={styles.buttonWrapper}>
              <Button title="➖ Agregar Retiro" onPress={() => setMode("withdraw")} />
            </View>
          </View>

          <View style={{ marginTop: 12 }}>
            {loadingInvestments && (
              <View style={styles.centerRow}>
                <ActivityIndicator />
                <Text style={{ marginLeft: 8 }}>Cargando inversiones...</Text>
              </View>
            )}

            {loadError && <Text style={styles.error}>Error: {loadError}</Text>}

            {investments && investments.length === 0 && !loadingInvestments && (
              <Text style={styles.empty}>No hay inversiones registradas</Text>
            )}

            {investments && investments.length > 0 && (
              <ScrollView style={{ marginTop: 12 }}>
                <View style={styles.columnsWrapper}>
                  {/* Columna de Depósitos */}
                  <View style={styles.column}>
                    <Text style={styles.columnTitle}>💰 Depósitos</Text>
                    {investments
                      .filter((inv) => inv.transaction === "Deposito")
                      .map((inv, idx) => (
                        <View key={inv._id ?? `dep-${idx}`} style={styles.itemRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.itemText}>
                              {inv.currency ?? "USD"} {Number(inv.quantity).toFixed(2)}
                            </Text>
                            {inv.createdAt && (
                              <Text style={styles.date}>
                                {new Date(inv.createdAt).toLocaleString()}
                              </Text>
                            )}
                          </View>
                          <View style={styles.actions}>
                            <TouchableOpacity onPress={() => startEdit(inv)}>
                              <Text style={styles.actionIcon}>✏️</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDelete(inv)}>
                              <Text style={[styles.actionIcon, { marginLeft: 8 }]}>🗑️</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                  </View>

                  {/* Columna de Retiros */}
                  <View style={styles.column}>
                    <Text style={styles.columnTitle}>💸 Retiros</Text>
                    {investments
                      .filter((inv) => inv.transaction === "Retiro")
                      .map((inv, idx) => (
                        <View key={inv._id ?? `ret-${idx}`} style={styles.itemRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.itemText}>
                              {inv.currency ?? "USD"} {Number(inv.quantity).toFixed(2)}
                            </Text>
                            {inv.createdAt && (
                              <Text style={styles.date}>
                                {new Date(inv.createdAt).toLocaleString()}
                              </Text>
                            )}
                          </View>
                          <View style={styles.actions}>
                            <TouchableOpacity onPress={() => startEdit(inv)}>
                              <Text style={styles.actionIcon}>✏️</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDelete(inv)}>
                              <Text style={[styles.actionIcon, { marginLeft: 8 }]}>🗑️</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                  </View>
                </View>
              </ScrollView>
            )}
          </View>
        </>
      ) : (
        <View>
          <Text style={{ fontSize: 16, fontWeight: "bold", marginBottom: 8 }}>
            {editingId
              ? `Editar ${mode === "deposit" ? "Depósito" : "Retiro"}`
              : mode === "deposit"
              ? "Nuevo Depósito"
              : "Nuevo Retiro"}
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Monto"
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
          />
          <Picker selectedValue={currency} onValueChange={(val) => setCurrency(val)}>
            <Picker.Item label="USD" value="USD" />
            <Picker.Item label="PEN" value="PEN" />
          </Picker>
          <Button title={editingId ? "Actualizar" : "Guardar"} onPress={editingId ? handleUpdate : handleAdd} />
          <Button
            title="Cancelar"
            color="gray"
            onPress={() => {
              setMode(null);
              setEditingId(null);
              setAmount("");
              setCurrency("USD");
            }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  title: { fontSize: 22, fontWeight: "bold", marginBottom: 10 },
  capital: { fontSize: 16, marginBottom: 4 },
  totalCapital: { fontSize: 18, fontWeight: "bold", marginBottom: 10 },
  buttonsRow: { flexDirection: "row", justifyContent: "space-between" },
  buttonWrapper: { flex: 1, marginHorizontal: 5 },
  centerRow: { flexDirection: "row", alignItems: "center" },
  error: { color: "red" },
  empty: { textAlign: "center", marginTop: 10, fontStyle: "italic" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    padding: 10,
    marginTop: 8,
    marginBottom: 12,
  },
  itemRow: {
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  itemText: { fontSize: 14 },
  date: { fontSize: 12, color: "#555" },
  columnsWrapper: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 8,
  },
  actionIcon: {
    fontSize: 16,
  },
  column: {
    flex: 1,
    padding: 5,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    minHeight: 50,
  },
  columnTitle: {
    fontWeight: "bold",
    fontSize: 16,
    marginBottom: 6,
    textAlign: "center",
  },
});

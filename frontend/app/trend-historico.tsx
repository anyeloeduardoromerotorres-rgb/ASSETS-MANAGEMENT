import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import api from "../constants/api";

type TrendPosition = {
  _id: string;
  symbol: string;
  market: "etf" | "stock" | "adr" | "crypto";
  broker: string;
  fiatCurrency: string;
  capitalSource?: string;
  requiresShvSale?: boolean;
  openDate: string;
  openPrice: number;
  amount: number;
  openValueFiat: number;
  openFee?: number;
  closeDate?: string;
  closePrice?: number;
  closeValueFiat?: number;
  closeFee?: number;
  closeReason?: string;
  profitPercent?: number;
  profitTotalFiat?: number;
  status: "open" | "closed";
  strategy?: {
    signalType?: string;
    hold?: { score?: number };
    initialStop?: number;
    tp1Price?: number;
    runnerStop?: number;
    tp1QtyPct?: number;
    trailAtr?: number;
    qtyTp1?: number;
    qtyRunner?: number;
    tp1Reached?: boolean;
  };
  notes?: string;
};

type CloseForm = {
  closeDate: string;
  closePrice: string;
  closeAmount: string;
  closeValueFiat: string;
  closeFee: string;
  closeFeeCurrency: string;
  closeReason: string;
};

type EditForm = {
  broker: string;
  openDate: string;
  openPrice: string;
  amount: string;
  openValueFiat: string;
  openFee: string;
  closeDate: string;
  closePrice: string;
  closeValueFiat: string;
  closeFee: string;
  closeReason: string;
  notes: string;
};

const fmt = (value?: number, decimals = 2) =>
  Number.isFinite(value) ? Number(value).toFixed(decimals) : "-";

const parseInput = (value: string) => {
  const parsed = Number(value.replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : NaN;
};

const formatDate = (value?: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
};

function defaultCloseForm(position: TrendPosition): CloseForm {
  const price = position.closePrice ?? position.openPrice;
  const value = price * position.amount;

  return {
    closeDate: new Date().toISOString(),
    closePrice: price ? String(Number(price.toFixed(8))) : "",
    closeAmount: position.amount ? String(Number(position.amount.toFixed(8))) : "",
    closeValueFiat: value ? String(Number(value.toFixed(8))) : "",
    closeFee: "0",
    closeFeeCurrency: position.fiatCurrency,
    closeReason: "manual",
  };
}

function defaultEditForm(position: TrendPosition): EditForm {
  return {
    broker: position.broker ?? "",
    openDate: position.openDate ?? "",
    openPrice: String(position.openPrice ?? ""),
    amount: String(position.amount ?? ""),
    openValueFiat: String(position.openValueFiat ?? ""),
    openFee: String(position.openFee ?? 0),
    closeDate: position.closeDate ?? "",
    closePrice: position.closePrice != null ? String(position.closePrice) : "",
    closeValueFiat: position.closeValueFiat != null ? String(position.closeValueFiat) : "",
    closeFee: String(position.closeFee ?? 0),
    closeReason: position.closeReason ?? "",
    notes: position.notes ?? "",
  };
}

export default function TrendRunnerHistoryScreen() {
  const [positions, setPositions] = useState<TrendPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [selected, setSelected] = useState<TrendPosition | null>(null);
  const [closeForm, setCloseForm] = useState<CloseForm | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadPositions = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const res = await api.get<TrendPosition[]>("/trend-runner/positions");
      setPositions(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Error cargando posiciones Trend Runner", error);
      Alert.alert("Error", "No se pudieron cargar las posiciones Trend Runner.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  useFocusEffect(
    useCallback(() => {
      loadPositions({ silent: true });
    }, [loadPositions])
  );

  const filtered = useMemo(() => {
    return positions.filter((position) => filter === "all" || position.status === filter);
  }, [positions, filter]);

  const totals = useMemo(() => {
    const openCapital = positions
      .filter((position) => position.status === "open")
      .reduce((sum, position) => sum + (position.openValueFiat || 0), 0);
    const closedProfit = positions
      .filter((position) => position.status === "closed")
      .reduce((sum, position) => sum + (position.profitTotalFiat || 0), 0);

    return { openCapital, closedProfit };
  }, [positions]);

  const openCloseModal = (position: TrendPosition) => {
    setSelected(position);
    setCloseForm(defaultCloseForm(position));
    setEditForm(null);
  };

  const openEditModal = (position: TrendPosition) => {
    setSelected(position);
    setEditForm(defaultEditForm(position));
    setCloseForm(null);
  };

  const closeModal = () => {
    setSelected(null);
    setCloseForm(null);
    setEditForm(null);
  };

  const submitClose = async () => {
    if (!selected || !closeForm) return;

    const closePrice = parseInput(closeForm.closePrice);
    const closeAmount = parseInput(closeForm.closeAmount);
    const closeValueFiat = parseInput(closeForm.closeValueFiat);
    const closeFee = parseInput(closeForm.closeFee);

    if (closePrice <= 0 || closeAmount <= 0 || closeValueFiat <= 0) {
      Alert.alert("Datos invalidos", "Precio, cantidad y valor deben ser mayores a cero.");
      return;
    }

    try {
      setSubmitting(true);
      await api.put(`/trend-runner/positions/${selected._id}/close`, {
        closeDate: closeForm.closeDate,
        closePrice,
        closeAmount,
        closeValueFiat,
        closeFee: Number.isFinite(closeFee) ? closeFee : 0,
        closeFeeCurrency: closeForm.closeFeeCurrency,
        closeReason: closeForm.closeReason,
      });
      closeModal();
      await loadPositions({ silent: true });
    } catch (error: any) {
      Alert.alert("Error", error?.response?.data?.error ?? "No se pudo cerrar la posicion.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async () => {
    if (!selected || !editForm) return;

    const payload: Record<string, unknown> = {
      broker: editForm.broker,
      openDate: editForm.openDate,
      notes: editForm.notes,
    };

    [
      "openPrice",
      "amount",
      "openValueFiat",
      "openFee",
      "closePrice",
      "closeValueFiat",
      "closeFee",
    ].forEach((field) => {
      const value = parseInput((editForm as any)[field]);
      if (Number.isFinite(value)) payload[field] = value;
    });

    if (editForm.closeDate) payload.closeDate = editForm.closeDate;
    if (editForm.closeReason) payload.closeReason = editForm.closeReason;

    try {
      setSubmitting(true);
      await api.put(`/trend-runner/positions/${selected._id}`, payload);
      closeModal();
      await loadPositions({ silent: true });
    } catch (error: any) {
      Alert.alert("Error", error?.response?.data?.error ?? "No se pudo editar la posicion.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trend Runner - Historico</Text>

      <View style={styles.summary}>
        <Text style={styles.summaryText}>Capital abierto: ${fmt(totals.openCapital)}</Text>
        <Text
          style={[
            styles.summaryText,
            totals.closedProfit >= 0 ? styles.profit : styles.loss,
          ]}
        >
          Ganancia cerrada: ${fmt(totals.closedProfit)}
        </Text>
      </View>

      <View style={styles.filterRow}>
        {[
          ["all", "Todas"],
          ["open", "Abiertas"],
          ["closed", "Cerradas"],
        ].map(([key, label]) => (
          <Text
            key={key}
            style={[styles.chip, filter === key && styles.chipActive]}
            onPress={() => setFilter(key as typeof filter)}
          >
            {label}
          </Text>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={filtered.length ? styles.list : styles.emptyList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadPositions({ silent: true });
            }}
          />
        }
      >
        {filtered.length === 0 ? (
          <Text style={styles.empty}>No hay posiciones Trend Runner.</Text>
        ) : (
          filtered.map((position) => (
            <View key={position._id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.symbol}>{position.symbol}</Text>
                  <Text style={styles.meta}>
                    {position.market.toUpperCase()} · {position.broker} · {position.fiatCurrency}
                  </Text>
                </View>
                <Text style={[styles.status, position.status === "closed" ? styles.closed : styles.open]}>
                  {position.status === "closed" ? "Cerrada" : "Abierta"}
                </Text>
              </View>

              <Text style={styles.rowText}>Apertura: {formatDate(position.openDate)}</Text>
              <Text style={styles.rowText}>Precio: {fmt(position.openPrice, 6)} · Cantidad: {fmt(position.amount, 8)}</Text>
              <Text style={styles.rowText}>Valor apertura: {position.fiatCurrency} {fmt(position.openValueFiat)}</Text>
              <Text style={styles.rowText}>Senal: {position.strategy?.signalType ?? "-"} · Hold {fmt(position.strategy?.hold?.score, 1)}</Text>
              <Text style={styles.rowText}>Stop: {fmt(position.strategy?.initialStop, 6)} · TP1: {fmt(position.strategy?.tp1Price, 6)} · Runner: {fmt(position.strategy?.runnerStop, 6)}</Text>
              <Text style={styles.rowText}>TP1 qty: {fmt(position.strategy?.qtyTp1, 8)} · Runner qty: {fmt(position.strategy?.qtyRunner, 8)}</Text>
              {position.requiresShvSale ? (
                <Text style={styles.warning}>Esta posicion requirio vender SHV.</Text>
              ) : null}

              {position.status === "closed" ? (
                <>
                  <Text style={styles.rowText}>Cierre: {formatDate(position.closeDate)}</Text>
                  <Text style={styles.rowText}>Precio cierre: {fmt(position.closePrice, 6)} · Valor cierre: {position.fiatCurrency} {fmt(position.closeValueFiat)}</Text>
                  <Text style={[styles.rowText, (position.profitTotalFiat ?? 0) >= 0 ? styles.profit : styles.loss]}>
                    PnL: {position.fiatCurrency} {fmt(position.profitTotalFiat)} · {fmt(position.profitPercent)}%
                  </Text>
                  <Text style={styles.rowText}>Motivo: {position.closeReason ?? "-"}</Text>
                </>
              ) : null}

              <View style={styles.actions}>
                {position.status === "open" ? (
                  <TouchableOpacity style={styles.primaryButton} onPress={() => openCloseModal(position)}>
                    <Text style={styles.buttonText}>Cerrar parcial/total</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.secondaryButton} onPress={() => openEditModal(position)}>
                  <Text style={styles.buttonText}>Editar</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>
                {closeForm ? "Cerrar posicion" : "Editar posicion"} {selected?.symbol}
              </Text>

              {closeForm ? (
                <>
                  <Text style={styles.label}>Fecha cierre</Text>
                  <TextInput style={styles.input} value={closeForm.closeDate} onChangeText={(value) => setCloseForm({ ...closeForm, closeDate: value })} />
                  <Text style={styles.label}>Precio cierre</Text>
                  <TextInput style={styles.input} value={closeForm.closePrice} onChangeText={(value) => setCloseForm({ ...closeForm, closePrice: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Cantidad a cerrar</Text>
                  <TextInput style={styles.input} value={closeForm.closeAmount} onChangeText={(value) => setCloseForm({ ...closeForm, closeAmount: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Valor cierre</Text>
                  <TextInput style={styles.input} value={closeForm.closeValueFiat} onChangeText={(value) => setCloseForm({ ...closeForm, closeValueFiat: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Fee</Text>
                  <TextInput style={styles.input} value={closeForm.closeFee} onChangeText={(value) => setCloseForm({ ...closeForm, closeFee: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Moneda fee</Text>
                  <TextInput style={styles.input} value={closeForm.closeFeeCurrency} onChangeText={(value) => setCloseForm({ ...closeForm, closeFeeCurrency: value.toUpperCase() })} />
                  <Text style={styles.label}>Motivo</Text>
                  <TextInput style={styles.input} value={closeForm.closeReason} onChangeText={(value) => setCloseForm({ ...closeForm, closeReason: value })} />
                  <TouchableOpacity style={[styles.modalButton, submitting && styles.disabled]} disabled={submitting} onPress={submitClose}>
                    <Text style={styles.buttonText}>{submitting ? "Guardando..." : "Guardar cierre"}</Text>
                  </TouchableOpacity>
                </>
              ) : null}

              {editForm ? (
                <>
                  <Text style={styles.label}>Broker</Text>
                  <TextInput style={styles.input} value={editForm.broker} onChangeText={(value) => setEditForm({ ...editForm, broker: value })} />
                  <Text style={styles.label}>Fecha apertura</Text>
                  <TextInput style={styles.input} value={editForm.openDate} onChangeText={(value) => setEditForm({ ...editForm, openDate: value })} />
                  <Text style={styles.label}>Precio apertura</Text>
                  <TextInput style={styles.input} value={editForm.openPrice} onChangeText={(value) => setEditForm({ ...editForm, openPrice: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Cantidad abierta</Text>
                  <TextInput style={styles.input} value={editForm.amount} onChangeText={(value) => setEditForm({ ...editForm, amount: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Valor apertura</Text>
                  <TextInput style={styles.input} value={editForm.openValueFiat} onChangeText={(value) => setEditForm({ ...editForm, openValueFiat: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Fee apertura</Text>
                  <TextInput style={styles.input} value={editForm.openFee} onChangeText={(value) => setEditForm({ ...editForm, openFee: value })} keyboardType="numeric" />
                  {selected?.status === "closed" ? (
                    <>
                      <Text style={styles.label}>Fecha cierre</Text>
                      <TextInput style={styles.input} value={editForm.closeDate} onChangeText={(value) => setEditForm({ ...editForm, closeDate: value })} />
                      <Text style={styles.label}>Precio cierre</Text>
                      <TextInput style={styles.input} value={editForm.closePrice} onChangeText={(value) => setEditForm({ ...editForm, closePrice: value })} keyboardType="numeric" />
                      <Text style={styles.label}>Valor cierre</Text>
                      <TextInput style={styles.input} value={editForm.closeValueFiat} onChangeText={(value) => setEditForm({ ...editForm, closeValueFiat: value })} keyboardType="numeric" />
                      <Text style={styles.label}>Fee cierre</Text>
                      <TextInput style={styles.input} value={editForm.closeFee} onChangeText={(value) => setEditForm({ ...editForm, closeFee: value })} keyboardType="numeric" />
                      <Text style={styles.label}>Motivo cierre</Text>
                      <TextInput style={styles.input} value={editForm.closeReason} onChangeText={(value) => setEditForm({ ...editForm, closeReason: value })} />
                    </>
                  ) : null}
                  <Text style={styles.label}>Notas</Text>
                  <TextInput style={[styles.input, styles.notes]} value={editForm.notes} onChangeText={(value) => setEditForm({ ...editForm, notes: value })} multiline />
                  <TouchableOpacity style={[styles.modalButton, submitting && styles.disabled]} disabled={submitting} onPress={submitEdit}>
                    <Text style={styles.buttonText}>{submitting ? "Guardando..." : "Guardar edicion"}</Text>
                  </TouchableOpacity>
                </>
              ) : null}

              <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={closeModal}>
                <Text style={styles.buttonText}>Cancelar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "800", marginBottom: 12 },
  summary: { borderRadius: 12, padding: 12, backgroundColor: "#f1f8e9", gap: 4, marginBottom: 12 },
  summaryText: { fontSize: 15, fontWeight: "700", color: "#263238" },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: "#90a4ae", color: "#37474f" },
  chipActive: { backgroundColor: "#1b5e20", borderColor: "#1b5e20", color: "#fff" },
  list: { gap: 12, paddingBottom: 24 },
  emptyList: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  empty: { fontSize: 16, color: "#607d8b" },
  card: { borderWidth: 1, borderColor: "#e0e0e0", borderRadius: 12, padding: 14, backgroundColor: "#fafafa", gap: 6 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  symbol: { fontSize: 19, fontWeight: "800" },
  meta: { fontSize: 12, color: "#607d8b", marginTop: 2 },
  status: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, fontWeight: "800", overflow: "hidden" },
  open: { backgroundColor: "#fff3e0", color: "#ef6c00" },
  closed: { backgroundColor: "#e8f5e9", color: "#1b5e20" },
  rowText: { fontSize: 14, color: "#263238" },
  warning: { fontSize: 13, color: "#bf360c", fontWeight: "700" },
  profit: { color: "#1b5e20" },
  loss: { color: "#b71c1c" },
  actions: { flexDirection: "row", gap: 8, marginTop: 8 },
  primaryButton: { flex: 1, backgroundColor: "#2e7d32", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  secondaryButton: { width: 90, backgroundColor: "#1976d2", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "700", textAlign: "center" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", padding: 16, justifyContent: "center" },
  modalContent: { maxHeight: "90%", borderRadius: 14, backgroundColor: "#fff", padding: 16 },
  modalTitle: { fontSize: 20, fontWeight: "800", marginBottom: 12 },
  label: { fontSize: 14, fontWeight: "700", color: "#37474f", marginTop: 8, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#cfd8dc", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 16 },
  notes: { minHeight: 70, textAlignVertical: "top" },
  modalButton: { marginTop: 12, borderRadius: 8, paddingVertical: 11, alignItems: "center", backgroundColor: "#2e7d32" },
  cancelButton: { backgroundColor: "#546e7a" },
  disabled: { opacity: 0.55 },
});

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
import api, { API_BASE_URL, API_DEBUG_INFO } from "../constants/api";

type TrendSignal = {
  _id: string;
  symbol: string;
  asset?: {
    _id?: string;
    symbol?: string;
    displaySymbol?: string;
    name?: string;
  };
  market: "etf" | "stock" | "adr" | "crypto";
  side: "open" | "close";
  status: string;
  signalType: string;
  reason?: string;
  detectedAt?: string;
  lastCheckedAt?: string;
  hold?: {
    score?: number;
    driftAnnual?: number;
    consistencyScore?: number;
    persistenceScore?: number;
    trendQualityScore?: number;
  };
  suggested?: {
    price?: number;
    capitalUsd?: number;
    desiredCapitalUsd?: number;
    quantity?: number;
    valueFiat?: number;
    fiatCurrency?: string;
    capitalSource?: string;
    requiresShvSale?: boolean;
    isPartialPosition?: boolean;
    availableCashUsd?: number;
    availableUsd?: number;
    availableShvUsd?: number;
    availableUsdt?: number;
  };
  parameters?: {
    initialStop?: number;
    tp1Price?: number;
    runnerStop?: number;
    tp1QtyPct?: number;
    trailAtr?: number;
  };
  quality?: {
    score?: number;
    grade?: string;
    holdScoreComponent?: number;
    signalTypeScore?: number;
    riskScore?: number;
    capitalScore?: number;
    stopDistancePct?: number;
    capitalRatio?: number;
  };
  position?: string | { _id: string };
};

type CapitalSummary = {
  stocks?: {
    availableCashUsd?: number;
    availableUsdAfterOpen?: number;
    shvUsd?: number;
    openCapitalUsed?: number;
  };
  crypto?: {
    availableUsdt?: number;
  };
  settings?: {
    positionPct?: number;
    minPositionUsd?: number;
  };
};

type ScanJob = {
  id: string;
  key: string;
  label: string;
  status: "running" | "finished" | "failed";
  startedAt?: string;
  finishedAt?: string;
  result?: {
    scanned?: number;
    checked?: number;
    active?: number;
    omitted?: number;
    ignored?: number;
    errors?: number;
  };
  error?: string;
};

type OpenForm = {
  broker: string;
  openDate: string;
  openPrice: string;
  amount: string;
  openValueFiat: string;
  openFee: string;
  openFeeCurrency: string;
  fiatCurrency: string;
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

const fmt = (value?: number, decimals = 2) =>
  Number.isFinite(value) ? Number(value).toFixed(decimals) : "-";

const parseInput = (value: string) => {
  const parsed = Number(value.replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : NaN;
};

const calculateTp1Quantity = (signal: TrendSignal) => {
  const quantity = signal.suggested?.quantity;
  const tp1Pct = signal.parameters?.tp1QtyPct;

  if (!Number.isFinite(quantity) || !Number.isFinite(tp1Pct)) return undefined;
  return Number(quantity) * (Number(tp1Pct) / 100);
};

const assetNameFromSignal = (signal: TrendSignal) => {
  const symbol = signal.symbol?.trim().toUpperCase();
  const name = signal.asset?.name?.trim();
  if (name && name.toUpperCase() !== symbol) return name;

  const displaySymbol = signal.asset?.displaySymbol?.trim();
  if (displaySymbol && displaySymbol.toUpperCase() !== symbol) return displaySymbol;

  return null;
};

const positionIdFromSignal = (signal: TrendSignal) => {
  if (!signal.position) return null;
  if (typeof signal.position === "string") return signal.position;
  return signal.position._id;
};

function defaultOpenForm(signal: TrendSignal): OpenForm {
  const price = signal.suggested?.price ?? 0;
  const amount = signal.suggested?.quantity ?? 0;
  const value = signal.suggested?.valueFiat ?? signal.suggested?.capitalUsd ?? price * amount;
  const fiatCurrency = signal.suggested?.fiatCurrency ?? (signal.market === "crypto" ? "USDT" : "USD");

  return {
    broker: signal.market === "crypto" ? "binance" : "etoro",
    openDate: new Date().toISOString(),
    openPrice: price ? String(Number(price.toFixed(8))) : "",
    amount: amount ? String(Number(amount.toFixed(8))) : "",
    openValueFiat: value ? String(Number(value.toFixed(8))) : "",
    openFee: "0",
    openFeeCurrency: fiatCurrency,
    fiatCurrency,
  };
}

function defaultCloseForm(signal: TrendSignal): CloseForm {
  const price = signal.suggested?.price ?? 0;
  const amount = signal.suggested?.quantity ?? 0;
  const value = signal.suggested?.valueFiat ?? price * amount;
  const fiatCurrency = signal.suggested?.fiatCurrency ?? (signal.market === "crypto" ? "USDT" : "USD");

  return {
    closeDate: new Date().toISOString(),
    closePrice: price ? String(Number(price.toFixed(8))) : "",
    closeAmount: amount ? String(Number(amount.toFixed(8))) : "",
    closeValueFiat: value ? String(Number(value.toFixed(8))) : "",
    closeFee: "0",
    closeFeeCurrency: fiatCurrency,
    closeReason: signal.signalType,
  };
}

export default function TrendRunnerSignalsScreen() {
  const [signals, setSignals] = useState<TrendSignal[]>([]);
  const [capital, setCapital] = useState<CapitalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "open" | "close">("all");
  const [selectedSignal, setSelectedSignal] = useState<TrendSignal | null>(null);
  const [openForm, setOpenForm] = useState<OpenForm | null>(null);
  const [closeForm, setCloseForm] = useState<CloseForm | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanJob, setScanJob] = useState<ScanJob | null>(null);
  const showDebugTools = API_DEBUG_INFO.showDebugTools;
  const scanning = scanJob?.status === "running";

  const loadData = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const [signalsRes, capitalRes] = await Promise.all([
        api.get<TrendSignal[]>("/trend-runner/signals", {
          params: { status: "active" },
        }),
        api.get<CapitalSummary>("/trend-runner/capital").catch(() => ({ data: null as any })),
      ]);
      setSignals(Array.isArray(signalsRes.data) ? signalsRes.data : []);
      setCapital(capitalRes.data);
    } catch (error) {
      console.error("Error cargando senales Trend Runner", error);
      Alert.alert("Error", "No se pudieron cargar las senales Trend Runner.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadScanStatus = useCallback(async () => {
    const res = await api.get<{ jobs: ScanJob[] }>("/trend-runner/scan/status");
    const jobs = Array.isArray(res.data?.jobs) ? res.data.jobs : [];
    const currentJob = jobs.find((job) => job.status === "running") ?? jobs[0] ?? null;
    setScanJob(currentJob);
    return currentJob;
  }, []);

  useEffect(() => {
    loadScanStatus().catch(() => {});
  }, [loadScanStatus]);

  useEffect(() => {
    if (!scanning) return;

    const interval = setInterval(async () => {
      try {
        const currentJob = await loadScanStatus();
        if (currentJob?.status && currentJob.status !== "running") {
          await loadData({ silent: true });
        }
      } catch (error) {
        console.error("Error consultando estado de escaneo Trend Runner", error);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [scanning, loadScanStatus, loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData({ silent: true });
    }, [loadData])
  );

  const visibleSignals = useMemo(() => {
    return signals
      .filter((signal) => filter === "all" || signal.side === filter)
      .slice()
      .sort((left, right) => {
        if (filter === "all" && left.side !== right.side) {
          return left.side === "close" ? -1 : 1;
        }

        if (left.side === "open" && right.side === "open") {
          return Number(right.quality?.score ?? -1) - Number(left.quality?.score ?? -1);
        }

        return new Date(right.detectedAt ?? 0).getTime() - new Date(left.detectedAt ?? 0).getTime();
      });
  }, [signals, filter]);

  const scanStatusText = useMemo(() => {
    if (!scanJob) return null;

    const label = scanJob.label || "Escaneo Trend Runner";
    const result = scanJob.result ?? {};
    const reviewed = result.scanned ?? result.checked;

    if (scanJob.status === "running") {
      return `${label} en progreso. Puede tardar varios minutos.`;
    }

    if (scanJob.status === "failed") {
      return `${label} fallo: ${scanJob.error ?? "error desconocido"}`;
    }

    const parts = [
      reviewed != null ? `revisados ${reviewed}` : null,
      result.active != null ? `activas ${result.active}` : null,
      result.omitted != null ? `omitidas ${result.omitted}` : null,
      result.ignored != null ? `ignoradas ${result.ignored}` : null,
      result.errors != null ? `errores ${result.errors}` : null,
    ].filter(Boolean);

    return `${label} finalizado${parts.length ? `: ${parts.join(" · ")}` : "."}`;
  }, [scanJob]);

  const openExecutionModal = (signal: TrendSignal) => {
    setSelectedSignal(signal);
    if (signal.side === "open") {
      setOpenForm(defaultOpenForm(signal));
      setCloseForm(null);
    } else {
      setCloseForm(defaultCloseForm(signal));
      setOpenForm(null);
    }
  };

  const closeModal = () => {
    setSelectedSignal(null);
    setOpenForm(null);
    setCloseForm(null);
  };

  const ignoreSignal = async (signal: TrendSignal) => {
    try {
      await api.post(`/trend-runner/signals/${signal._id}/ignore`);
      await loadData({ silent: true });
    } catch (error) {
      Alert.alert("Error", "No se pudo ignorar la senal.");
    }
  };

  const submitOpen = async () => {
    if (!selectedSignal || !openForm) return;
    const openPrice = parseInput(openForm.openPrice);
    const amount = parseInput(openForm.amount);
    const openValueFiat = parseInput(openForm.openValueFiat);
    const openFee = parseInput(openForm.openFee);

    if (openPrice <= 0 || amount <= 0 || openValueFiat <= 0) {
      Alert.alert("Datos invalidos", "Precio, cantidad y valor deben ser mayores a cero.");
      return;
    }

    try {
      setSubmitting(true);
      await api.post(`/trend-runner/signals/${selectedSignal._id}/open`, {
        broker: openForm.broker,
        openDate: openForm.openDate,
        openPrice,
        amount,
        openValueFiat,
        openFee: Number.isFinite(openFee) ? openFee : 0,
        openFeeCurrency: openForm.openFeeCurrency,
        fiatCurrency: openForm.fiatCurrency,
      });
      closeModal();
      await loadData({ silent: true });
    } catch (error: any) {
      Alert.alert("Error", error?.response?.data?.error ?? "No se pudo abrir la posicion.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitClose = async () => {
    if (!selectedSignal || !closeForm) return;
    const positionId = positionIdFromSignal(selectedSignal);
    if (!positionId) {
      Alert.alert("Error", "La senal no tiene posicion asociada.");
      return;
    }

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
      await api.put(`/trend-runner/positions/${positionId}/close`, {
        closeDate: closeForm.closeDate,
        closePrice,
        closeAmount,
        closeValueFiat,
        closeFee: Number.isFinite(closeFee) ? closeFee : 0,
        closeFeeCurrency: closeForm.closeFeeCurrency,
        closeReason: closeForm.closeReason,
      });
      closeModal();
      await loadData({ silent: true });
    } catch (error: any) {
      Alert.alert("Error", error?.response?.data?.error ?? "No se pudo cerrar la posicion.");
    } finally {
      setSubmitting(false);
    }
  };

  const scanNow = async (kind: "open" | "close" | "refresh") => {
    try {
      let startedJobs: ScanJob[] = [];
      if (kind === "open") {
        const res = await api.post<{ job?: ScanJob; message?: string }>("/trend-runner/scan/open");
        if (res.data?.job) startedJobs = [res.data.job];
      } else if (kind === "close") {
        const res = await api.post<{ job?: ScanJob; message?: string }>("/trend-runner/scan/close");
        if (res.data?.job) startedJobs = [res.data.job];
      } else {
        const responses = await Promise.all([
          api.post("/trend-runner/scan/open/refresh"),
          api.post("/trend-runner/scan/close"),
        ]);
        startedJobs = responses
          .map((res) => res.data?.job as ScanJob | undefined)
          .filter(Boolean) as ScanJob[];
      }

      const currentJob = startedJobs.find((job) => job.status === "running") ?? startedJobs[0];
      if (currentJob) setScanJob(currentJob);
      await loadData({ silent: true });
    } catch (error: any) {
      Alert.alert("Error", error?.response?.data?.error ?? "No se pudo ejecutar el escaneo.");
    }
  };

  const sendPushTest = async () => {
    try {
      const res = await api.post("/trend-runner/push-test");
      const sent = Number(res.data?.sent ?? 0);
      if (sent === 0) {
        Alert.alert(
          "Sin token activo",
          "El backend respondio, pero todavia no hay token push registrado."
        );
      } else {
        Alert.alert(
          "Push enviada",
          "Si el token esta registrado, deberia llegar al telefono."
        );
      }
    } catch (error: any) {
      const status = error?.response?.status;
      const backendMessage = error?.response?.data?.error;
      const message = backendMessage
        ?? (status ? `Backend respondio con status ${status}.` : error?.message)
        ?? "No se pudo enviar la notificacion de prueba.";

      Alert.alert(
        "Error push",
        message
      );
    }
  };

  const testBackendConnection = async () => {
    try {
      const fetchUrl = `${API_BASE_URL.replace(/\/$/, "")}/health`;
      const fetchResponse = await fetch(fetchUrl);
      const fetchText = await fetchResponse.text();
      const res = await api.get("/health");
      Alert.alert(
        "Backend conectado",
        [
          `URL: ${API_BASE_URL}`,
          `fetch: ${fetchResponse.status} ${fetchText}`,
          `axios: ${res.data?.status ?? "ok"}`,
        ].join("\n")
      );
    } catch (error: any) {
      const status = error?.response?.status;
      const message = status
        ? `Backend respondio con status ${status}.`
        : error?.message ?? "No se pudo conectar al backend.";
      Alert.alert("Error conexion", message);
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
      <Text style={styles.title}>Trend Runner - Senales</Text>

      <View style={styles.capitalBox}>
        <Text style={styles.capitalTitle}>Capital disponible</Text>
        {showDebugTools ? (
          <>
            <Text style={styles.apiText}>API: {API_DEBUG_INFO.apiBaseUrl}</Text>
            <Text style={styles.apiText}>ENV: {API_DEBUG_INFO.configuredEnvUrl ?? "-"}</Text>
          </>
        ) : null}
        <Text style={styles.capitalText}>
          Acciones/ETFs: ${fmt(capital?.stocks?.availableCashUsd)} · USD libre ${fmt(capital?.stocks?.availableUsdAfterOpen)} · SHV ${fmt(capital?.stocks?.shvUsd)}
        </Text>
        <Text style={styles.capitalText}>
          Crypto: {fmt(capital?.crypto?.availableUsdt)} USDT · Posicion {fmt(capital?.settings?.positionPct)}% · Min ${fmt(capital?.settings?.minPositionUsd)}
        </Text>
      </View>

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.actionButton, scanning && styles.disabledButton]}
          disabled={scanning}
          onPress={() => scanNow("refresh")}
        >
          <Text style={styles.actionText}>Actualizar activas</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.secondaryButton, scanning && styles.disabledButton]}
          disabled={scanning}
          onPress={() => scanNow("close")}
        >
          <Text style={styles.actionText}>Revisar cierres</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={[styles.fullButton, scanning && styles.disabledButton]}
        disabled={scanning}
        onPress={() => scanNow("open")}
      >
        <Text style={styles.actionText}>
          {scanning ? "Escaneando..." : "Buscar nuevas entradas en todo el universo"}
        </Text>
      </TouchableOpacity>
      {scanStatusText ? (
        <Text style={[styles.scanStatus, scanJob?.status === "failed" && styles.scanStatusError]}>
          {scanStatusText}
        </Text>
      ) : null}
      {showDebugTools ? (
        <>
          <TouchableOpacity style={styles.testButton} onPress={sendPushTest}>
            <Text style={styles.actionText}>Enviar push de prueba</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.connectionButton} onPress={testBackendConnection}>
            <Text style={styles.actionText}>Probar conexion backend</Text>
          </TouchableOpacity>
        </>
      ) : null}

      <View style={styles.filterRow}>
        {[
          ["all", "Todas"],
          ["open", "Apertura"],
          ["close", "Cierre"],
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
        contentContainerStyle={visibleSignals.length ? styles.list : styles.emptyList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadData({ silent: true });
            }}
          />
        }
      >
        {visibleSignals.length === 0 ? (
          <Text style={styles.empty}>No hay senales activas.</Text>
        ) : (
          visibleSignals.map((signal) => (
            <View key={signal._id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.symbol}>{signal.symbol}</Text>
                  {assetNameFromSignal(signal) ? (
                    <Text style={styles.assetName}>{assetNameFromSignal(signal)}</Text>
                  ) : null}
                  <Text style={styles.meta}>
                    {signal.side === "open" ? "Apertura" : "Cierre"} · {signal.market.toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.sideBadge, signal.side === "close" && styles.closeBadge]}>
                  {signal.signalType}
                </Text>
              </View>

              <Text style={styles.rowText}>Hold Score: {fmt(signal.hold?.score, 1)}</Text>
              {signal.side === "open" && signal.quality?.score != null ? (
                <Text style={styles.rowText}>
                  Calidad: {signal.quality.grade ?? "-"} · {fmt(signal.quality.score, 1)}/100
                </Text>
              ) : null}
              <Text style={styles.rowText}>Precio sugerido: {fmt(signal.suggested?.price, 6)} {signal.suggested?.fiatCurrency ?? ""}</Text>
              {signal.side === "open" ? (
                <>
                  <Text style={styles.rowText}>Capital: ${fmt(signal.suggested?.capitalUsd)} · Cantidad {fmt(signal.suggested?.quantity, 8)}</Text>
                  {signal.suggested?.isPartialPosition ? (
                    <Text style={styles.rowText}>
                      Posición parcial: objetivo ${fmt(signal.suggested?.desiredCapitalUsd)} · disponible usado ${fmt(signal.suggested?.capitalUsd)}
                    </Text>
                  ) : null}
                  <Text style={styles.rowText}>Fuente: {signal.suggested?.capitalSource ?? "-"}{signal.suggested?.requiresShvSale ? " · vender SHV" : ""}</Text>
                  <Text style={styles.rowText}>Stop inicial: {fmt(signal.parameters?.initialStop, 6)} · TP1: {fmt(signal.parameters?.tp1Price, 6)}</Text>
                  <Text style={styles.rowText}>
                    Vender en TP1: {fmt(signal.parameters?.tp1QtyPct, 1)}% · Cantidad aprox. {fmt(calculateTp1Quantity(signal), 8)}
                  </Text>
                  <Text style={styles.rowText}>
                    Dejar correr: {fmt(100 - Number(signal.parameters?.tp1QtyPct ?? NaN), 1)}% con trailing stop
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.rowText}>Cantidad a cerrar: {fmt(signal.suggested?.quantity, 8)}</Text>
                  <Text style={styles.rowText}>Motivo: {signal.reason ?? signal.signalType}</Text>
                  <Text style={styles.rowText}>Runner stop: {fmt(signal.parameters?.runnerStop, 6)}</Text>
                </>
              )}

              <View style={styles.cardActions}>
                <TouchableOpacity style={styles.executeButton} onPress={() => openExecutionModal(signal)}>
                  <Text style={styles.executeText}>
                    {signal.side === "open" ? "Marcar abierta" : "Marcar cierre"}
                  </Text>
                </TouchableOpacity>
                {signal.side === "open" ? (
                  <TouchableOpacity style={styles.ignoreButton} onPress={() => ignoreSignal(signal)}>
                    <Text style={styles.executeText}>Ignorar</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={!!selectedSignal} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>
                {selectedSignal?.side === "open" ? "Registrar apertura" : "Registrar cierre"} {selectedSignal?.symbol}
              </Text>

              {openForm ? (
                <>
                  <Text style={styles.label}>Broker</Text>
                  <TextInput style={styles.input} value={openForm.broker} onChangeText={(value) => setOpenForm({ ...openForm, broker: value })} />
                  <Text style={styles.label}>Fecha apertura</Text>
                  <TextInput style={styles.input} value={openForm.openDate} onChangeText={(value) => setOpenForm({ ...openForm, openDate: value })} />
                  <Text style={styles.label}>Precio real</Text>
                  <TextInput style={styles.input} value={openForm.openPrice} onChangeText={(value) => setOpenForm({ ...openForm, openPrice: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Cantidad real</Text>
                  <TextInput style={styles.input} value={openForm.amount} onChangeText={(value) => setOpenForm({ ...openForm, amount: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Valor total</Text>
                  <TextInput style={styles.input} value={openForm.openValueFiat} onChangeText={(value) => setOpenForm({ ...openForm, openValueFiat: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Fee</Text>
                  <TextInput style={styles.input} value={openForm.openFee} onChangeText={(value) => setOpenForm({ ...openForm, openFee: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Moneda fee</Text>
                  <TextInput style={styles.input} value={openForm.openFeeCurrency} onChangeText={(value) => setOpenForm({ ...openForm, openFeeCurrency: value.toUpperCase() })} />
                  <TouchableOpacity style={[styles.modalButton, submitting && styles.disabledButton]} disabled={submitting} onPress={submitOpen}>
                    <Text style={styles.actionText}>{submitting ? "Guardando..." : "Guardar apertura"}</Text>
                  </TouchableOpacity>
                </>
              ) : null}

              {closeForm ? (
                <>
                  <Text style={styles.label}>Fecha cierre</Text>
                  <TextInput style={styles.input} value={closeForm.closeDate} onChangeText={(value) => setCloseForm({ ...closeForm, closeDate: value })} />
                  <Text style={styles.label}>Precio real cierre</Text>
                  <TextInput style={styles.input} value={closeForm.closePrice} onChangeText={(value) => setCloseForm({ ...closeForm, closePrice: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Cantidad cerrada</Text>
                  <TextInput style={styles.input} value={closeForm.closeAmount} onChangeText={(value) => setCloseForm({ ...closeForm, closeAmount: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Valor total cierre</Text>
                  <TextInput style={styles.input} value={closeForm.closeValueFiat} onChangeText={(value) => setCloseForm({ ...closeForm, closeValueFiat: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Fee</Text>
                  <TextInput style={styles.input} value={closeForm.closeFee} onChangeText={(value) => setCloseForm({ ...closeForm, closeFee: value })} keyboardType="numeric" />
                  <Text style={styles.label}>Moneda fee</Text>
                  <TextInput style={styles.input} value={closeForm.closeFeeCurrency} onChangeText={(value) => setCloseForm({ ...closeForm, closeFeeCurrency: value.toUpperCase() })} />
                  <Text style={styles.label}>Motivo</Text>
                  <TextInput style={styles.input} value={closeForm.closeReason} onChangeText={(value) => setCloseForm({ ...closeForm, closeReason: value })} />
                  <TouchableOpacity style={[styles.modalButton, submitting && styles.disabledButton]} disabled={submitting} onPress={submitClose}>
                    <Text style={styles.actionText}>{submitting ? "Guardando..." : "Guardar cierre"}</Text>
                  </TouchableOpacity>
                </>
              ) : null}

              <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={closeModal}>
                <Text style={styles.actionText}>Cancelar</Text>
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
  capitalBox: { padding: 12, borderRadius: 12, backgroundColor: "#f1f8e9", gap: 4, marginBottom: 12 },
  capitalTitle: { fontSize: 15, fontWeight: "700", color: "#1b5e20" },
  capitalText: { fontSize: 13, color: "#344" },
  apiText: { fontSize: 12, color: "#455a64" },
  actionsRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  actionButton: { flex: 1, backgroundColor: "#1976d2", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  secondaryButton: { backgroundColor: "#2e7d32" },
  fullButton: { backgroundColor: "#455a64", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginBottom: 12 },
  scanStatus: { marginTop: -4, marginBottom: 12, fontSize: 13, color: "#455a64" },
  scanStatusError: { color: "#b71c1c" },
  testButton: { backgroundColor: "#6a1b9a", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginBottom: 12 },
  connectionButton: { backgroundColor: "#00838f", borderRadius: 8, paddingVertical: 10, alignItems: "center", marginBottom: 12 },
  disabledButton: { opacity: 0.55 },
  actionText: { color: "#fff", fontWeight: "700", textAlign: "center" },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: "#90a4ae", color: "#37474f" },
  chipActive: { backgroundColor: "#1b5e20", borderColor: "#1b5e20", color: "#fff" },
  list: { gap: 12, paddingBottom: 24 },
  emptyList: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  empty: { color: "#607d8b", fontSize: 16 },
  card: { borderWidth: 1, borderColor: "#e0e0e0", borderRadius: 12, padding: 14, backgroundColor: "#fafafa", gap: 6 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  symbol: { fontSize: 19, fontWeight: "800" },
  assetName: { fontSize: 13, color: "#37474f", marginTop: 2, maxWidth: 210 },
  meta: { fontSize: 12, color: "#607d8b", marginTop: 2 },
  sideBadge: { maxWidth: "55%", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "#e3f2fd", color: "#0d47a1", fontWeight: "700", textAlign: "right" },
  closeBadge: { backgroundColor: "#ffebee", color: "#b71c1c" },
  rowText: { fontSize: 14, color: "#263238" },
  cardActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  executeButton: { flex: 1, backgroundColor: "#2e7d32", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  ignoreButton: { width: 92, backgroundColor: "#78909c", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  executeText: { color: "#fff", fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", padding: 16, justifyContent: "center" },
  modalContent: { maxHeight: "90%", borderRadius: 14, backgroundColor: "#fff", padding: 16 },
  modalTitle: { fontSize: 20, fontWeight: "800", marginBottom: 12 },
  label: { fontSize: 14, fontWeight: "700", color: "#37474f", marginTop: 8, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#cfd8dc", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, fontSize: 16 },
  modalButton: { marginTop: 12, borderRadius: 8, paddingVertical: 11, alignItems: "center", backgroundColor: "#2e7d32" },
  cancelButton: { backgroundColor: "#546e7a" },
});

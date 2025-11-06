// Pantalla de Transacciones: administra rebalanceos sugeridos, operaciones abiertas,
// inputs manuales y sincronización con datos de Binance, configuraciones propias
// y precios externos. Este archivo concentra gran parte de la lógica de trading asistido.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  Platform,
} from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useFocusEffect } from "@react-navigation/native";
import api from "../constants/api";
import { calculateTotalBalances } from "../utils/calculateTotalBalances";

// === Tipos de datos ===
// Documentos de assets, balances, operaciones y formularios utilizados a lo largo de la pantalla.

type AssetDocument = {
  _id: string;
  symbol: string;
  type: "fiat" | "crypto" | "stock" | "commodity";
  totalCapitalWhenLastAdded: number;
  maxPriceSevenYear: number;
  minPriceSevenYear: number;
  slope?: number;
  initialInvestment?: number | Record<string, number>;
  exchange?:
    | string
    | {
        _id?: string;
        id?: string;
        name?: string;
      };
  exchangeName?: string;
};
//valor actual de cada activo en unidades del propio activo y su equivalente en USD
type BalanceEntry = {
  asset: string; // Símbolo del activo (ej. BTC, USDT, USD)
  total: number; // Cantidad total del activo en unidades del propio activo (ej. 0.52 BTC)
  usdValue: number; // Equivalente en USD del total al precio vigente
};

type ConfigInfo = {
  _id: string;
  name: string;
  total: number;
};

// Operation: estructura de la sugerencia/acción de trading calculada para un activo.
// Cada campo incluye comentario inline para aclarar su propósito en la UI y la lógica.
type Operation = {
  id: string; // Identificador único de la operación sugerida o consolidada
  assetId: string; // ID del activo en la base de datos interna
  symbol: string; // Ticker/par del activo (ej. BTCUSDT)
  baseAsset: string; // Activo base del par (ej. BTC en BTCUSDT)
  quoteAsset: string; // Activo de cotización del par (ej. USDT en BTCUSDT)
  fiatCurrency: string; // Moneda fiat de referencia para cálculos/reportes (ej. USD, PEN)
  exchangeId?: string | null; // Identificador del exchange (si aplica) donde se ejecutaría
  exchangeName?: string | null; // Nombre legible del exchange (ej. Binance)
  isBinance: boolean; // Bandera rápida: true si la operación corresponde a Binance
  usdtUsdRate: number; // Tipo de cambio USDT→USD usado para normalizar valores
  allocation: number; // Porcentaje objetivo de asignación de este activo en el portafolio, que porcentaje del portafolio 
  // se debe tener de este activo
  price: number; // Precio de mercado actual (base/quote)
  priceLabel?: string; // Precio formateado para mostrar en la UI
  action: "buy" | "sell"; // Acción concreta sugerida a ejecutar
  // signo de la pendiente (slope) del activo: 1 = positiva, -1 = negativa, 0 = neutra
  slopeSign?: 1 | 0 | -1; // Dirección de tendencia: 1 alcista, -1 bajista, 0 neutra
  buyPrice?: number; // Precio recomendado para compra (límite o referencia) usado solo para USDTUSD/P2P
  sellPrice?: number; // Precio recomendado para venta (límite o referencia) usado solo para USDTUSD/P2P
  suggestedBaseAmount: number; // Cantidad base sugerida a comprar/vender (en unidades del baseAsset)
  suggestedFiatValue: number; // Valor en fiat sugerido a mover (en fiatCurrency) misma cantidad que suggestedBaseAmount 
  // pero en fiat
  closingPositions?: Array<{
    id: string; // ID de la posición/orden abierta a cerrar
    amount: number; // Cantidad base a cerrar en esa posición
    closeValueFiat: number; // Valor fiat estimado al cierre
    closePrice: number; // Precio esperado/objetivo de cierre, se usa precio actual.
  }>; // Plan de cierres parciales (si corresponde)
  residualBaseAmount?: number; // Cantidad base remanente tras cerrar posiciones y ejecutar
  residualFiatValue?: number; // Valor fiat remanente tras la ejecución
  targetBaseUsd: number; // Valor objetivo en USD del activo base según la asignación
  targetQuoteUsd: number; // Valor objetivo en USD del activo de cotización relacionado
  targetBasePercent: number; // Porcentaje objetivo del activo base en el portafolio
  actualBaseUsd: number; // Valor actual en USD del activo base en cartera
  actualQuoteUsd: number; // Valor actual en USD del activo de cotización
  baseDiffUsd: number; // Diferencia USD entre valor actual y objetivo del activo base = targetBaseUsd - actualBaseUsd
  actionMessage: string; // Mensaje explicativo y amigable para la UI
  actualBaseAmountUnits?: number; // Unidades actuales del activo base mantenidas
  minPrice?: number; // Precio mínimo relevante (soporte) usado para contexto/validación, minimo en 7 años
  maxPrice?: number; // Precio máximo relevante (resistencia) usado para contexto/validación, maximo en 7 años
  baseHoldUsd?: number; // Monto USD del activo base actualmente retenido (en hold/bloqueado), esta determinado por el slope
  quoteHoldUsd?: number; // Monto USD del activo de cotización retenido (en hold/bloqueado), esta determinado por el slope
  maxBaseAllowed?: number; // Tope máximo permitido de unidades base (control de riesgo), cuando el slope es negativo este valor
  // limita la cantidad máxima a comprar de la moneda base
  baseHoldingUsd?: number; // Valor USD total del activo base (libre + hold)
  quoteHoldingUsd?: number; // Valor USD total del activo de cotización (libre + hold)
  slopeFraction?: number; // Intensidad normalizada de la tendencia (0–1)
};
// SimulationResult: resultado de simular una operación con un precio dado.
type SimulationResult = {
  status: "action" | "none" | "invalid"; // Resultado de la simulación: hay acción, no hay acción o entrada inválida
  message: string; // Mensaje descriptivo del resultado (para UI)
  suggestedBaseAmount?: number; // Cantidad base sugerida según la simulación (unidades del baseAsset)
  suggestedFiatValue?: number; // Valor en moneda quote/fiat equivalente a mover
  action?: "buy" | "sell"; // Dirección sugerida si aplica
  operation?: Operation; // Operación completa generada por la simulación (cuando corresponde)
};
// PriceOverrideState: estado asociado a un override manual de precio para una operación.
type PriceOverrideState = {
  input: string; // Texto ingresado por el usuario para sobreescribir precio (string crudo del input)
  result: SimulationResult | null; // Resultado de simular con ese precio, si ya se calculó
  visible: boolean; // Controla la visibilidad del modal/overlay de override de precio, si el modal esta visible muestra el
  //formulario para ingresar el precio de simulacion.
};
// createEmptyRegisterForm: función auxiliar para inicializar el estado del formulario de registro. Los valores son strings 
// para facilitar el enlace con inputs de texto. 
type RegisterFormState = {
  type: "long" | "short"; // Tipo de posición a registrar manualmente
  openPrice: string; // Precio de apertura ingresado como texto
  amount: string; // Cantidad base abierta (texto)
  openValueFiat: string; // Valor fiat de apertura (texto), es el monto en moneda quote.
  fiatCurrency: string; // Moneda fiat/quote usada en el registro, es el symbolo del la moneda quote ej. USD, PEN
  openFee: string; // Fee de apertura (texto)
  openFeeCurrency: string; // Moneda del fee
  openDate: string; // Fecha/hora de apertura en formato string
};
// transactionDoc: estructura del documento de transacción en la base de datos. solo maneja los datos de apertura de la
// transacción. los datos de cierre se manejan por separado. se trae los datos directamente de la base de datos.
type TransactionDoc = {
  _id: string; // ID del documento de transacción en la base de datos
  asset: string | { _id?: string }; // Referencia al activo (puede venir como string o subdocumento)
  type: "long" | "short"; // Dirección de la posición
  amount: number; // Cantidad base abierta
  openValueFiat: number; // Valor fiat invertido al abrir
  openPrice: number; // Precio unitario al abrir
  openFee?: number; // Comisión pagada al abrir (si existe)
  status: "open" | "closed"; // Estado actual de la transacción
  openDate?: string; // Fecha/hora de apertura (texto)
  createdAt?: string; // Timestamp de creación del documento
};
// OpenPosition: estructura interna homogénea para representar posiciones abiertas. Sus datos vienen directamente de 
// TransactionDoc.Se usa para calculos internos.
type OpenPosition = {
  id: string; // ID de la transacción original
  amount: number; // Cantidad base restante abierta
  openValueFiat: number; // Valor fiat correspondiente a la parte abierta
  openPrice: number; // Precio promedio de apertura
  openFee: number; // Fee proporcional asociado a la porción abierta
  openDate: number; // Fecha de apertura en milisegundos (epoch)
};

type OpenPositionsByAsset = {
  longs: OpenPosition[]; // Lista de posiciones largas abiertas para el activo
  shorts: OpenPosition[]; // Lista de posiciones cortas abiertas para el activo
};

// Conversores y utilidades comunes -------------------------------------------

const parseNumberInput = (value: string) => {
  // Normaliza entrada numérica desde inputs (reemplaza coma por punto) y devuelve NaN si no es válido.
  if (typeof value !== "string") return NaN;
  const normalized = value.replace(/,/g, ".");
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const isLikelyObjectId = (value: string) => /^[0-9a-fA-F]{24}$/.test(value); // Heurística simple para ObjectId de Mongo

const BINANCE_EXCHANGE_IDS = new Set([
  "68b36f95ea61fd89d70c8d98", // ID interno que identifica Binance en tu BD
  "binance", // Alias textual
]);

const isBinanceExchangeValue = (value: unknown) => {
  // Determina si un identificador de exchange corresponde a Binance.
  if (!value) return false;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return BINANCE_EXCHANGE_IDS.has(lower);
  }
  if (typeof value === "object") {
    const maybeObj = value as { _id?: string; id?: string; name?: string };
    if (maybeObj.name && typeof maybeObj.name === "string") {
      if (maybeObj.name.toLowerCase().includes("binance")) return true;
    }
    const idVal = maybeObj._id ?? maybeObj.id;
    if (typeof idVal === "string" && BINANCE_EXCHANGE_IDS.has(idVal.toLowerCase())) {
      return true;
    }
  }
  return false;
};

const BASE_TOLERANCE = 1e-8; // Margen para cantidades base al comparar flotantes
const PROFIT_TOLERANCE = 1e-6; // Margen para validar ganancias / cierres

const toNumber = (value: unknown, fallback = 0) => {
  // Convierte valores potencialmente nulos o strings a number, usando fallback si no es finito.
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseDate = (value?: string) => {
  // Intenta convertir una fecha en milisegundos; devuelve NaN si no es parseable.
  if (!value) return Number.NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NaN;
};

const formatDateTimeLabel = (value?: string) => {
  // Devuelve una representación legible (fecha + hora) para mostrar en la UI.
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const datePart = date.toLocaleDateString();
  const timePart = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${datePart} ${timePart}`;
};

const normalizeOpenPosition = (tx: TransactionDoc): OpenPosition | null => {
  // Transforma un documento de transacción abierta a la estructura interna homogénea.
  const amount = toNumber(tx.amount);
  const openValueFiat = toNumber(tx.openValueFiat);
  const openPrice = toNumber(tx.openPrice);
  if (amount <= 0 || openValueFiat <= 0 || openPrice <= 0) return null;
  const openFee = Math.max(0, toNumber(tx.openFee));
  const openDate = parseDate(tx.openDate) ?? parseDate(tx.createdAt);
  return {
    id: tx._id,
    amount,
    openValueFiat,
    openPrice,
    openFee,
    openDate: Number.isFinite(openDate) ? openDate : Date.now(),
  };
};

// formatAssetAmount: da formato a cantidades base según el activo.
const formatAssetAmount = (amount: number, asset: string) => {
  const upper = asset.toUpperCase();
  if (["USD", "PEN"].includes(upper)) {
    return amount.toFixed(3);
  }
  if (upper === "USDT") {
    return amount.toFixed(8);
  }
  if (["BTC"].includes(upper)) {
    return amount.toFixed(6);
  }
  return amount.toFixed(4);
};

// formatQuoteValue: formatea montos en la moneda quote.
const formatQuoteValue = (value: number, asset: string) => {
  const upper = asset?.toUpperCase?.() ?? "USD";
  if (upper === "USD") {
    return `$${value.toFixed(3)}`;
  }
  if (upper === "USDT") {
    return `${value.toFixed(8)} USDT`;
  }
  if (upper === "PEN") {
    return `${value.toFixed(3)} PEN`;
  }
  return `${value.toFixed(2)} ${upper}`;
};

// buildClosurePlan: selecciona posiciones abiertas para cerrar priorizando cercanía de openPrice al precio actual.
// Reglas:
// - Cierra primero la posición cuyo openPrice esté más cerca del precio de cierre actual y sea rentable.
// - No propone cerrar (ni parcial ni total) posiciones que quedarían en pérdida, salvo un remanente mínimo.
// - Si queda un remanente mínimo para completar la cantidad sugerida, permite cubrirlo con FIFO sobre posiciones en pérdida.
const buildClosurePlan = (
  op: Operation,
  orders: OpenPosition[],
  action: "sell" | "buy"
):
  | {
      baseUsed: number;
      quoteUsed: number;
      entries: Array<{ id: string; amount: number; closeValueFiat: number; closePrice: number }>;
    }
  | null => {
  if (!orders.length) return null;
  const availableBase = op.suggestedBaseAmount;
  if (!(availableBase > BASE_TOLERANCE)) return null;

  let baseUsed = 0;
  let quoteUsed = 0;
  const entries: Array<{ id: string; amount: number; closeValueFiat: number; closePrice: number }> = [];
  const currentPrice = op.price;
  const quoteUpper = op.quoteAsset?.toUpperCase?.() ?? op.quoteAsset;
  const quoteDecimals = quoteUpper === "USDT" ? 8 : (quoteUpper === "USD" || quoteUpper === "PEN" ? 3 : 2);
  const orderUsage = new Map<string, number>();

  // 1) Ordenar por cercanía del openPrice al precio actual (más cercano primero)
  const sorted = [...orders].sort((a, b) => {
    const da = Math.abs(a.openPrice - currentPrice);
    const db = Math.abs(b.openPrice - currentPrice);
    return da - db;
  });

  // Helper para calcular si cerrar 'take' es rentable
  const isProfitable = (order: OpenPosition, take: number) => {
    const factor = take / order.amount;
    const currentQuote = take * currentPrice;
    const openGross = order.openValueFiat * factor;
    const openFeePart = order.openFee * factor;
    const profit = action === "sell"
      ? currentQuote - (openGross + openFeePart)
      : (openGross - openFeePart) - currentQuote;
    return profit > PROFIT_TOLERANCE;
  };

  // 2) Consumir solo posiciones rentables, por cercanía
  for (const order of sorted) {
    if (order.amount <= 0) continue;
    const remaining = availableBase - baseUsed;
    if (remaining <= BASE_TOLERANCE) break;
    const take = Math.min(order.amount, remaining);
    if (take <= BASE_TOLERANCE) continue;

    if (!isProfitable(order, take)) continue; // no cerrar en pérdida

    const currentQuote = take * currentPrice;
    baseUsed = Number((baseUsed + take).toFixed(8));
    quoteUsed = Number((quoteUsed + currentQuote).toFixed(quoteDecimals));
    entries.push({
      id: order.id,
      amount: Number(take.toFixed(8)),
      closeValueFiat: Number(currentQuote.toFixed(quoteDecimals)),
      closePrice: currentPrice,
    });
    orderUsage.set(order.id, (orderUsage.get(order.id) ?? 0) + take);
  }

  // 3) Si queda un remanente mínimo, permitir cubrirlo con FIFO sobre las no rentables
  let remainingAfterProfitable = availableBase - baseUsed;
  if (remainingAfterProfitable > BASE_TOLERANCE) {
    for (const order of orders) {
      if (order.amount <= 0) continue;
      remainingAfterProfitable = availableBase - baseUsed;
      if (remainingAfterProfitable <= BASE_TOLERANCE) break;

      const alreadyUsed = orderUsage.get(order.id) ?? 0;
      const remainingCapacity = Math.max(order.amount - alreadyUsed, 0);
      if (remainingCapacity <= BASE_TOLERANCE) continue;

      const take = Math.min(remainingCapacity, remainingAfterProfitable);
      if (take <= BASE_TOLERANCE) continue;

      const currentQuote = take * currentPrice;
      baseUsed = Number((baseUsed + take).toFixed(8));
      quoteUsed = Number((quoteUsed + currentQuote).toFixed(quoteDecimals));
      entries.push({
        id: order.id,
        amount: Number(take.toFixed(8)),
        closeValueFiat: Number(currentQuote.toFixed(quoteDecimals)),
        closePrice: currentPrice,
      });
      orderUsage.set(order.id, alreadyUsed + take);
    }
  }

  if (!entries.length) return null;

  return {
    baseUsed,
    quoteUsed,
    entries,
  };
};

// adjustOperationForClosings: adapta la operación sugerida a cierres reales de posiciones abiertas.
const adjustOperationForClosings = (
  op: Operation,
  openPositions?: OpenPositionsByAsset
): Operation | null => {
  if (!openPositions) return op;

  const priceIsValid = Number.isFinite(op.price) && op.price > 0;
  const baseUpper = op.baseAsset?.toUpperCase?.() ?? op.baseAsset;
  const quoteUpperGlobal = op.quoteAsset?.toUpperCase?.() ?? op.quoteAsset;

  if (op.action === "sell") {
    if (!openPositions.longs.length) return op;
    const saleUsd = Math.max(0, -op.baseDiffUsd);
    const totalBaseNeeded =
      baseUpper === "USD" || !priceIsValid ? saleUsd : saleUsd / (op.price || 1);
    const totalBaseNeededRounded = Number(totalBaseNeeded.toFixed(8));

    const computeFiatValue = (baseAmount: number) => {
      if (!priceIsValid) return saleUsd;
      if (quoteUpperGlobal === "USD") {
        if (baseUpper === "USD") {
          return baseAmount;
        }
        return baseAmount * (op.price || 0);
      }
      if (quoteUpperGlobal === "USDT") {
        return baseAmount * (op.price || 0);
      }
      return baseAmount * (op.price || 0);
    };

    const plan = buildClosurePlan(op, openPositions.longs, "sell");
    // Si no hay cierres rentables y el slope es negativo, permitir abrir short igualmente
    if (!plan) {
      if ((op.slopeSign ?? 0) < 0) return op;
      return null;
    }

    const roundedBase = Number(plan.baseUsed.toFixed(8));
    const quoteUpper = quoteUpperGlobal;
    const quoteDec = quoteUpper === "USDT" ? 8 : (quoteUpper === "USD" || quoteUpper === "PEN" ? 3 : 2);
    const roundedQuote = Number(plan.quoteUsed.toFixed(quoteDec));
    const baseLabel = formatAssetAmount(roundedBase, op.baseAsset);
    const quoteAssetUpper = op.quoteAsset?.toUpperCase?.() ?? op.quoteAsset;
    const quoteLabel = formatQuoteValue(roundedQuote, quoteAssetUpper ?? "USD");
    const plural = plan.entries.length > 1 ? "s" : "";
    let message = `Cerrar ${plan.entries.length} long${plural} abiertas (${quoteLabel}) vendiendo ${baseLabel} ${op.baseAsset} por ${quoteAssetUpper}.`;

    const adjustedBaseDiff =
      op.baseAsset?.toUpperCase?.() === "USD"
        ? -roundedBase
        : -(roundedBase * op.price);

    const residualBase = Math.max(0, Number((totalBaseNeededRounded - roundedBase).toFixed(8)));
    const residualFiat = Number(residualBase > 0 ? computeFiatValue(residualBase).toFixed(quoteDec) : "0");
    if (residualBase > BASE_TOLERANCE) {
      const residualLabel = formatAssetAmount(residualBase, op.baseAsset);
      const residualFiatLabel = formatQuoteValue(residualFiat, quoteAssetUpper ?? "USD");
      message += ` Además, abrir short con ${residualLabel} ${op.baseAsset} (${residualFiatLabel}).`;
    }

    return {
      ...op,
      suggestedBaseAmount: Number((roundedBase + residualBase).toFixed(8)),
      suggestedFiatValue: Number((roundedQuote + residualFiat).toFixed(quoteDec)),
      baseDiffUsd: adjustedBaseDiff,
      closingPositions: plan.entries.map(entry => ({
        id: entry.id,
        amount: Number(entry.amount.toFixed(8)),
        closeValueFiat: Number(entry.closeValueFiat.toFixed(quoteDec)),
        closePrice: entry.closePrice,
      })),
      residualBaseAmount: residualBase,
      residualFiatValue: residualFiat,
      actionMessage: message,
    };
  }

  if (op.action === "buy") {
    if (!openPositions.shorts.length) return op;
    const buyUsd = Math.max(0, op.baseDiffUsd);
    const totalBaseNeeded =
      baseUpper === "USD" || !priceIsValid ? buyUsd : buyUsd / (op.price || 1);
    const totalBaseNeededRounded = Number(totalBaseNeeded.toFixed(8));

    const computeFiatValue = (baseAmount: number) => {
      if (!priceIsValid) return buyUsd;
      if (quoteUpperGlobal === "USD") {
        if (baseUpper === "USD") {
          return baseAmount;
        }
        return baseAmount * (op.price || 0);
      }
      if (quoteUpperGlobal === "USDT") {
        return baseAmount * (op.price || 0);
      }
      return baseAmount * (op.price || 0);
    };

    const plan = buildClosurePlan(op, openPositions.shorts, "buy");
    // Si no hay cierres rentables y el slope es positivo, permitir abrir long igualmente
    if (!plan) {
      if ((op.slopeSign ?? 0) > 0) return op;
      return null;
    }

    const roundedBase = Number(plan.baseUsed.toFixed(8));
    const quoteUpper2 = quoteUpperGlobal;
    const quoteDec = quoteUpper2 === "USDT" ? 8 : (quoteUpper2 === "USD" || quoteUpper2 === "PEN" ? 3 : 2);
    const roundedQuote = Number(plan.quoteUsed.toFixed(quoteDec));
    const baseLabel = formatAssetAmount(roundedBase, op.baseAsset);
    const quoteAssetUpper = op.quoteAsset?.toUpperCase?.() ?? op.quoteAsset;
    const quoteLabel = formatQuoteValue(roundedQuote, quoteAssetUpper ?? "USD");
    const plural = plan.entries.length > 1 ? "s" : "";
    let message = `Cerrar ${plan.entries.length} short${plural} abiertas (${quoteLabel}) comprando ${baseLabel} ${op.baseAsset} usando ${quoteAssetUpper}.`;

    const adjustedBaseDiff =
      op.baseAsset?.toUpperCase?.() === "USD"
        ? roundedBase
        : roundedBase * op.price;

    const residualBase = Math.max(0, Number((totalBaseNeededRounded - roundedBase).toFixed(8)));
    const residualFiat = Number(residualBase > 0 ? computeFiatValue(residualBase).toFixed(quoteDec) : "0");
    if (residualBase > BASE_TOLERANCE) {
      const residualLabel = formatAssetAmount(residualBase, op.baseAsset);
      const residualFiatLabel = formatQuoteValue(residualFiat, quoteAssetUpper ?? "USD");
      message += ` Además, abrir long con ${residualLabel} ${op.baseAsset} usando ${residualFiatLabel}.`;
    }

    return {
      ...op,
      suggestedBaseAmount: Number((roundedBase + residualBase).toFixed(8)),
      suggestedFiatValue: Number((roundedQuote + residualFiat).toFixed(quoteDec)),
      baseDiffUsd: adjustedBaseDiff,
      closingPositions: plan.entries.map(entry => ({
        id: entry.id,
        amount: Number(entry.amount.toFixed(8)),
        closeValueFiat: Number(entry.closeValueFiat.toFixed(quoteDec)),
        closePrice: entry.closePrice,
      })),
      residualBaseAmount: residualBase,
      residualFiatValue: residualFiat,
      actionMessage: message,
    };
  }

  return op;
};

// === Componente principal ===================================================
// Administra el ciclo de vida de la vista, llamadas a la API, cálculo de planes
// y renderizado de sugerencias de trading.
export default function TransaccionesScreen() {
  // Estado general y referencias de control -------------------------------
  const [loading, setLoading] = useState(true); // indicador de carga inicial
  const [refreshing, setRefreshing] = useState(false); // refresco vía pull-to-refresh
  const [operations, setOperations] = useState<Operation[]>([]); // lista de sugerencias calculadas
  const [error, setError] = useState<string | null>(null); // error global en la vista
  const hasFetchedOnFocus = useRef(false); // evita doble fetch al enfocar
  const isFetchingRef = useRef(false); // evita llamadas paralelas a loadData
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(null); // operación enfocada
  const [suggestionModalVisible, setSuggestionModalVisible] = useState(false); // modal con detalle de sugerencia
  const openPositionsByAssetRef = useRef<Map<string, OpenPositionsByAsset>>(new Map()); // snapshot de posiciones abiertas
  const [priceOverrides, setPriceOverrides] = useState<Record<string, PriceOverrideState>>({}); // overrides manuales de precio
  const [registerModalVisible, setRegisterModalVisible] = useState(false); // modal para registrar operación ejecutada
  const [registerTarget, setRegisterTarget] = useState<Operation | null>(null); // operación objetivo al registrar
  const [registerForm, setRegisterForm] = useState<RegisterFormState>(() => createEmptyRegisterForm()); // formulario de registro
  const [registerError, setRegisterError] = useState<string | null>(null); // errores del formulario
  const [registerSubmitting, setRegisterSubmitting] = useState(false); // flag de envío en progreso
  const [datePickerVisible, setDatePickerVisible] = useState(false); // controla el modal del selector de fecha
  const [datePickerValue, setDatePickerValue] = useState<Date>(() => new Date()); // valor temporal del selector
  const [assetOptions, setAssetOptions] = useState<AssetDocument[]>([]); // catálogo de pares disponibles
  const [addTransactionModalVisible, setAddTransactionModalVisible] = useState(false); // modal para agregar manualmente
  const [manualSelectedAssetId, setManualSelectedAssetId] = useState<string | null>(null); // par elegido en el modal

  // loadData: rutina principal que agrupa llamadas a la API, normaliza la data y
  // dispara el cálculo de asignaciones. Se puede invocar en silencio para refrescos.
  const loadData = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      try {
        if (!silent) {
          setLoading(true);
        }
        setError(null);

        // Consultas concurrentes: assets, balances Binance, configuración, FX y transacciones.
        const [assetsRes, balancesRes, configRes, penRes, transactionsRes] = await Promise.all([
          api.get<AssetDocument[]>("/assets"),
          api.get<{ balances: BalanceEntry[]; totals: { usd: number; pen: number } }>(
            "/binance/balances"
          ),
          api.get<ConfigInfo[]>("/config-info"),
          fetch("https://open.er-api.com/v6/latest/PEN").then(res => res.json()),
          api.get<TransactionDoc[]>("/transactions"),
        ]);

        // Filtramos assets para separar los que son pares fiat útiles en la pantalla.
        const allAssets = assetsRes.data || [];
        const nonFiatAssets = allAssets.filter(asset => asset.type !== "fiat");
        const fiatPairs = allAssets.filter(asset => asset.symbol === "USDTUSD" || asset.symbol === "USDPEN");
        const assets = [...nonFiatAssets, ...fiatPairs];
        setAssetOptions(assets);

        // Normalización de balances de Binance y totales agregados.
        const balanceList = balancesRes.data?.balances ?? [];
        const totals = balancesRes.data?.totals ?? { usd: 0, pen: 0 };
        const balanceMap = new Map<string, BalanceEntry>();
        balanceList.forEach(entry => {
          balanceMap.set(entry.asset, entry);
        });

      // Mapa de configuración key -> valor para buscar totales rápidamente.
      const configMap = new Map<string, number>();
      (configRes.data ?? []).forEach(item => {
        configMap.set(item.name, item.total);
      });

      const getConfigNumber = (...names: string[]) => {
        for (const name of names) {
          const value = configMap.get(name);
          if (typeof value === "number" && !Number.isNaN(value)) {
            return value;
          }
        }
        return undefined;
      };

      const resolvedUsdtBuy = getConfigNumber("PrecioCompraUSDT", "lastPriceUsdtBuy");
      const resolvedUsdtSell = getConfigNumber("PrecioVentaUSDT", "lastPriceUsdtSell");

      const usdtBuyPrice =
        typeof resolvedUsdtBuy === "number" && resolvedUsdtBuy > 0 ? resolvedUsdtBuy : null;
      const usdtSellPrice =
        typeof resolvedUsdtSell === "number" && resolvedUsdtSell > 0 ? resolvedUsdtSell : null;

      const lastPriceUsdtBuy = usdtBuyPrice ?? usdtSellPrice ?? 1;
      const lastPriceUsdtSell = usdtSellPrice ?? usdtBuyPrice ?? 1;

      const usdtUsdRate = (() => {
        if (usdtSellPrice) return usdtSellPrice;
        if (usdtBuyPrice) return usdtBuyPrice;
        return 1;
      })();

      const penUsdRate = penRes?.result === "success" && penRes?.rates?.USD ? penRes.rates.USD : null;
      const penToUsd = penUsdRate ?? 0; // USD por PEN
      const usdToPen = penUsdRate ? 1 / penUsdRate : null; // PEN por USD

      const transactionsList = Array.isArray(transactionsRes.data) ? transactionsRes.data : [];

      // Agrupamos transacciones abiertas por asset para evaluar cierres o aperturas.
      const openTransactionsByAsset = new Map<string, OpenPositionsByAsset>();
      transactionsList.forEach(tx => {
        if (!tx || tx.status !== "open") return;
        const assetId =
          typeof tx.asset === "string"
            ? tx.asset
            : tx.asset && typeof tx.asset._id === "string"
            ? tx.asset._id
            : null;
        if (!assetId) return;
        const normalized = normalizeOpenPosition(tx);
        if (!normalized) return;
        const entry = openTransactionsByAsset.get(assetId) ?? { longs: [], shorts: [] };
        if (tx.type === "long") {
          entry.longs.push(normalized);
        } else if (tx.type === "short") {
          entry.shorts.push(normalized);
        }
        openTransactionsByAsset.set(assetId, entry);
      });

      openTransactionsByAsset.forEach(entry => {
        entry.longs.sort((a, b) => a.openDate - b.openDate);
        entry.shorts.sort((a, b) => a.openDate - b.openDate);
      });

      // guardar para uso al guardar (FIFO en cierre real)
      openPositionsByAssetRef.current = openTransactionsByAsset;

      // Traemos precios externos para assets que no son crypto (acciones, commodities, etc.).
      const nonCryptoAssets = allAssets.filter(asset => asset.type !== "crypto");
      const otherAssetPricesEntries = await Promise.all(
        nonCryptoAssets.map(async asset => {
          const price = await fetchExternalAssetPrice(
            asset.symbol,
            asset.type,
            lastPriceUsdtSell,
            penToUsd
          );
          return [asset.symbol, price ?? null] as const;
        })
      );
      const externalPriceMap = new Map<string, number>();
      otherAssetPricesEntries.forEach(([symbol, price]) => {
        if (price != null && !Number.isNaN(price)) {
          externalPriceMap.set(symbol, price);
        }
      });

      // Calculamos cuánto valen las posiciones estáticas registradas para esos assets.
      const externalHoldingsInfo = nonCryptoAssets.map(asset => {
        const amount = getInitialInvestmentAmount(asset.initialInvestment);
        const price = externalPriceMap.get(asset.symbol) ?? null;
        const usdValue = amount != null && price != null ? amount * price : null;
        return { symbol: asset.symbol, amount, price, usdValue };
      });

      const externalValueMap = new Map<string, number>();
      externalHoldingsInfo.forEach(info => {
        if (info.usdValue != null) {
          externalValueMap.set(info.symbol, info.usdValue);
        }
      });

      // Preparamos balances adicionales para alimentar calculateTotalBalances.
      const externalBalanceEntries = externalHoldingsInfo
        .filter(
          info =>
            typeof info.symbol === "string" &&
            info.symbol !== "USD" &&
            info.symbol !== "PEN" &&
            info.usdValue != null &&
            info.usdValue > 0
        )
        .map(info => ({
          asset: info.symbol,
          total: typeof info.amount === "number" ? info.amount : 0,
          usdValue: info.usdValue as number,
        }));

      const designatedTotal = nonFiatAssets.reduce(
        (acc, asset) => acc + (asset.totalCapitalWhenLastAdded ?? 0),
        0
      );

      const configUsd = configMap.get("totalUSD") ?? 0;
      const penTotal = configMap.get("totalPen") ?? totals.pen ?? 0;
      const penUsdValue = penToUsd ? penTotal * penToUsd : 0;
      const totalUsdFromBalances = totals.usd ?? configUsd;
      const usdtBalanceEntry = balanceMap.get("USDT");
      const usdtUsdValue = usdtBalanceEntry?.usdValue ?? 0;

      // Balance consolidado de todo el portafolio (mismo cálculo que la pantalla de Balances).
      const { totalUsd: portfolioTotal } = calculateTotalBalances({
        balances: balanceList,
        totals: { usd: totalUsdFromBalances, pen: penTotal },
        penPrice: penToUsd > 0 ? penToUsd : null,
        usdtSellPrice,
        additionalBalances: externalBalanceEntries,
      });

      // Ajustamos en memoria el capital asignado por activo (totalCapitalWhenLastAdded) para reflejar
      // excedentes o déficits globales antes de calcular allocations específicas.
      const difference = portfolioTotal - designatedTotal;
      const adjustedAllocationByAssetId = new Map<string, number>();
      const ALLOCATION_EPSILON = 1e-6;
      const POSITIVE_BUFFER = 200; // Evita reajustar por excedentes pequeños

      if (nonFiatAssets.length > 0) {
        const allocations = nonFiatAssets.map(asset => ({
          asset,
          allocation: Math.max(asset.totalCapitalWhenLastAdded ?? 0, 0),
        }));

        if (difference < -ALLOCATION_EPSILON) {
          let deficit = Math.abs(difference);
          let active = allocations.filter(item => item.allocation > ALLOCATION_EPSILON);

          while (deficit > ALLOCATION_EPSILON && active.length) {
            const share = deficit / active.length;
            let consumed = 0;
            const nextActive: typeof active = [];

            for (const item of active) {
              const reducible = Math.min(share, item.allocation);
              if (reducible > ALLOCATION_EPSILON) {
                item.allocation -= reducible;
                deficit -= reducible;
                consumed += reducible;
              }
              if (item.allocation > ALLOCATION_EPSILON) {
                nextActive.push(item);
              } else {
                item.allocation = 0;
              }
            }

            if (consumed <= ALLOCATION_EPSILON) {
              break;
            }

            active = nextActive;
          }
        } else if (difference > POSITIVE_BUFFER) {
          const surplus = difference - POSITIVE_BUFFER;
          if (surplus > ALLOCATION_EPSILON) {
            const share = surplus / allocations.length;
            for (const item of allocations) {
              item.allocation += share;
            }
          }
        }

        for (const { asset, allocation } of allocations) {
          adjustedAllocationByAssetId.set(asset._id ?? asset.symbol, allocation);
        }
      }


      const operationsResult: Operation[] = [];

      // Iteramos cada asset (incluidos pares fiat) para construir la sugerencia adecuada.
      for (const asset of assets) {
        const adjustedAllocation = adjustedAllocationByAssetId.get(asset._id ?? asset.symbol);
        const baseAllocation =
          adjustedAllocation != null
            ? adjustedAllocation
            : Math.max(asset.totalCapitalWhenLastAdded ?? 0, 0);
        let allocation = Math.max(baseAllocation, 0);

        if (asset.symbol === "USDTUSD") {
          allocation = Math.max(totalUsdFromBalances + usdtUsdValue, 0);
        } else if (asset.symbol === "USDPEN") {
          allocation = Math.max(totalUsdFromBalances + penUsdValue, 0);
        }
        if (allocation <= ALLOCATION_EPSILON) continue;

        // Separar par base/quote para entender cantidades en juego.
        const { baseAsset, quoteAsset } = splitSymbol(asset.symbol);
        const isUsdtPair = asset.symbol === "USDTUSD";

        const rawExchange = asset.exchange ?? asset.exchangeName ?? null;
        const exchangeId =
          typeof rawExchange === "string" && isLikelyObjectId(rawExchange)
            ? rawExchange
            : typeof rawExchange === "object" && rawExchange
            ? ((rawExchange as { _id?: string; id?: string })._id ?? (rawExchange as { id?: string }).id ?? null)
            : null;
        const exchangeName =
          typeof asset.exchangeName === "string"
            ? asset.exchangeName
            : typeof rawExchange === "object" && rawExchange && typeof (rawExchange as { name?: string }).name === "string"
            ? (rawExchange as { name?: string }).name!
            : typeof rawExchange === "string" && !isLikelyObjectId(rawExchange)
            ? rawExchange
            : null;
        const isBinance = isBinanceExchangeValue(exchangeId) || isBinanceExchangeValue(exchangeName);

        let fetchedPrice: number | null;
        if (asset.type === "crypto") {
          fetchedPrice = await fetchAssetPrice(
            asset.symbol,
            lastPriceUsdtSell,
            usdToPen ?? 0
          );
        } else {
          // Para stocks/commodities usamos la tabla de precios externos (Yahoo, etc.).
          fetchedPrice = externalPriceMap.get(asset.symbol) ?? null;
          if (!fetchedPrice) {
            fetchedPrice = await fetchExternalAssetPrice(
              asset.symbol,
              asset.type,
              lastPriceUsdtSell,
              penToUsd
            );
            if (fetchedPrice != null) {
              externalPriceMap.set(asset.symbol, fetchedPrice);
            }
          }
        }

        if (!fetchedPrice || fetchedPrice <= 0) {
          if (!isUsdtPair) {
            continue;
          }
        }

        const stockHoldingValue = externalValueMap.get(asset.symbol) ?? 0;
        // Datos actuales de tenencia para el activo base y la contraparte quote.
        const baseHolding = getHoldingData(
          baseAsset,
          balanceMap,
          totals,
          penToUsd,
          lastPriceUsdtSell,
          stockHoldingValue
        );
        const quoteHolding = getHoldingData(
          quoteAsset,
          balanceMap,
          totals,
          penToUsd,
          lastPriceUsdtSell
        );

        // Slope controla qué fracción del capital debe permanecer en base/quote.
        const slopeFraction = (asset.slope ?? 0) / 100;
        const baseHoldFraction = slopeFraction > 0 ? Math.min(slopeFraction, 1) : 0;
        const quoteHoldFraction = slopeFraction < 0 ? Math.min(Math.abs(slopeFraction), 1) : 0;

        const baseHoldUsd = allocation * baseHoldFraction;
        const quoteHoldUsd = allocation * quoteHoldFraction;
        const maxBaseAllowed = Math.max(allocation - quoteHoldUsd, 0);

        // evaluateScenario calcula qué tan conveniente es comprar/vender dado un precio.
        const evaluateScenario = async (
          scenarioPrice: number | null | undefined,
          {
            allowUpdates,
            priceLabel,
            expectAction,
          }: {
            allowUpdates: boolean;
            priceLabel?: string;
            expectAction?: "buy" | "sell";
          }
        ) => {
          // Tomamos el precio del escenario (override) o el market actual.
          let price = scenarioPrice ?? fetchedPrice ?? null;
          if (!price || price <= 0) return;

          let minPrice = asset.minPriceSevenYear;
          let maxPrice = asset.maxPriceSevenYear;

          if (allowUpdates) {
            const updates: Partial<AssetDocument> = {};
            if (price < minPrice) {
              minPrice = price;
              updates.minPriceSevenYear = price;
            }
            if (price > maxPrice) {
              maxPrice = price;
              updates.maxPriceSevenYear = price;
            }

            if (Object.keys(updates).length > 0) {
              try {
                await api.put(`/assets/${asset._id}`, updates);
              } catch (updateErr) {
                const isBadRequest =
                  updateErr &&
                  typeof updateErr === "object" &&
                  "response" in updateErr &&
                  (updateErr as any).response?.status === 400;
                if (!isBadRequest) {
                  console.warn("No se pudo actualizar límites para", asset.symbol, updateErr);
                }
              }
            }
          }

          // Valor actual de la cartera en base/quote para comparar con objetivo heurístico.
          const actualBaseUsd = isUsdtPair ? baseHolding.amount * price : baseHolding.usdValue;
          const actualQuoteUsd = quoteHolding.usdValue;

          // Normalizamos el precio en el rango histórico para calcular ponderaciones.
          const priceRange = maxPrice - minPrice;
          const normalized = priceRange === 0 ? 0.5 : clamp((price - minPrice) / priceRange, 0, 1);
          let baseShare = 1 - normalized;
          baseShare = clamp(baseShare, 0, 1);
          const desiredBaseUsd = allocation * baseShare;

          let targetBaseCandidate = desiredBaseUsd;
          const rawBaseDiff = desiredBaseUsd - actualBaseUsd;
          const rawSellUsd = rawBaseDiff < 0 ? -rawBaseDiff : 0;

          if (baseHoldUsd > 0) {
            const availableExcess = Math.max(0, actualBaseUsd - baseHoldUsd);
            if (rawSellUsd > 0) {
              if (rawSellUsd < baseHoldUsd || availableExcess <= BASE_TOLERANCE) {
                targetBaseCandidate = actualBaseUsd; // no venta, proteger reserva
              } else {
                const sellFinal = Math.min(rawSellUsd - baseHoldUsd, availableExcess);
                targetBaseCandidate = actualBaseUsd - sellFinal;
              }
            }
          }


          const adjustedDesiredBaseUsd = clamp(targetBaseCandidate, 0, maxBaseAllowed);

          let targetBaseUsd: number;
          if (actualBaseUsd < adjustedDesiredBaseUsd) {
            targetBaseUsd = Math.min(adjustedDesiredBaseUsd, maxBaseAllowed);
          } else {
            const minimumAfterSell = Math.max(adjustedDesiredBaseUsd, baseHoldUsd);
            const cappedMinimum = clamp(minimumAfterSell, 0, maxBaseAllowed);
            targetBaseUsd = actualBaseUsd > cappedMinimum ? cappedMinimum : actualBaseUsd;
          }

          targetBaseUsd = clamp(targetBaseUsd, 0, maxBaseAllowed);

          let targetQuoteUsd = allocation - targetBaseUsd;
          if (targetQuoteUsd < quoteHoldUsd) {
            targetQuoteUsd = quoteHoldUsd;
            targetBaseUsd = clamp(allocation - targetQuoteUsd, 0, maxBaseAllowed);
          }

          const baseDiffUsd = targetBaseUsd - actualBaseUsd;
          const action: "buy" | "sell" = baseDiffUsd > 0 ? "buy" : "sell";

          // Si se espera una acción específica (solo USDTUSD/P2P), descarta la contraria
          if (expectAction && action !== expectAction) return;

          if (Math.abs(baseDiffUsd) <= BASE_TOLERANCE) {
            return;
          }

          const priceIsValid = Number.isFinite(price) && price > 0;
          const quoteUpper = quoteAsset?.toUpperCase?.() ?? quoteAsset;
          const baseAmountUnits =
            baseAsset === "USD" || !priceIsValid ? baseDiffUsd : baseDiffUsd / (price as number);
          const absBaseAmount = Math.abs(baseAmountUnits);
          const absDiffUsd = Math.abs(baseDiffUsd);
          const quoteValue = (() => {
            if (!priceIsValid) return absDiffUsd;
            if (quoteUpper === "USD" || quoteUpper === "USDT" || quoteUpper === "USDC") {
              return absDiffUsd;
            }
            return absBaseAmount * (price as number);
          })();

          // Skip if below $10 threshold
          if (quoteValue < 10) {
            return;
          }

          const approxLabel =
            quoteUpper === "USD" || quoteUpper === "USDT" || quoteUpper === "USDC"
              ? `$${absDiffUsd.toFixed(2)}`
              : `${quoteValue.toFixed(2)} ${quoteUpper}`;

          let actionMessage: string;

          if (baseDiffUsd > 0) {
            actionMessage = isUsdtPair
              ? `Comprar ${absBaseAmount.toFixed(6)} ${baseAsset} (~${approxLabel}) usando ${quoteAsset} a $${price.toFixed(4)} (PrecioCompraUSDT).`
              : `Comprar ${absBaseAmount.toFixed(6)} ${baseAsset} (~${approxLabel}) usando ${quoteAsset}.`;
          } else {
            actionMessage = isUsdtPair
              ? `Vender ${absBaseAmount.toFixed(6)} ${baseAsset} (~${approxLabel}) por ${quoteAsset} a $${price.toFixed(4)} (PrecioVentaUSDT).`
              : `Vender ${absBaseAmount.toFixed(6)} ${baseAsset} (~${approxLabel}) por ${quoteAsset}.`;
          }

          const suggestedBaseAmount = absBaseAmount;

          //

          const slopeSign: 1 | 0 | -1 = slopeFraction > 0 ? 1 : slopeFraction < 0 ? -1 : 0;

          const operation: Operation = {
            id: `${asset._id}-${priceLabel ?? 'spot'}-${action}`,
            assetId: asset._id,
            symbol: asset.symbol,
            action,
            baseAsset,
            quoteAsset,
            fiatCurrency: quoteAsset,
            exchangeId: exchangeId,
            exchangeName,
            isBinance,
            usdtUsdRate,
            allocation,
            price,
            priceLabel,
            slopeSign,
            buyPrice: isUsdtPair ? usdtBuyPrice ?? undefined : undefined,
            sellPrice: isUsdtPair ? usdtSellPrice ?? undefined : undefined,
            suggestedBaseAmount,
            suggestedFiatValue: quoteValue,
            targetBaseUsd,
            targetQuoteUsd,
            targetBasePercent: allocation > 0 ? targetBaseUsd / allocation : 0,
            actualBaseUsd,
            actualQuoteUsd,
            baseDiffUsd,
            actionMessage,
            actualBaseAmountUnits: baseHolding.amount,
            minPrice,
            maxPrice,
            baseHoldUsd,
            quoteHoldUsd,
            maxBaseAllowed,
            baseHoldingUsd: baseHolding.usdValue,
            quoteHoldingUsd: quoteHolding.usdValue,
            slopeFraction,
          };

          operationsResult.push(operation);
        };

        if (isUsdtPair) {
          if (usdtBuyPrice != null) {
            await evaluateScenario(usdtBuyPrice, {
              allowUpdates: true,
              priceLabel: "PrecioCompraUSDT",
              expectAction: "buy",
            });
          }
          if (usdtSellPrice != null) {
            await evaluateScenario(usdtSellPrice, {
              allowUpdates: false,
              priceLabel: "PrecioVentaUSDT",
              expectAction: "sell",
            });
          }
        } else {
          await evaluateScenario(fetchedPrice, {
            allowUpdates: true,
          });
        }
      }

      const adjustedOperations = operationsResult
        .map(op => adjustOperationForClosings(op, openTransactionsByAsset.get(op.assetId)))
        .filter((op): op is Operation => Boolean(op));

      setOperations(adjustedOperations);
      } catch (err: any) {
        console.error("❌ Error cargando transacciones:", err);
        setError("No se pudieron cargar las transacciones sugeridas.");
      } finally {
        isFetchingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  // simulateOperation: re-evalúa una sugerencia con un precio override y devuelve el resultado.
  const simulateOperation = useCallback(
    (op: Operation, overridePrice: number): SimulationResult => {
      if (!Number.isFinite(overridePrice) || overridePrice <= 0) {
        return {
          status: "invalid",
          message: "Ingresa un precio válido mayor a 0.",
        };
      }

      const price = Number(overridePrice);
      const baseUpper = op.baseAsset?.toUpperCase?.() ?? op.baseAsset;
      const quoteUpper = op.quoteAsset?.toUpperCase?.() ?? op.quoteAsset;
      const isUsdtPair = op.symbol === "USDTUSD";

      let min = Number.isFinite(op.minPrice) ? (op.minPrice as number) : price;
      let max = Number.isFinite(op.maxPrice) ? (op.maxPrice as number) : price;
      if (min > max) {
        const temp = min;
        min = max;
        max = temp;
      }

      const allocation = op.allocation;
      const baseHoldingAmount = op.actualBaseAmountUnits ?? 0;
      const baseHoldingUsd = op.baseHoldingUsd ?? op.actualBaseUsd;
      const quoteHoldingUsd = op.quoteHoldingUsd ?? op.actualQuoteUsd;
      const baseHoldUsd = op.baseHoldUsd ?? 0;
      const quoteHoldUsd = op.quoteHoldUsd ?? 0;
      const maxBaseAllowed = op.maxBaseAllowed ?? op.allocation;

      let actualBaseUsd = op.actualBaseUsd;
      if (baseUpper === "USD") {
        actualBaseUsd = baseHoldingUsd;
      } else if (Number.isFinite(baseHoldingAmount)) {
        actualBaseUsd = Number((baseHoldingAmount * price).toFixed(8));
      }
      if (!Number.isFinite(actualBaseUsd)) {
        actualBaseUsd = op.actualBaseUsd;
      }

      const actualQuoteUsd = quoteHoldingUsd;

      const priceRange = max - min;
      const normalized = priceRange === 0 ? 0.5 : clamp((price - min) / priceRange, 0, 1);
      let baseShare = clamp(1 - normalized, 0, 1);
      const desiredBaseUsd = allocation * baseShare;

      let targetBaseCandidate = desiredBaseUsd;
      const rawBaseDiff = desiredBaseUsd - actualBaseUsd;
      const rawSellUsd = rawBaseDiff < 0 ? -rawBaseDiff : 0;

      if (baseHoldUsd > 0) {
        const availableExcess = Math.max(0, actualBaseUsd - baseHoldUsd);
        if (rawSellUsd > 0) {
          if (rawSellUsd < baseHoldUsd || availableExcess <= BASE_TOLERANCE) {
            targetBaseCandidate = actualBaseUsd;
          } else {
            const sellFinal = Math.min(rawSellUsd - baseHoldUsd, availableExcess);
            targetBaseCandidate = actualBaseUsd - sellFinal;
          }
        }
      }

      const adjustedDesiredBaseUsd = clamp(targetBaseCandidate, 0, maxBaseAllowed);

      let targetBaseUsd: number;
      if (actualBaseUsd < adjustedDesiredBaseUsd) {
        targetBaseUsd = Math.min(adjustedDesiredBaseUsd, maxBaseAllowed);
      } else {
        const minimumAfterSell = Math.max(adjustedDesiredBaseUsd, baseHoldUsd);
        const cappedMinimum = clamp(minimumAfterSell, 0, maxBaseAllowed);
        targetBaseUsd = actualBaseUsd > cappedMinimum ? cappedMinimum : actualBaseUsd;
      }

      targetBaseUsd = clamp(targetBaseUsd, 0, maxBaseAllowed);

      let targetQuoteUsd = allocation - targetBaseUsd;
      if (targetQuoteUsd < quoteHoldUsd) {
        targetQuoteUsd = quoteHoldUsd;
        targetBaseUsd = clamp(allocation - targetQuoteUsd, 0, maxBaseAllowed);
      }

      const baseDiffUsd = Number((targetBaseUsd - actualBaseUsd).toFixed(8));

      if (Math.abs(baseDiffUsd) <= BASE_TOLERANCE) {
        return {
          status: "none",
          message: "Con este precio no se debe operar; la diferencia es despreciable.",
        };
      }

      const action: "buy" | "sell" = baseDiffUsd > 0 ? "buy" : "sell";
      const priceIsValid = Number.isFinite(price) && price > 0;
      let suggestedBaseAmount =
        baseUpper === "USD" || !priceIsValid
          ? Math.abs(baseDiffUsd)
          : Math.abs(baseDiffUsd) / price;

      if (!Number.isFinite(suggestedBaseAmount) || suggestedBaseAmount <= 0) {
        return {
          status: "none",
          message: "Con este precio no se debe operar.",
        };
      }

      suggestedBaseAmount = Number(suggestedBaseAmount.toFixed(8));

      const suggestedFiatValue = (() => {
        if (!priceIsValid) return Math.abs(baseDiffUsd);
        if (quoteUpper === "USD" || quoteUpper === "USDT" || quoteUpper === "USDC") {
          return Math.abs(baseDiffUsd);
        }
        return suggestedBaseAmount * price;
      })();

      // Skip suggesting operations if below $10 (both buy and sell)
      if (suggestedFiatValue < 10) {
        return {
          status: "none",
          message: "Operación omitida: monto menor a $10.",
        };
      }

      const approxLabel =
        quoteUpper === "USD" || quoteUpper === "USDT" || quoteUpper === "USDC"
          ? `$${Math.abs(baseDiffUsd).toFixed(2)}`
          : `${suggestedFiatValue.toFixed(2)} ${quoteUpper}`;

      const usdtLabel = action === "buy" ? "PrecioCompraUSDT" : "PrecioVentaUSDT";
      let actionMessage: string;
      if (action === "buy") {
        actionMessage = isUsdtPair
          ? `Comprar ${suggestedBaseAmount.toFixed(6)} ${op.baseAsset} (~${approxLabel}) usando ${op.quoteAsset} a $${price.toFixed(4)} (${usdtLabel}).`
          : `Comprar ${suggestedBaseAmount.toFixed(6)} ${op.baseAsset} (~${approxLabel}) usando ${op.quoteAsset}.`;
      } else {
        actionMessage = isUsdtPair
          ? `Vender ${suggestedBaseAmount.toFixed(6)} ${op.baseAsset} (~${approxLabel}) por ${op.quoteAsset} a $${price.toFixed(4)} (${usdtLabel}).`
          : `Vender ${suggestedBaseAmount.toFixed(6)} ${op.baseAsset} (~${approxLabel}) por ${op.quoteAsset}.`;
      }

      const simulatedOp: Operation = {
        ...op,
        price,
        action,
        actionMessage,
        baseDiffUsd,
        suggestedBaseAmount,
        suggestedFiatValue,
        actualBaseUsd,
        actualQuoteUsd,
        targetBaseUsd,
        targetQuoteUsd,
        targetBasePercent: allocation > 0 ? targetBaseUsd / allocation : 0,
      };

      const adjusted = adjustOperationForClosings(
        simulatedOp,
        openPositionsByAssetRef.current.get(op.assetId)
      );

      if (!adjusted) {
        return {
          status: "none",
          message: "A este precio no se debe operar (no hay cierres rentables).",
        };
      }

      return {
        status: "action",
        message: adjusted.actionMessage,
        suggestedBaseAmount: adjusted.suggestedBaseAmount,
        suggestedFiatValue: adjusted.suggestedFiatValue,
        action: adjusted.action,
        operation: adjusted,
      };
    },
    []
  );

  // Al enfocar la pantalla, forzamos un primer fetch.
  useFocusEffect(
    useCallback(() => {
      hasFetchedOnFocus.current = true;
      loadData();
    }, [loadData])
  );

  // También hacemos un fetch inicial si aún no ocurrió via focus.
  useEffect(() => {
    if (!hasFetchedOnFocus.current) {
      loadData();
    }
  }, [loadData]);

  // Refresco automático cada 15s para mantener precios y sugerencias al día.
  useEffect(() => {
    const interval = setInterval(() => {
      loadData({ silent: true });
    }, 15_000);

    return () => clearInterval(interval);
  }, [loadData]);

  // Handler para gesto pull-to-refresh en el ScrollView.
  const refreshHandler = useCallback(() => {
    setRefreshing(true);
    loadData({ silent: true });
  }, [loadData]);

  // Limpiamos priceOverrides al cambiar la lista de operaciones activas.
  useEffect(() => {
    setPriceOverrides(prev => {
      const next: Record<string, PriceOverrideState> = {};
      let changed = false;
      operations.forEach(op => {
        if (prev[op.id]) {
          next[op.id] = prev[op.id];
        }
      });
      if (Object.keys(next).length !== Object.keys(prev).length) {
        changed = true;
      }
      if (!changed) {
        for (const key of Object.keys(next)) {
          if (next[key] !== prev[key]) {
            changed = true;
            break;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [operations]);

  // handleSimulatedPriceChange: actualiza overrides de precio y recalcula simulación.
  const handleSimulatedPriceChange = useCallback(
    (op: Operation, value: string) => {
      setPriceOverrides(prev => {
        const next = { ...prev };
        const price = parseNumberInput(value);
        const current = prev[op.id];
        let result: SimulationResult | null = null;
        if (value.trim().length === 0) {
          result = null;
        } else if (Number.isFinite(price) && price > 0) {
          result = simulateOperation(op, price);
        } else {
          result = {
            status: "invalid",
            message: "Ingresa un precio válido.",
          };
        }
        next[op.id] = {
          input: value,
          result,
          visible: current?.visible ?? true,
        };
        return next;
      });
    },
    [simulateOperation]
  );

  // togglePriceOverride: muestra/oculta el input manual de precio para una operación puntual.
  const togglePriceOverride = useCallback((opId: string) => {
    setPriceOverrides(prev => {
      const next = { ...prev };
      const current = next[opId];
      const visible = !(current?.visible ?? false);
      next[opId] = {
        input: current?.input ?? "",
        result: current?.result ?? null,
        visible,
      };
      return next;
    });
  }, []);

  // resolveOperationForAction: devuelve la operación resultante (override > sugerencia original).
  const resolveOperationForAction = useCallback(
    (operation: Operation): Operation => {
      const override = priceOverrides[operation.id];
      const overrideResult = override?.result;
      if (overrideResult?.status === "action" && overrideResult.operation) {
        return overrideResult.operation;
      }
      return operation;
    },
    [priceOverrides]
  );

  // formatNumberForInput: helper para mostrar números en inputs sin notación científica.
  const formatNumberForInput = (value: number | null | undefined, precision = 6) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    return value.toFixed(precision);
  };

  // handleOperationPress: abre/cierra modal con detalle de la operación seleccionada.
  const handleOperationPress = useCallback(
    (operation: Operation) => {
      if (operation.action !== "sell" && operation.action !== "buy") return;
      const derivedOperation = resolveOperationForAction(operation);
      setSelectedOperation(derivedOperation);
      setSuggestionModalVisible(true);
    },
    [resolveOperationForAction]
  );

  // handleRegisterPress: prepara el formulario de registro con datos precargados.
  const handleRegisterPress = useCallback(
    (operation: Operation) => {
      const derived = resolveOperationForAction(operation);
      const defaultType: "long" | "short" = derived.action === "sell" ? "short" : "long";
      const fiatCurrency = derived.quoteAsset?.toUpperCase?.() ?? "USDT";
      const pricePrecision = fiatCurrency === "USDT" ? 8 : 6;
      const defaultPrice = formatNumberForInput(derived.price, pricePrecision);
      const defaultAmount = formatNumberForInput(derived.suggestedBaseAmount, 8);
      const defaultFiat = formatNumberForInput(
        derived.suggestedFiatValue ??
          (typeof derived.price === "number" && typeof derived.suggestedBaseAmount === "number"
            ? derived.price * derived.suggestedBaseAmount
            : undefined),
        fiatCurrency === "USD" ? 2 : fiatCurrency === "USDT" ? 8 : 4
      );
      const defaultOpenDate = new Date().toISOString();

      setRegisterTarget(derived);
      setRegisterForm({
        type: defaultType,
        openPrice: defaultPrice,
        amount: defaultAmount,
        openValueFiat: defaultFiat,
        fiatCurrency,
        openFee: "",
        openFeeCurrency: derived.isBinance ? "BNB" : "USD",
        openDate: defaultOpenDate,
      });
      setRegisterError(null);
      setRegisterModalVisible(true);
    },
    [resolveOperationForAction]
  );

  const registerOpenDateLabel = useMemo(() => formatDateTimeLabel(registerForm.openDate), [registerForm.openDate]);

  // Helper para cerrar el modal de registro y limpiar estado temporal.
  const closeRegisterModal = useCallback(() => {
    setRegisterModalVisible(false);
    setRegisterTarget(null);
    setRegisterForm(createEmptyRegisterForm());
    setRegisterError(null);
    setDatePickerVisible(false);
  }, []);

  const openRegisterDatePicker = useCallback(() => {
    const parsed = registerForm.openDate ? new Date(registerForm.openDate) : new Date();
    const timestamp = parsed.getTime();
    const initial = Number.isFinite(timestamp) ? parsed : new Date();
    setDatePickerValue(initial);
    setDatePickerVisible(true);
  }, [registerForm.openDate]);

  const handleDatePickerIosChange = useCallback((_: DateTimePickerEvent, selectedDate?: Date) => {
    if (selectedDate) {
      setDatePickerValue(selectedDate);
    }
  }, []);

  const handleDatePickerDateChange = useCallback((_: DateTimePickerEvent, selectedDate?: Date) => {
    if (!selectedDate) return;
    setDatePickerValue(prev => {
      const next = new Date(prev);
      next.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
      return next;
    });
  }, []);

  const handleDatePickerTimeChange = useCallback((_: DateTimePickerEvent, selectedDate?: Date) => {
    if (!selectedDate) return;
    setDatePickerValue(prev => {
      const next = new Date(prev);
      next.setHours(
        selectedDate.getHours(),
        selectedDate.getMinutes(),
        selectedDate.getSeconds(),
        selectedDate.getMilliseconds()
      );
      return next;
    });
  }, []);

  const handleDatePickerCancel = useCallback(() => {
    setDatePickerVisible(false);
  }, []);

  const handleDatePickerConfirm = useCallback(() => {
    setRegisterForm(prev => ({ ...prev, openDate: datePickerValue.toISOString() }));
    setDatePickerVisible(false);
  }, [datePickerValue]);

  // handleRegisterFieldChange: sincroniza campos del formulario (conversión automática a mayúsculas para moneda).
  const handleRegisterFieldChange = useCallback(
    (field: keyof RegisterFormState, value: string) => {
      setRegisterForm(prev => ({ ...prev, [field]: value }));
    },
    []
  );

  // recalculateRegisterFiat: recalcula el valor fiat a partir de precio * cantidad.
  const recalculateRegisterFiat = useCallback(() => {
    const price = parseNumberInput(registerForm.openPrice);
    const amount = parseNumberInput(registerForm.amount);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(amount) || amount <= 0) {
      setRegisterError("Ingresa precio y cantidad válidos para recalcular.");
      return;
    }
    const computed = Number((price * amount).toFixed(8));
    setRegisterForm(prev => ({ ...prev, openValueFiat: computed.toString() }));
    setRegisterError(null);
  }, [registerForm.amount, registerForm.openPrice]);

  // handleRegisterSubmit: envía el formulario para registrar una operación ejecutada.
  const handleRegisterSubmit = useCallback(async () => {
    if (!registerTarget) return;

    const price = parseNumberInput(registerForm.openPrice);
    const amount = parseNumberInput(registerForm.amount);
    let openValueFiat = parseNumberInput(registerForm.openValueFiat);
    const fee = parseNumberInput(registerForm.openFee);

    if (!Number.isFinite(price) || price <= 0) {
      setRegisterError("Ingresa un precio válido.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setRegisterError("Ingresa una cantidad válida.");
      return;
    }

    if (!Number.isFinite(openValueFiat) || openValueFiat <= 0) {
      openValueFiat = Number((price * amount).toFixed(8));
    }

    if (!Number.isFinite(openValueFiat) || openValueFiat <= 0) {
      setRegisterError("Ingresa un monto en fiat válido.");
      return;
    }

    if (openValueFiat < 10) {
      setRegisterError("El monto debe ser al menos $10.");
      return;
    }

    const fiatCurrency = (registerForm.fiatCurrency || registerTarget.quoteAsset || "USDT").toUpperCase();
    const normalizedType: "long" | "short" = registerForm.type === "short" ? "short" : "long";
    const feeCurrency = (registerForm.openFeeCurrency || fiatCurrency).toUpperCase();

    const payload: Record<string, unknown> = {
      asset: registerTarget.assetId,
      type: normalizedType,
      fiatCurrency,
      openPrice: price,
      amount,
      openValueFiat,
    };

    if (Number.isFinite(fee) && fee > 0) {
      payload.openFee = fee;
      payload.openFeeCurrency = feeCurrency;
    }

    if (registerForm.openDate.trim().length > 0) {
      const date = new Date(registerForm.openDate.trim());
      if (Number.isNaN(date.getTime())) {
        setRegisterError("Fecha inválida. Usa un formato ISO o deja el campo vacío.");
        return;
      }
      payload.openDate = date.toISOString();
    }

    setRegisterSubmitting(true);
    try {
      await api.post("/transactions", payload);
      Alert.alert("Transacción registrada", "La transacción se guardó correctamente.");
      closeRegisterModal();
      await loadData({ silent: true });
    } catch (err: any) {
      const message = err?.response?.data?.error ?? err?.message ?? "No se pudo registrar la transacción.";
      setRegisterError(typeof message === "string" ? message : "No se pudo registrar la transacción.");
    } finally {
      setRegisterSubmitting(false);
    }
  }, [closeRegisterModal, loadData, registerForm, registerTarget]);

  // Cierra el modal de sugerencias y resetea selección.
  const closeSuggestionModal = useCallback(() => {
    setSuggestionModalVisible(false);
    setSelectedOperation(null);
  }, []);

  const sortedAssetOptions = useMemo(
    () => [...assetOptions].sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [assetOptions]
  );

  const openAddTransactionModal = useCallback(() => {
    if (sortedAssetOptions.length === 0) {
      Alert.alert("Sin pares disponibles", "No hay pares configurados para registrar transacciones.");
      return;
    }
    setManualSelectedAssetId(sortedAssetOptions[0]._id ?? null);
    setAddTransactionModalVisible(true);
  }, [sortedAssetOptions]);

  const closeAddTransactionModal = useCallback(() => {
    setAddTransactionModalVisible(false);
  }, []);

  const handleManualPairSelect = useCallback((assetId: string) => {
    setManualSelectedAssetId(assetId);
  }, []);

  const handleManualPairConfirm = useCallback(() => {
    if (!manualSelectedAssetId) {
      Alert.alert("Selecciona un par", "Debes elegir el par de la transacción antes de continuar.");
      return;
    }

    const asset = sortedAssetOptions.find(item => item._id === manualSelectedAssetId);
    if (!asset) {
      Alert.alert("Par no disponible", "No se encontró el par seleccionado. Intenta nuevamente.");
      return;
    }

    const { baseAsset, quoteAsset } = splitSymbol(asset.symbol);
    const normalizedQuote = quoteAsset.toUpperCase();
    const exchangeValue = asset.exchange ?? asset.exchangeName ?? null;
    const exchangeId =
      typeof asset.exchange === "string"
        ? asset.exchange
        : asset.exchange && typeof asset.exchange === "object"
        ? asset.exchange._id ?? asset.exchange.id ?? null
        : null;
    const exchangeName =
      typeof asset.exchange === "object"
        ? asset.exchange.name ?? null
        : typeof asset.exchangeName === "string"
        ? asset.exchangeName
        : null;
    const binance = isBinanceExchangeValue(exchangeValue);

    const manualOperation: Operation = {
      id: `manual-${asset._id}`,
      assetId: asset._id,
      symbol: asset.symbol,
      baseAsset,
      quoteAsset: normalizedQuote,
      fiatCurrency: normalizedQuote,
      exchangeId,
      exchangeName,
      isBinance: binance,
      usdtUsdRate: 1,
      allocation: 0,
      price: 0,
      action: "buy",
      suggestedBaseAmount: 0,
      suggestedFiatValue: 0,
      targetBaseUsd: 0,
      targetQuoteUsd: 0,
      targetBasePercent: 0,
      actualBaseUsd: 0,
      actualQuoteUsd: 0,
      baseDiffUsd: 0,
      actionMessage: "Registro manual",
    };

    setRegisterTarget(manualOperation);
    setRegisterForm({
      type: "long",
      openPrice: "",
      amount: "",
      openValueFiat: "",
      fiatCurrency: normalizedQuote,
      openFee: "",
      openFeeCurrency: binance ? "BNB" : "USD",
      openDate: new Date().toISOString(),
    });
    setRegisterError(null);
    setAddTransactionModalVisible(false);
    setRegisterModalVisible(true);
  }, [manualSelectedAssetId, sortedAssetOptions]);

  // content: renderizado condicional memoizado para spinner, errores o tarjetas.
  const content = useMemo(() => {
    if (loading && !refreshing) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.error}>{error}</Text>
        </View>
      );
    }

    if (operations.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={styles.empty}>No hay operaciones sugeridas en este momento.</Text>
        </View>
      );
    }

    return (
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshHandler} />}
      >
        {operations.map(op => {
          const isActionSupported = op.action === "sell" || op.action === "buy";
          const tradeHint =
            op.action === "sell"
              ? "Pulsa para ver la sugerencia de venta."
              : "Pulsa para ver la sugerencia de compra.";
          const overrideState = priceOverrides[op.id];
          const simulatedPriceText = overrideState?.input ?? "";
          const simulationResult = overrideState?.result ?? null;
          const simulationIsAction = simulationResult?.status === "action";
          const simulationIsInvalid = simulationResult?.status === "invalid";
          const simulationText = simulationResult?.message;
          const overrideVisible = overrideState?.visible ?? false;

          return (
            <View key={op.id} style={[styles.card, !isActionSupported && styles.cardDisabled]}>
              <Text style={styles.cardTitle}>{op.symbol}</Text>
              <Text style={styles.detail}>
                {op.priceLabel ?? "Precio actual"}: ${op.price.toFixed(4)}
              </Text>
              {op.symbol === "USDTUSD" && (
                <Text style={styles.detail}>
                  Precio compra USDT: ${op.buyPrice?.toFixed(4) ?? "N/D"} | Precio venta USDT: $
                  {op.sellPrice?.toFixed(4) ?? "N/D"}
                </Text>
              )}
              <Text style={styles.action}>{op.actionMessage}</Text>

              {isActionSupported ? (
                <>
                  <View style={styles.customToggleRow}>
                    <TouchableOpacity
                      style={styles.customToggle}
                      onPress={() => togglePriceOverride(op.id)}
                    >
                      <Text style={styles.customToggleIcon}>{overrideVisible ? "✖️" : "🧮"}</Text>
                    </TouchableOpacity>
                  </View>
                  {overrideVisible ? (
                    <View style={styles.customSection}>
                      <Text style={styles.customLabel}>Simular con otro precio</Text>
                      <TextInput
                        style={styles.customInput}
                        value={simulatedPriceText}
                        placeholder={`Ej. ${op.price.toFixed(4)}`}
                        onChangeText={text => handleSimulatedPriceChange(op, text)}
                        keyboardType="numeric"
                      />
                      {simulationText ? (
                        <Text
                          style={[
                            styles.customResult,
                            simulationIsAction && styles.customResultOk,
                            (simulationResult?.status === "none" || simulationIsInvalid) && styles.customResultWarn,
                          ]}
                        >
                          {simulationText}
                        </Text>
                      ) : null}
                      {simulationIsAction &&
                        simulationResult?.suggestedBaseAmount != null &&
                        simulationResult?.suggestedFiatValue != null && (
                          <Text style={styles.customDetail}>
                            Cantidad sugerida: {formatAssetAmount(simulationResult.suggestedBaseAmount, op.baseAsset)}{' '}
                            {op.baseAsset} ({formatQuoteValue(simulationResult.suggestedFiatValue, op.quoteAsset)})
                          </Text>
                        )}
                    </View>
                  ) : null}
                  <TouchableOpacity
                    style={styles.cardButton}
                    onPress={() => handleOperationPress(op)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cardButtonText}>
                      {op.action === "buy" ? "Ver sugerencia de compra" : "Ver sugerencia de venta"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.cardButton, styles.cardButtonSecondary]}
                    onPress={() => handleRegisterPress(op)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cardButtonText}>Registrar transacción</Text>
                  </TouchableOpacity>
                  <Text style={styles.hint}>{tradeHint}</Text>
                </>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    );
  }, [
    error,
    handleOperationPress,
    handleSimulatedPriceChange,
    loading,
    operations,
    priceOverrides,
    refreshHandler,
    refreshing,
    togglePriceOverride,
    handleRegisterPress,
  ]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>📊 Transacciones sugeridas</Text>
        <TouchableOpacity
          style={[styles.addButton, assetOptions.length === 0 && styles.addButtonDisabled]}
          onPress={openAddTransactionModal}
          activeOpacity={0.8}
          disabled={assetOptions.length === 0}
        >
          <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>
      </View>
      {content}

      <Modal
        visible={addTransactionModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeAddTransactionModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Agregar transacción</Text>
            <Text style={styles.modalLabel}>Selecciona el par</Text>
            <ScrollView
              style={styles.pairList}
              contentContainerStyle={styles.pairListContent}
              showsVerticalScrollIndicator={false}
            >
              {sortedAssetOptions.length > 0 ? (
                sortedAssetOptions.map(asset => {
                  const selected = manualSelectedAssetId === asset._id;
                  const exchangeName =
                    typeof asset.exchange === "object"
                      ? asset.exchange?.name ?? null
                      : typeof asset.exchangeName === "string"
                      ? asset.exchangeName
                      : null;
                  const { baseAsset: base, quoteAsset: quote } = splitSymbol(asset.symbol);
                  return (
                    <TouchableOpacity
                      key={asset._id}
                      style={[styles.pairOption, selected && styles.pairOptionActive]}
                      onPress={() => handleManualPairSelect(asset._id)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.pairOptionText}>{asset.symbol}</Text>
                      <Text style={styles.pairOptionMeta}>
                        Base: {base} | Quote: {quote}
                      </Text>
                      {exchangeName ? <Text style={styles.pairOptionSubtext}>{exchangeName}</Text> : null}
                    </TouchableOpacity>
                  );
                })
              ) : (
                <Text style={styles.empty}>No hay pares disponibles.</Text>
              )}
            </ScrollView>
            <TouchableOpacity
              style={[
                styles.cardButton,
                styles.cardButtonSecondary,
                !manualSelectedAssetId && styles.cardButtonDisabled,
              ]}
              onPress={handleManualPairConfirm}
              activeOpacity={0.8}
              disabled={!manualSelectedAssetId}
            >
              <Text style={styles.cardButtonText}>Continuar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cardButton, styles.cardButtonGhost]}
              onPress={closeAddTransactionModal}
              activeOpacity={0.8}
            >
              <Text style={styles.cardButtonText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal con el detalle textual de la sugerencia seleccionada */}
      <Modal
        visible={suggestionModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeSuggestionModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedOperation ? (
              <>
                <Text style={styles.modalTitle}>{selectedOperation.symbol}</Text>
                <Text style={styles.modalLabel}>
                  Precio actual: ${selectedOperation.price.toFixed(4)}
                </Text>
                <Text style={styles.modalLabel}>
                  {selectedOperation.action === "buy" ? "Total a comprar" : "Total a vender"}
                </Text>
                <Text style={styles.modalValue}>
                  {formatAssetAmount(selectedOperation.suggestedBaseAmount, selectedOperation.baseAsset)}{' '}
                  {selectedOperation.baseAsset} ({
                    formatQuoteValue(selectedOperation.suggestedFiatValue, selectedOperation.quoteAsset)
                  })
                </Text>
                <TouchableOpacity
                  style={[styles.cardButton, styles.modalCloseButton]}
                  onPress={closeSuggestionModal}
                  activeOpacity={0.85}
                >
                  <Text style={styles.cardButtonText}>Cerrar</Text>
                </TouchableOpacity>
              </>
            ) : (
              <ActivityIndicator size="large" />
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={datePickerVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.datePickerModalCard}>
            <Text style={styles.modalTitle}>Seleccionar fecha de apertura</Text>
            {Platform.OS === "ios" ? (
              <DateTimePicker
                value={datePickerValue}
                mode="datetime"
                display="inline"
                onChange={handleDatePickerIosChange}
              />
            ) : (
              <>
                <DateTimePicker
                  value={datePickerValue}
                  mode="date"
                  display="calendar"
                  onChange={handleDatePickerDateChange}
                />
                <View style={styles.datePickerDivider} />
                <DateTimePicker
                  value={datePickerValue}
                  mode="time"
                  display="spinner"
                  onChange={handleDatePickerTimeChange}
                />
              </>
            )}
            <View style={styles.datePickerButtonsRow}>
              <TouchableOpacity
                onPress={handleDatePickerCancel}
                style={[styles.datePickerButton, styles.datePickerButtonSecondary]}
                activeOpacity={0.8}
              >
                <Text style={styles.datePickerButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDatePickerConfirm}
                style={styles.datePickerButton}
                activeOpacity={0.8}
              >
                <Text style={styles.datePickerButtonText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal para registrar manualmente la ejecución de una sugerencia */}
      <Modal
        visible={registerModalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeRegisterModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {registerTarget ? (
              <>
                <Text style={styles.modalTitle}>Registrar {registerTarget.symbol}</Text>
                <Text style={styles.customDetail}>
                  Base: {registerTarget.baseAsset} | Quote: {registerTarget.quoteAsset}
                </Text>
                {registerError ? (
                  <Text style={[styles.customResult, styles.customResultWarn, styles.modalError]}>
                    {registerError}
                  </Text>
                ) : null}
                <Text style={styles.modalLabel}>Tipo de posición</Text>
                <View style={styles.modalTypeRow}>
                  <TouchableOpacity
                    style={[
                      styles.modalTypeButton,
                      registerForm.type === "long" && styles.modalTypeButtonActive,
                    ]}
                    onPress={() => setRegisterForm(prev => ({ ...prev, type: "long" }))}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.modalTypeButtonText,
                        registerForm.type === "long" && styles.modalTypeButtonTextActive,
                      ]}
                    >
                      Long
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalTypeButton,
                      registerForm.type === "short" && styles.modalTypeButtonActive,
                    ]}
                    onPress={() => setRegisterForm(prev => ({ ...prev, type: "short" }))}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.modalTypeButtonText,
                        registerForm.type === "short" && styles.modalTypeButtonTextActive,
                      ]}
                    >
                      Short
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalLabel}>Precio de apertura</Text>
                <TextInput
                  style={styles.customInput}
                  value={registerForm.openPrice}
                  onChangeText={value => handleRegisterFieldChange("openPrice", value)}
                  keyboardType="numeric"
                  placeholder="Precio (ej. 175.50)"
                />

                <Text style={styles.modalLabel}>Cantidad en base ({registerTarget.baseAsset})</Text>
                <TextInput
                  style={styles.customInput}
                  value={registerForm.amount}
                  onChangeText={value => handleRegisterFieldChange("amount", value)}
                  keyboardType="numeric"
                  placeholder="Cantidad (ej. 0.42)"
                />

                <Text style={styles.modalLabel}>Total en fiat ({registerForm.fiatCurrency || registerTarget.quoteAsset})</Text>
                <TextInput
                  style={styles.customInput}
                  value={registerForm.openValueFiat}
                  onChangeText={value => handleRegisterFieldChange("openValueFiat", value)}
                  keyboardType="numeric"
                  placeholder="Total (ej. 100.00)"
                />
                <TouchableOpacity
                  style={styles.helperButton}
                  onPress={recalculateRegisterFiat}
                  activeOpacity={0.8}
                >
                  <Text style={styles.helperButtonText}>Recalcular total con precio × cantidad</Text>
                </TouchableOpacity>

                <Text style={styles.modalLabel}>Moneda fiat</Text>
                <TextInput
                  style={styles.customInput}
                  value={registerForm.fiatCurrency}
                  onChangeText={value => handleRegisterFieldChange("fiatCurrency", value.toUpperCase())}
                  autoCapitalize="characters"
                  placeholder="USDT"
                />

                <Text style={styles.modalLabel}>Fee de apertura (opcional)</Text>
                <TextInput
                  style={styles.customInput}
                  value={registerForm.openFee}
                  onChangeText={value => handleRegisterFieldChange("openFee", value)}
                  keyboardType="numeric"
                  placeholder="0"
                />

                <Text style={styles.modalLabel}>Moneda del fee</Text>
                <View style={styles.modalTypeRow}>
                  {["BNB", "USDT", "USD"].map(currency => {
                    const isActive = registerForm.openFeeCurrency === currency;
                    return (
                      <TouchableOpacity
                        key={currency}
                        style={[styles.modalTypeButton, isActive && styles.modalTypeButtonActive]}
                        onPress={() => setRegisterForm(prev => ({ ...prev, openFeeCurrency: currency }))}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[styles.modalTypeButtonText, isActive && styles.modalTypeButtonTextActive]}
                        >
                          {currency}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.modalLabel}>Fecha de apertura</Text>
                <TouchableOpacity
                  style={styles.datePickerTrigger}
                  onPress={openRegisterDatePicker}
                  activeOpacity={0.8}
                >
                  <Text
                    style={
                      registerForm.openDate ? styles.datePickerText : styles.datePickerPlaceholder
                    }
                  >
                    {registerForm.openDate ? registerOpenDateLabel : "Seleccionar fecha"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.cardButton,
                    styles.cardButtonSecondary,
                    registerSubmitting && styles.cardButtonDisabled,
                  ]}
                  onPress={handleRegisterSubmit}
                  activeOpacity={0.8}
                  disabled={registerSubmitting}
                >
                  <Text style={styles.cardButtonText}>
                    {registerSubmitting ? "Guardando..." : "Registrar transacción"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.cardButton,
                    styles.cardButtonGhost,
                    registerSubmitting && styles.cardButtonDisabled,
                  ]}
                  onPress={closeRegisterModal}
                  activeOpacity={0.8}
                  disabled={registerSubmitting}
                >
                  <Text style={styles.cardButtonText}>Cancelar</Text>
                </TouchableOpacity>
              </>
            ) : (
              <ActivityIndicator size="large" />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// splitSymbol: separa un ticker compuesto en base y quote (maneja algunos quotes conocidos).
function splitSymbol(symbol: string): { baseAsset: string; quoteAsset: string } {
  const knownQuotes = ["USDT", "USDC", "BUSD", "BTC", "ETH", "USD", "PEN"];
  for (const quote of knownQuotes) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return {
        baseAsset: symbol.slice(0, symbol.length - quote.length),
        quoteAsset: quote,
      };
    }
  }
  return { baseAsset: symbol, quoteAsset: "USD" };
}

// fetchAssetPrice: obtiene precios spot desde Binance o calcula conversiones básicas fiat.
async function fetchAssetPrice(
  symbol: string,
  lastPriceUsdtSell: number,
  usdToPen: number
): Promise<number | null> {
  if (symbol === "USDTUSD") {
    return lastPriceUsdtSell || 1;
  }

  if (symbol === "USDPEN") {
    return usdToPen ? 1 / usdToPen : null;
  }

  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    const price = parseFloat(data?.price);
    return Number.isFinite(price) ? price : null;
  } catch (err) {
    console.warn("No se pudo obtener precio para", symbol, err);
    return null;
  }
}

// fetchExternalAssetPrice: precios para activos no-crypto (acciones, commodities, fiat).
async function fetchExternalAssetPrice(
  symbol: string,
  type: string,
  lastPriceUsdtSell: number,
  penToUsd: number
): Promise<number | null> {
  if (type === "stock") {
    return fetchStockRegularPrice(symbol);
  }

  if (type === "commodity") {
    return fetchCommodityPrice(symbol);
  }

  if (type === "fiat" && (symbol === "USDTUSD" || symbol === "USDPEN")) {
    if (symbol === "USDTUSD") {
      return lastPriceUsdtSell;
    }
    try {
      if (penToUsd) {
        return penToUsd ? 1 / penToUsd : null;
      }
      const res = await fetch("https://open.er-api.com/v6/latest/USD");
      const data = await res.json();
      const penRate = data?.rates?.PEN;
      return typeof penRate === "number" ? penRate : null;
    } catch (err) {
      console.warn("No se pudo obtener precio para USDPEN", err);
      return null;
    }
  }

  return null;
}

// fetchStockRegularPrice: consulta Yahoo Finance para obtener el precio regular de una acción.
async function fetchStockRegularPrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" ? price : null;
  } catch (err) {
    console.warn("No se pudo obtener precio de acción para", symbol, err);
    return null;
  }
}

// fetchCommodityPrice: intenta Yahoo Finance y luego Binance para commodities.
async function fetchCommodityPrice(symbol: string): Promise<number | null> {
  try {
    // Intenta Yahoo Finance primero
    const yahooSymbol = symbol.includes("=") ? symbol : `${symbol}=X`;
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1mo`
    );
    if (res.ok) {
      const data = await res.json();
      const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof price === "number") return price;
    }
  } catch (err) {
    console.warn("No se pudo obtener precio de commodity en Yahoo para", symbol, err);
  }

  // Fallback a precios SPOT de Binance
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) return null;
    const data = await res.json();
    const price = parseFloat(data?.price);
    return Number.isFinite(price) ? price : null;
  } catch (err) {
    console.warn("No se pudo obtener precio de commodity en Binance para", symbol, err);
    return null;
  }
}

// getInitialInvestmentAmount: extrae montos iniciales registrados en USD.
function getInitialInvestmentAmount(initialInvestment?: number | Record<string, number>): number | null {
  if (typeof initialInvestment === "number") return initialInvestment;
  if (!initialInvestment) return null;

  if (typeof initialInvestment["USD"] === "number") {
    return initialInvestment["USD"];
  }

  if (typeof (initialInvestment as any).amount === "number") {
    return (initialInvestment as any).amount;
  }

  return null;
}

// getHoldingData: recupera la tenencia actual (cantidad + equivalencia USD) según el asset.
function getHoldingData(
  asset: string,
  balanceMap: Map<string, BalanceEntry>,
  totals: { usd: number; pen: number },
  penToUsd: number,
  lastPriceUsdtSell: number,
  fallbackUsdValue = 0
): { amount: number; usdValue: number } {
  if (asset === "USD") {
    return { amount: totals.usd ?? 0, usdValue: totals.usd ?? 0 };
  }

  if (asset === "PEN") {
    const penAmount = totals.pen ?? 0;
    return { amount: penAmount, usdValue: penAmount * (penToUsd || 0) };
  }

  if (asset === "USDT") {
    const balance = balanceMap.get("USDT");
    if (balance) return { amount: balance.total, usdValue: balance.usdValue };
    const amount = totals.usd ? totals.usd / (lastPriceUsdtSell || 1) : 0;
    return { amount, usdValue: amount * (lastPriceUsdtSell || 1) };
  }

  const balance = balanceMap.get(asset);
  if (balance) {
    return { amount: balance.total, usdValue: balance.usdValue };
  }

  if (fallbackUsdValue) {
    return { amount: 0, usdValue: fallbackUsdValue };
  }

  return { amount: 0, usdValue: 0 };
}

// clamp: limita un valor al rango [min, max].
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// createEmptyRegisterForm: plantilla limpia (inicializa con fecha actual) para el formulario de registro.
const createEmptyRegisterForm = (): RegisterFormState => ({
  type: "long",
  openPrice: "",
  amount: "",
  openValueFiat: "",
  fiatCurrency: "",
  openFee: "",
  openFeeCurrency: "USDT",
  openDate: new Date().toISOString(),
});

// Estilos visuales de la pantalla.
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 0,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1976d2",
    alignItems: "center",
    justifyContent: "center",
  },
  addButtonDisabled: {
    opacity: 0.5,
  },
  addButtonText: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "bold",
    lineHeight: 28,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    color: "#c62828",
    fontSize: 16,
  },
  empty: {
    color: "#555",
    fontSize: 16,
  },
  scrollContent: {
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    padding: 16,
    backgroundColor: "#fafafa",
  },
  cardDisabled: {
    opacity: 0.6,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
  },
  detail: {
    fontSize: 15,
    marginBottom: 4,
  },
  action: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: "600",
    color: "#1b5e20",
  },
  hint: {
    marginTop: 8,
    fontSize: 13,
    color: "#0d47a1",
  },
  customSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    gap: 8,
  },
  customToggleRow: {
    marginTop: 12,
    alignItems: "flex-start",
  },
  customToggle: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#90a4ae",
    backgroundColor: "#fff",
  },
  customToggleIcon: {
    fontSize: 18,
  },
  customLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  customInput: {
    borderWidth: 1,
    borderColor: "#d0d0d0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    color: "#333",
  },
  datePickerTrigger: {
    borderWidth: 1,
    borderColor: "#d0d0d0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  datePickerText: {
    fontSize: 16,
    color: "#333",
  },
  datePickerPlaceholder: {
    fontSize: 16,
    color: "#888",
  },
  customResult: {
    fontSize: 14,
    color: "#333",
  },
  customResultOk: {
    color: "#2e7d32",
  },
  customResultWarn: {
    color: "#c62828",
  },
  customDetail: {
    fontSize: 13,
    color: "#555",
  },
  cardButton: {
    marginTop: 8,
    backgroundColor: "#1976d2",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  cardButtonSecondary: {
    backgroundColor: "#2e7d32",
  },
  cardButtonGhost: {
    backgroundColor: "#546e7a",
  },
  cardButtonDisabled: {
    opacity: 0.6,
  },
  cardButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalContent: {
    width: "100%",
    borderRadius: 12,
    padding: 20,
    backgroundColor: "#fff",
    gap: 12,
  },
  pairList: {
    maxHeight: 260,
  },
  pairListContent: {
    gap: 8,
  },
  pairOption: {
    borderWidth: 1,
    borderColor: "#cfd8dc",
    borderRadius: 10,
    padding: 12,
    backgroundColor: "#f5f5f5",
  },
  pairOptionActive: {
    borderColor: "#1976d2",
    backgroundColor: "#e3f2fd",
  },
  pairOptionText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#212121",
  },
  pairOptionMeta: {
    fontSize: 13,
    color: "#546e7a",
    marginTop: 4,
  },
  pairOptionSubtext: {
    fontSize: 12,
    color: "#78909c",
    marginTop: 2,
  },
  datePickerModalCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  datePickerDivider: {
    height: 8,
  },
  datePickerButtonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  datePickerButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "#1976d2",
    marginLeft: 8,
  },
  datePickerButtonSecondary: {
    backgroundColor: "#546e7a",
  },
  datePickerButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 4,
  },
  modalLabel: {
    fontSize: 14,
    color: "#424242",
    marginBottom: 4,
  },
  modalValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1b5e20",
    marginBottom: 12,
  },
  modalCloseButton: {
    marginTop: 8,
  },
  modalTypeRow: {
    flexDirection: "row",
    gap: 8,
  },
  modalTypeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#90a4ae",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  modalTypeButtonActive: {
    backgroundColor: "#1976d2",
    borderColor: "#1976d2",
  },
  modalTypeButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  modalTypeButtonTextActive: {
    color: "#fff",
  },
  modalError: {
    marginTop: 4,
  },
  helperButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#1976d2",
  },
  helperButtonText: {
    color: "#1976d2",
    fontWeight: "600",
  },
});

import mongoose from "mongoose";
import dotenv from "dotenv";
import Asset from "../models/asset.model.js";
import CloseHistory from "../models/pairHistorical.model.js";
import { getHighLowLastYears } from "./fetchHistoricalMaxMin.js";

const SYMBOL = "USDTUSD";
const YEARS = 7;
const SHOULD_UPDATE_DB = process.argv.includes("--update");
const CLUSTER_HOST = "cluster0.0tnt0bz.mongodb.net";
const DIRECT_HOSTS = [
  "ac-pqa3uwg-shard-00-00.0tnt0bz.mongodb.net:27017",
  "ac-pqa3uwg-shard-00-01.0tnt0bz.mongodb.net:27017",
  "ac-pqa3uwg-shard-00-02.0tnt0bz.mongodb.net:27017",
];
const REPLICA_SET = "atlas-8my9bp-shard-0";

const formatDate = value => {
  if (!value) return "N/A";
  return new Date(value).toISOString().slice(0, 10);
};

const getMongoUri = () => {
  dotenv.config();

  const rawUri = process.env.BD;
  if (!rawUri) {
    throw new Error("La variable de entorno BD no esta definida");
  }

  if (!rawUri.startsWith("mongodb+srv://")) {
    return rawUri;
  }

  const url = new URL(rawUri);
  if (url.hostname !== CLUSTER_HOST) {
    return rawUri;
  }

  url.searchParams.set("tls", "true");
  url.searchParams.set("authSource", url.searchParams.get("authSource") ?? "admin");
  url.searchParams.set("replicaSet", url.searchParams.get("replicaSet") ?? REPLICA_SET);

  return `mongodb://${url.username}:${url.password}@${DIRECT_HOSTS.join(",")}${url.pathname}?${url.searchParams.toString()}`;
};

const connectForScript = async () => {
  const uri = getMongoUri();
  await mongoose.connect(uri);
  console.log(`[db] Conectado a MongoDB: ${mongoose.connection.name} (${mongoose.connection.host})`);
};

await connectForScript();

try {
  const asset = await Asset.findOne({ symbol: SYMBOL });
  if (!asset) {
    throw new Error(`Asset ${SYMBOL} no encontrado`);
  }

  const history = await CloseHistory.findOne({ symbol: asset._id });
  const dailyHistory = history?.historicalData?.find(item => item.timeFrame === "1d");
  const candles = dailyHistory?.candles ?? [];

  if (candles.length === 0) {
    throw new Error(`No hay velas 1d guardadas para ${SYMBOL}`);
  }

  const normalizedCandles = candles
    .map(candle => ({
      closeTime: new Date(candle.closeTime),
      close: Number(candle.close),
    }))
    .filter(candle => Number.isFinite(candle.close) && !Number.isNaN(candle.closeTime.getTime()))
    .sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime());

  const { high, low, details } = getHighLowLastYears(normalizedCandles, YEARS);

  console.log(`Par: ${SYMBOL}`);
  console.log(`Velas 1d validas: ${normalizedCandles.length}`);
  console.log(`Rango high: ultimos ${YEARS} anios`);
  console.log(`High calculado: ${high}`);
  console.log(`Low calculado: ${low}`);
  console.log("");
  console.log("Detalle:");
  console.log(
    `- High viene del close ${details?.high?.close} del ${formatDate(details?.high?.closeTime)}`
  );
  console.log(
    `- Drawdown maximo usado: ${(((details?.lowCalculation?.drawdownPercent ?? 0) * 100)).toFixed(4)}%`
  );
  console.log(
    `- Max drawdown desde ${details?.lowCalculation?.max?.close ?? "N/A"} (${formatDate(
      details?.lowCalculation?.max?.closeTime
    )}) hasta ${details?.lowCalculation?.min?.close ?? "N/A"} (${formatDate(
      details?.lowCalculation?.min?.closeTime
    )})`
  );
  console.log("");
  console.log("Valores actualmente guardados en Asset:");
  console.log(`- high: ${asset.high}`);
  console.log(`- low: ${asset.low}`);

  if (SHOULD_UPDATE_DB) {
    asset.high = high;
    asset.low = low;
    asset.priceRangeSevenYearDetails = details;
    await asset.save();

    console.log("");
    console.log("Asset actualizado en base de datos:");
    console.log(`- high: ${asset.high}`);
    console.log(`- low: ${asset.low}`);
  } else {
    console.log("");
    console.log("Modo lectura. Para actualizar la base ejecuta con --update.");
  }
} catch (error) {
  console.error(`Error calculando high/low de ${SYMBOL}:`, error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

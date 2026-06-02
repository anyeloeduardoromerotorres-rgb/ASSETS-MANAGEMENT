// binanceUtils.js
import crypto from "node:crypto";
import dotenv from "dotenv";
import Exchange from "../models/exchange.model.js";

dotenv.config();

const apiKey = process.env.BINANCE_API_KEY?.trim();
const apiSecret = process.env.BINANCE_SECRET_KEY?.trim();

function normalizeBaseUrl(apiURL) {
  if (typeof apiURL !== "string" || apiURL.trim().length === 0) {
    throw new Error("apiURL de BINANCE no configurado");
  }

  const clean = apiURL.trim();
  return clean
    .replace(/\/api\/v3\/?$/i, "/")
    .replace(/\/+$/, "/");
}

export async function getBinanceBaseUrl() {
  const exchange = await Exchange.findOne({ name: "BINANCE" });
  if (!exchange) throw new Error("Exchange BINANCE no encontrado en DB");
  return normalizeBaseUrl(exchange.apiURL); // nos quedamos con "https://api.binance.com/"
}

export function getBinanceHeaders() {
  if (!apiKey) {
    throw new Error("BINANCE_API_KEY no configurada");
  }
  return { "X-MBX-APIKEY": apiKey };
}

export function signQuery(params = {}) {
  if (!apiSecret) {
    throw new Error("BINANCE_SECRET_KEY no configurada");
  }
  const timestampOffsetMs = Number(process.env.BINANCE_TIMESTAMP_OFFSET_MS ?? -2000);
  const timestamp = Date.now() + (Number.isFinite(timestampOffsetMs) ? timestampOffsetMs : -2000);
  const query = new URLSearchParams({
    recvWindow: 10000,
    ...params,
    timestamp,
  }).toString();

  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(query)
    .digest("hex");

  return `${query}&signature=${signature}`;
}

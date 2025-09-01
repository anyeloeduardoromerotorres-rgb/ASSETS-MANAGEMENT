// binanceUtils.js
import crypto from "crypto";
import dotenv from "dotenv";
import Exchange from "../models/exchange.model.js";

dotenv.config();

const apiKey = process.env.BINANCE_API_KEY;
const apiSecret = process.env.BINANCE_SECRET_KEY;

export async function getBinanceBaseUrl() {
  const exchange = await Exchange.findOne({ name: "BINANCE" });
  if (!exchange) throw new Error("Exchange BINANCE no encontrado en DB");
  return exchange.apiURL.replace("api/v3/", ""); // nos quedamos con "https://api.binance.com/"
}

export function getBinanceHeaders() {
  return { "X-MBX-APIKEY": apiKey };
}

export function signQuery(params = {}) {
  const timestamp = Date.now();
  const query = new URLSearchParams({ ...params, timestamp }).toString();

  const signature = crypto
    .createHmac("sha256", apiSecret)
    .update(query)
    .digest("hex");

  return `${query}&signature=${signature}`;
}

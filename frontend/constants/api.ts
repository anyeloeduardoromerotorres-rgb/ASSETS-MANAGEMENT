import axios from "axios";
import Constants from "expo-constants";
import { Platform } from "react-native";

const PRODUCTION_API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://hbsjajakwksnsj.duckdns.org/api";
const LOCAL_API_PORT = 3000;

function getDevApiBaseUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  if (Platform.OS === "web") {
    return `http://localhost:${LOCAL_API_PORT}/api`;
  }

  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.manifest2?.extra?.expoGo?.debuggerHost;
  const host = hostUri?.split(":")[0];

  if (host) {
    return `http://${host}:${LOCAL_API_PORT}/api`;
  }

  if (Platform.OS === "android") {
    return `http://10.0.2.2:${LOCAL_API_PORT}/api`;
  }

  return `http://localhost:${LOCAL_API_PORT}/api`;
}

const API_BASE_URL = __DEV__ ? getDevApiBaseUrl() : PRODUCTION_API_URL;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 15000,
});

if (__DEV__) {
  console.log("[API] API_BASE_URL =", API_BASE_URL);
}

export default api;

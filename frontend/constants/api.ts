import { create } from "axios";
import Constants from "expo-constants";
import { Platform } from "react-native";

const PRODUCTION_API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://hbsjajakwksnsj.duckdns.org/api";
const LOCAL_API_PORT = 3000;

function getExpoHost() {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.manifest2?.extra?.expoGo?.debuggerHost;

  return hostUri?.split(":")[0];
}

function getDevApiBaseUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) {
    const configuredUrl = process.env.EXPO_PUBLIC_API_URL;

    if (Platform.OS !== "web" && configuredUrl.includes("localhost")) {
      const host = getExpoHost();
      if (host) {
        return configuredUrl.replace("localhost", host);
      }

      if (Platform.OS === "android") {
        return configuredUrl.replace("localhost", "10.0.2.2");
      }
    }

    return configuredUrl;
  }

  if (Platform.OS === "web") {
    return `http://localhost:${LOCAL_API_PORT}/api`;
  }

  const host = getExpoHost();

  if (host) {
    return `http://${host}:${LOCAL_API_PORT}/api`;
  }

  if (Platform.OS === "android") {
    return `http://10.0.2.2:${LOCAL_API_PORT}/api`;
  }

  return `http://localhost:${LOCAL_API_PORT}/api`;
}

const API_BASE_URL = __DEV__ ? getDevApiBaseUrl() : PRODUCTION_API_URL;

const api = create({
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

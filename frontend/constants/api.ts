// import axios from "axios";

// // Backend público desplegado en el VPS
// const API_BASE_URL = __DEV__
//   ? "https://hbsjajakwksnsj.duckdns.org/api"
//   : "https://hbsjajakwksnsj.duckdns.org/api";




// const api = axios.create({
//   baseURL: API_BASE_URL,
//   headers: {
//     "Content-Type": "application/json",
//   },
// });

// export default api;

import axios from "axios";
import { Platform } from "react-native";
import Constants from "expo-constants";

const LOCALHOST_API = "http://localhost:3000/api";
const ANDROID_EMULATOR_API = "http://10.0.2.2:3000/api";
const GENYMOTION_EMULATOR_API = "http://10.0.3.2:3000/api";
// IP LAN de tu PC (telefono debe usar esta URL)
const PHYSICAL_DEVICE_API = "http://192.168.18.38:3000/api";

// En desarrollo usar la IP física para dispositivo. Si prefieres, cambia a LOCALHOST_API para simuladores.
const API_BASE_URL = __DEV__
  ? PHYSICAL_DEVICE_API
  : "https://hbsjajakwksnsj.duckdns.org/api";

console.log("[API] API_BASE_URL =", API_BASE_URL);

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 15000,
});

api.interceptors.request.use(req => {
  console.log("[API] Request:", req.method, req.baseURL + (req.url ?? ""));
  return req;
});
api.interceptors.response.use(
  res => {
    console.log("[API] Response:", res.config?.url, res.status);
    return res;
  },
  err => {
    console.error(
      "[API] Error:",
      err.config?.baseURL + err.config?.url,
      "message:",
      err.message,
      "code:",
      err.code
    );
    return Promise.reject(err);
  }
);

export default api;
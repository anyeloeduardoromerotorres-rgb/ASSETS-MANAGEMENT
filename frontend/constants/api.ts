import axios from "axios";

// Backend público desplegado en el VPS
const API_BASE_URL = __DEV__
  ? "https://hbsjajakwksnsj.duckdns.org/api"
  : "https://hbsjajakwksnsj.duckdns.org/api";




const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export default api;

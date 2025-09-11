import axios from "axios";

// ⚠️ Cambia esta IP por la IP pública de tu servidor cuando lo subas
const API_BASE_URL = "http://192.168.18.16:3000/api";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export default api;

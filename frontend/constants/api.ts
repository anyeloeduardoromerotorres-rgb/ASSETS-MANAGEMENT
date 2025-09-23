import axios from "axios";

// Backend público desplegado en el VPS
const API_BASE_URL = "http://195.133.93.48:3000/api";


const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

export default api;

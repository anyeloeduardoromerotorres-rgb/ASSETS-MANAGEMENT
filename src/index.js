import app from "./app.js"
import {connectdb} from './db.js'
import dotenv from "dotenv";
import { getCandlesWithStats } from "./scripts/fetchHistoricalMaxMin.js";
dotenv.config(); 



connectdb();



const PORT = process.env.PORT || 3000;


// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});

const data = await getCandlesWithStats("BTCUSDT", 7);

console.log("Total velas:", data.candles.length);
console.log("Máximo en 7 años:", data.stats.high);
console.log("Mínimo en 7 años:", data.stats.low);

// Ejemplo de acceso al precio de cierre y fecha de la primera vela
console.log("Primera vela:", data.candles[0].closeTime, data.candles[0].close);

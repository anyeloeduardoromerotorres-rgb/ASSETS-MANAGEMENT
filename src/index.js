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

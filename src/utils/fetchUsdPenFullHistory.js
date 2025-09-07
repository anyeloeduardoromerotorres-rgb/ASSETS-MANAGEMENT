import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/**
 * Trae el histórico diario de USD→PEN desde 1999 hasta hoy,
 * fragmentando las peticiones en bloques de hasta 365 días.
 *
 * @returns {Promise<Array<{ closeTime: Date, close: number, high: number, low: number }>>}
 */
export async function fetchUsdPenFullHistory() {
  const url = "https://api.exchangerate.host/timeframe";
  const apiKey = process.env.EXCHANGERATE_API_KEY;

  const earliest = new Date("1999-01-04");
  const today = new Date();

  const results = [];

  let start = earliest;
  while (start < today) {
    // calcular fin del bloque (hasta 365 días)
    const end = new Date(start);
    end.setDate(end.getDate() + 364);
    if (end > today) end.setTime(today.getTime());

    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    console.log(`📊 Fetching USD→PEN from ${startStr} to ${endStr}`);

    try {
      const resp = await axios.get(url, {
        params: {
          access_key: apiKey,
          start_date: startStr,
          end_date: endStr,
          symbols: "PEN",   // 👈 corregido (era currencies)
          source: "USD",    // 👈 necesario para que devuelva USDPEN
        },
      });

      // 👇 imprime para debug
      console.log("✅ Petición exitosa:", resp.data?.success);

      if (resp.data && resp.data.success && resp.data.quotes) {
        for (const [date, obj] of Object.entries(resp.data.quotes)) {
          if (obj.USDPEN !== undefined) {
            results.push({
              closeTime: new Date(date),
              close: obj.USDPEN,
              high: obj.USDPEN, // no hay OHLC, así que todo = close
              low: obj.USDPEN,
            });
          }
        }
      } else {
        console.error("❌ Respuesta inesperada:", resp.data);
        break; // opcional: reintentar en lugar de romper
      }
    } catch (err) {
      console.error("❌ Error en request:", err.response?.data || err.message);
      break;
    }

    // avanzar el bloque (un día después del último)
    end.setDate(end.getDate() + 1);
    start = end;
  }

  // ordenar por fecha ascendente
  results.sort((a, b) => a.closeTime - b.closeTime);

  return results;
}


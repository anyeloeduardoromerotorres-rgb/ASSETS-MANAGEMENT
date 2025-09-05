import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/**
 * Trae el histórico diario de USD → PEN desde 1999 hasta hoy,
 * fragmentando las peticiones en bloques de hasta 365 días.
 *
 * @returns {Promise<Array<{ date: string, rate: number }>>}
 */
export async function fetchUsdPenFullHistory() {
  const url = "https://api.exchangerate.host/timeframe";
  const apiKey = process.env.EXCHANGERATE_API_KEY;

  const earliest = new Date("1999-01-04");
  const today = new Date();

  const results = [];

  let start = earliest;
  while (start < today) {
    // calcula el fin del bloque (hasta 365 días después)
    const end = new Date(start);
    end.setDate(end.getDate() + 364);
    if (end > today) end.setTime(today.getTime());

    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    console.log(`📊 Fetching USD→PEN from ${startStr} to ${endStr}`);

    const resp = await axios.get(url, {
      params: {
        access_key: apiKey,
        start_date: startStr,
        end_date: endStr,
        currencies: "PEN",
      },
    });

    if (resp.data && resp.data.success && resp.data.rates) {
      for (const [date, obj] of Object.entries(resp.data.rates)) {
        if (obj.PEN !== undefined) {
          results.push({ date, rate: obj.PEN });
        }
      }
    } else {
      console.error("❌ Error fetching data:", resp.data);
      break; // si quieres, aquí puedes reintentar en lugar de romper
    }

    // avanzar el bloque
    start.setDate(end.getDate() + 1);
  }

  // ordenar por fecha ascendente
  results.sort((a, b) => new Date(a.date) - new Date(b.date));

  return results;
}

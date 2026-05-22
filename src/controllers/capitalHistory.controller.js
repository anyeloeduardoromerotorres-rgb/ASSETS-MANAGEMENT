import {
  getCapitalHistory,
  normalizeDateKey,
  saveCurrentCapitalSnapshot,
  upsertCapitalSnapshot,
} from "../services/capitalHistory.service.js";

export async function getCapitalHistoryController(req, res) {
  try {
    const history = await getCapitalHistory({
      from: req.query.from,
      to: req.query.to,
    });
    res.json(history);
  } catch (error) {
    console.error("Error obteniendo historial de capital:", error.message);
    res.status(500).json({ error: "No se pudo obtener el historial de capital" });
  }
}

export async function saveCapitalSnapshotController(req, res) {
  try {
    const totalUsd = Number(req.body?.totalUsd);
    if (!Number.isFinite(totalUsd) || totalUsd < 0) {
      return res.status(400).json({ error: "totalUsd invalido" });
    }

    const snapshot = await upsertCapitalSnapshot({
      totalUsd,
      dateKey: normalizeDateKey(req.body?.dateKey ?? req.body?.date),
      source: req.body?.source === "server" ? "server" : "frontend",
      breakdown: req.body?.breakdown ?? {},
    });

    res.json(snapshot);
  } catch (error) {
    console.error("Error guardando capital diario:", error.message);
    res.status(500).json({ error: "No se pudo guardar el capital diario" });
  }
}

export async function saveCurrentCapitalSnapshotController(_req, res) {
  try {
    const snapshot = await saveCurrentCapitalSnapshot({ reason: "api" });
    res.json(snapshot);
  } catch (error) {
    console.error("Error calculando capital actual:", error.message);
    res.status(500).json({ error: "No se pudo calcular el capital actual" });
  }
}

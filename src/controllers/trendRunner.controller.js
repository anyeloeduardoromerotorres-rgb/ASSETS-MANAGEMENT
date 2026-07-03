import TrendRunnerAsset from "../models/trendRunnerAsset.model.js";
import TrendRunnerSignal from "../models/trendRunnerSignal.model.js";
import TrendRunnerPosition from "../models/trendRunnerPosition.model.js";
import {
  closeTrendRunnerPosition,
  createPositionFromSignal,
  getTrendRunnerOpenBalances,
  refreshActiveOpenSignals,
  scanCloseSignals,
  scanOpenSignals,
  seedTrendRunnerUniverse,
  updateTrendRunnerPosition,
} from "../services/trendRunnerScanner.service.js";
import { getTrendRunnerCapitalSummary } from "../services/trendRunnerCapital.service.js";
import {
  saveTrendRunnerPushToken,
  sendTrendRunnerPush,
} from "../services/trendRunnerNotification.service.js";
import { buildTrendRunnerSignalQualityFromSignal } from "../services/trendRunnerSignalQuality.service.js";
import {
  getTrendRunnerScanJobs,
  startTrendRunnerScanJob,
} from "../services/trendRunnerScanJobs.service.js";

function shouldRunSync(req) {
  return String(req.query?.sync ?? req.body?.sync ?? "").toLowerCase() === "true";
}

function scanMarket(req) {
  return req.body?.market ?? req.query?.market;
}

export async function seedAssets(req, res) {
  try {
    const assets = await seedTrendRunnerUniverse();
    res.json({ count: assets.length, assets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function getAssets(req, res) {
  try {
    const assets = await TrendRunnerAsset.find().sort({ market: 1, symbol: 1 });
    res.json(assets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function scanOpen(req, res) {
  try {
    const market = scanMarket(req);
    if (shouldRunSync(req)) {
      const result = await scanOpenSignals({ market });
      return res.json(result);
    }

    const result = startTrendRunnerScanJob(
      `open:${market ?? "all"}`,
      "Escaneo de entradas Trend Runner",
      () => scanOpenSignals({ market })
    );

    res.status(202).json({
      message: result.alreadyRunning
        ? "El escaneo de entradas ya esta corriendo."
        : "Escaneo de entradas iniciado.",
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function refreshOpen(req, res) {
  try {
    const market = scanMarket(req);
    if (shouldRunSync(req)) {
      const result = await refreshActiveOpenSignals({ market });
      return res.json(result);
    }

    const result = startTrendRunnerScanJob(
      `refresh-open:${market ?? "all"}`,
      "Actualizacion de senales activas Trend Runner",
      () => refreshActiveOpenSignals({ market })
    );

    res.status(202).json({
      message: result.alreadyRunning
        ? "La actualizacion de senales activas ya esta corriendo."
        : "Actualizacion de senales activas iniciada.",
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function scanClose(req, res) {
  try {
    const market = scanMarket(req);
    if (shouldRunSync(req)) {
      const result = await scanCloseSignals({ market });
      return res.json(result);
    }

    const result = startTrendRunnerScanJob(
      `close:${market ?? "all"}`,
      "Escaneo de cierres Trend Runner",
      () => scanCloseSignals({ market })
    );

    res.status(202).json({
      message: result.alreadyRunning
        ? "El escaneo de cierres ya esta corriendo."
        : "Escaneo de cierres iniciado.",
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function getScanStatus(_req, res) {
  try {
    res.json({ jobs: getTrendRunnerScanJobs() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function getSignals(req, res) {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.side) query.side = req.query.side;
    if (req.query.market) query.market = req.query.market;

    const signals = await TrendRunnerSignal.find(query)
      .populate("asset")
      .populate("position")
      .sort({ side: 1, "quality.score": -1, detectedAt: -1 });

    for (const signal of signals) {
      if (
        signal.side === "open"
        && signal.status === "active"
        && !Number.isFinite(Number(signal.quality?.score))
      ) {
        const quality = buildTrendRunnerSignalQualityFromSignal(signal);
        if (quality) {
          signal.quality = quality;
          await signal.save();
        }
      }
    }

    signals.sort((left, right) => {
      if (left.side !== right.side) return left.side === "close" ? -1 : 1;
      if (left.side === "open") {
        return Number(right.quality?.score ?? -1) - Number(left.quality?.score ?? -1);
      }
      return new Date(right.detectedAt).getTime() - new Date(left.detectedAt).getTime();
    });

    res.json(signals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function ignoreSignal(req, res) {
  try {
    const signal = await TrendRunnerSignal.findByIdAndUpdate(
      req.params.id,
      {
        status: "ignored",
        deactivatedAt: new Date(),
        lastCheckedAt: new Date(),
      },
      { new: true }
    );

    if (!signal) return res.status(404).json({ error: "Senal no encontrada" });
    res.json(signal);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

export async function openPositionFromSignal(req, res) {
  try {
    const position = await createPositionFromSignal(req.params.id, req.body);
    res.status(201).json(position);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

export async function getPositions(req, res) {
  try {
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.market) query.market = req.query.market;

    const positions = await TrendRunnerPosition.find(query)
      .populate("asset")
      .populate("sourceSignal")
      .sort({ openDate: -1, createdAt: -1 });

    res.json(positions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function updatePosition(req, res) {
  try {
    const position = await updateTrendRunnerPosition(req.params.id, req.body);
    res.json(position);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

export async function closePosition(req, res) {
  try {
    const position = await closeTrendRunnerPosition(req.params.id, req.body);
    res.json(position);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

export async function deletePosition(req, res) {
  try {
    const position = await TrendRunnerPosition.findByIdAndDelete(req.params.id);
    if (!position) return res.status(404).json({ error: "Posicion no encontrada" });
    res.json({ message: "Posicion eliminada", position });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function registerPushToken(req, res) {
  try {
    const doc = await saveTrendRunnerPushToken(req.body);
    res.status(201).json(doc);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

export async function sendTestPush(req, res) {
  try {
    const result = await sendTrendRunnerPush({
      title: "Trend Runner prueba",
      body: "Notificacion local recibida correctamente.",
      data: {
        type: "trend_runner_test",
        sentAt: new Date().toISOString(),
      },
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.response?.data?.errors?.[0]?.message ?? error.message,
    });
  }
}

export async function getCapital(req, res) {
  try {
    const summary = await getTrendRunnerCapitalSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function getOpenBalances(req, res) {
  try {
    const balances = await getTrendRunnerOpenBalances();
    res.json(balances);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

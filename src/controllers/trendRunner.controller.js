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
    const result = await scanOpenSignals({ market: req.body?.market ?? req.query?.market });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function refreshOpen(req, res) {
  try {
    const result = await refreshActiveOpenSignals({
      market: req.body?.market ?? req.query?.market,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function scanClose(req, res) {
  try {
    const result = await scanCloseSignals({ market: req.body?.market ?? req.query?.market });
    res.json(result);
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
      .sort({ detectedAt: -1 });

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

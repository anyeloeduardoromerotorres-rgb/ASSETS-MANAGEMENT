import cron from "node-cron";
import {
  refreshActiveOpenSignals,
  scanCloseSignals,
  scanOpenSignals,
  seedTrendRunnerUniverse,
} from "./trendRunnerScanner.service.js";

let started = false;
const runningJobs = new Set();

async function safeRun(label, task, options = {}) {
  if (runningJobs.has(label)) {
    console.warn(`[trend-runner] ${label} omitido: ejecucion anterior sigue activa`);
    return;
  }

  runningJobs.add(label);
  try {
    if (!options.quietWhenEmpty) {
      console.log(`[trend-runner] ${label} iniciado`);
    }
    const result = await task();
    const summary = {
      scanned: result?.scanned,
      checked: result?.checked,
      active: result?.active,
      omitted: result?.omitted,
      ignored: result?.ignored,
      errors: result?.errors,
    };
    const hasActivity = Object.values(summary).some((value) => Number(value) > 0);

    if (!options.quietWhenEmpty || hasActivity) {
      console.log(`[trend-runner] ${label} completado`, summary);
    }
  } catch (error) {
    console.error(`[trend-runner] ${label} error:`, error.message);
  } finally {
    runningJobs.delete(label);
  }
}

export function startTrendRunnerScheduler() {
  if (started) return;
  started = true;

  safeRun("seed universo", seedTrendRunnerUniverse);

  cron.schedule(
    "10 16 * * 1-5",
    () => safeRun("scan apertura acciones/ETFs", () => scanOpenSignals({ market: "stocks" })),
    { timezone: "America/New_York" }
  );

  cron.schedule(
    "*/5 9-16 * * 1-5",
    () => safeRun("monitoreo intradia acciones/ETFs", async () => {
      const openRefresh = await refreshActiveOpenSignals({ market: "stocks" });
      const closeScan = await scanCloseSignals({ market: "stocks" });
      return {
        checked: (openRefresh.checked ?? 0) + (closeScan.checked ?? 0),
        active: (closeScan.active ?? 0),
      };
    }, { quietWhenEmpty: true }),
    { timezone: "America/New_York" }
  );

  cron.schedule(
    "5 0 * * *",
    () => safeRun("scan apertura crypto UTC", () => scanOpenSignals({ market: "crypto" })),
    { timezone: "UTC" }
  );

  cron.schedule(
    "* * * * *",
    () => safeRun("monitoreo crypto", async () => {
      const openRefresh = await refreshActiveOpenSignals({ market: "crypto" });
      const closeScan = await scanCloseSignals({ market: "crypto" });
      return {
        checked: (openRefresh.checked ?? 0) + (closeScan.checked ?? 0),
        active: closeScan.active ?? 0,
      };
    }, { quietWhenEmpty: true }),
    { timezone: "UTC" }
  );
}

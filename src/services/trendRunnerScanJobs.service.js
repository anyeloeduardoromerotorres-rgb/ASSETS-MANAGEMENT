const jobs = new Map();

function serializeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    key: job.key,
    label: job.label,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: job.error,
  };
}

export function getTrendRunnerScanJobs() {
  return [...jobs.values()]
    .map(serializeJob)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export function getTrendRunnerScanJob(key) {
  return serializeJob(jobs.get(key));
}

export function startTrendRunnerScanJob(key, label, task) {
  const current = jobs.get(key);

  if (current?.status === "running") {
    return {
      alreadyRunning: true,
      job: serializeJob(current),
    };
  }

  const job = {
    id: `${key}-${Date.now()}`,
    key,
    label,
    status: "running",
    startedAt: new Date(),
    finishedAt: null,
    result: null,
    error: null,
  };

  jobs.set(key, job);

  Promise.resolve()
    .then(task)
    .then((result) => {
      job.status = "finished";
      job.finishedAt = new Date();
      job.result = result;
    })
    .catch((error) => {
      job.status = "failed";
      job.finishedAt = new Date();
      job.error = error?.message ?? String(error);
      console.error(`[trend-runner] job ${key} error:`, error);
    });

  return {
    alreadyRunning: false,
    job: serializeJob(job),
  };
}


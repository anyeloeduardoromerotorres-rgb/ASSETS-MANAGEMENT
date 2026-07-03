const toFinite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function signalTypeQualityScore(signalType) {
  if (signalType === "Pullback + Breakout") return 100;
  if (signalType === "Breakout") return 85;
  if (signalType === "Pullback") return 75;
  if (signalType === "Reentrada") return 55;
  return 50;
}

function qualityGrade(score) {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return "D";
}

function riskQualityScore(entryPrice, initialStop) {
  const price = toFinite(entryPrice);
  const stop = toFinite(initialStop);
  if (price <= 0 || stop <= 0 || stop >= price) {
    return { riskScore: 50, stopDistancePct: null };
  }

  const stopDistancePct = ((price - stop) / price) * 100;
  const riskScore = clamp(100 - Math.max(0, stopDistancePct - 4) * 4, 20, 100);
  return { riskScore, stopDistancePct };
}

function capitalQualityScore({ capitalUsd, desiredCapitalUsd, isPartialPosition }) {
  const target = toFinite(capitalUsd);
  const desired = toFinite(desiredCapitalUsd, target);
  const ratio = desired > 0 ? clamp(target / desired, 0, 1) : 1;
  const capitalScore = isPartialPosition ? 60 + ratio * 40 : 100;
  return { capitalScore, capitalRatio: ratio };
}

export function buildTrendRunnerSignalQuality({
  signalType,
  holdScore,
  entryPrice,
  initialStop,
  capitalUsd,
  desiredCapitalUsd,
  isPartialPosition,
}) {
  const holdScoreComponent = clamp(toFinite(holdScore), 0, 100);
  const signalScore = signalTypeQualityScore(signalType);
  const { riskScore, stopDistancePct } = riskQualityScore(entryPrice, initialStop);
  const { capitalScore, capitalRatio } = capitalQualityScore({
    capitalUsd,
    desiredCapitalUsd,
    isPartialPosition,
  });
  const score = (
    holdScoreComponent * 0.45
    + signalScore * 0.30
    + riskScore * 0.15
    + capitalScore * 0.10
  );

  return {
    score: Number(score.toFixed(2)),
    grade: qualityGrade(score),
    holdScoreComponent: Number(holdScoreComponent.toFixed(2)),
    signalTypeScore: Number(signalScore.toFixed(2)),
    riskScore: Number(riskScore.toFixed(2)),
    capitalScore: Number(capitalScore.toFixed(2)),
    stopDistancePct: Number.isFinite(stopDistancePct) ? Number(stopDistancePct.toFixed(2)) : null,
    capitalRatio: Number(capitalRatio.toFixed(4)),
  };
}

export function buildTrendRunnerSignalQualityFromOpenAnalysis({
  analysis,
  params,
  capital,
  price,
}) {
  return buildTrendRunnerSignalQuality({
    signalType: analysis?.signalType,
    holdScore: analysis?.hold?.score,
    entryPrice: price,
    initialStop: params?.initialStop,
    capitalUsd: capital?.targetCapitalUsd,
    desiredCapitalUsd: capital?.desiredCapitalUsd,
    isPartialPosition: capital?.isPartialPosition,
  });
}

export function buildTrendRunnerSignalQualityFromSignal(signal) {
  if (!signal || signal.side !== "open") return null;

  return buildTrendRunnerSignalQuality({
    signalType: signal.signalType,
    holdScore: signal.hold?.score,
    entryPrice: signal.suggested?.price,
    initialStop: signal.parameters?.initialStop,
    capitalUsd: signal.suggested?.capitalUsd,
    desiredCapitalUsd: signal.suggested?.desiredCapitalUsd,
    isPartialPosition: signal.suggested?.isPartialPosition,
  });
}

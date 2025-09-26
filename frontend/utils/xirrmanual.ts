export function computeXIRR(
  cashflows: { amount: number; when: Date }[],
  maxIterations = 100,
  tolerance = 1e-6
): number | null {
  if (cashflows.length < 2) return null;

  const sorted = [...cashflows].sort((a, b) => a.when.getTime() - b.when.getTime());
  const startDate = sorted[0].when.getTime();

  function npv(rate: number): number {
    return sorted.reduce((acc, cf) => {
      const t = (cf.when.getTime() - startDate) / (365 * 24 * 3600 * 1000);
      return acc + cf.amount / Math.pow(1 + rate, t);
    }, 0);
  }

  let low = -0.999;
  let high = 10;

  const npvLow = npv(low);
  const npvHigh = npv(high);

  // Si no hay cambio de signo, no hay solución
  if (npvLow * npvHigh > 0) {
    return null;
  }

  let mid = 0;
  for (let i = 0; i < maxIterations; i++) {
    mid = (low + high) / 2;
    const value = npv(mid);

    if (Math.abs(value) < tolerance) {
      return mid;
    }

    if (value > 0) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return null;
}

// utils/finance.ts
export function computeCAGR(initialValue: number, finalValue: number, years: number): number {
  if (initialValue <= 0 || finalValue <= 0 || years <= 0) return 0; // seguridad
  return Math.pow(finalValue / initialValue, 1 / years) - 1;
}

export type BalanceEntry = {
  asset: string;
  total: number;
  usdValue: number;
};

export type TotalsEntry = {
  usd: number;
  pen: number;
};

export type CalculateTotalBalancesParams = {
  balances: BalanceEntry[];
  totals: TotalsEntry;
  penPrice?: number | null;
  usdtSellPrice?: number | null;
  livePrices?: Record<string, number>;
  additionalBalances?: BalanceEntry[];
};

export type CalculateTotalBalancesResult = {
  extendedBalances: BalanceEntry[];
  totalUsd: number;
};

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const toFiniteNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function calculateTotalBalances({
  balances,
  totals,
  penPrice,
  usdtSellPrice,
  livePrices = {},
  additionalBalances = [],
}: CalculateTotalBalancesParams): CalculateTotalBalancesResult {
  const safePenPrice = isPositiveFinite(penPrice) ? penPrice : null;
  const safeUsdtPrice = isPositiveFinite(usdtSellPrice) ? usdtSellPrice! : 1;

  const normalizedBalances = balances.map((balance) => {
    if (balance.asset === "USDT") {
      return {
        ...balance,
        usdValue: balance.total * safeUsdtPrice,
      };
    }

    const livePrice = livePrices[balance.asset];
    if (isPositiveFinite(livePrice) && balance.total > 0) {
      return {
        ...balance,
        usdValue: balance.total * livePrice,
      };
    }

    return { ...balance };
  });

  const sanitizedAdditional = additionalBalances
    .filter((entry) => entry && entry.asset !== "USD" && entry.asset !== "PEN")
    .map((entry) => ({ ...entry }));

  const usdTotal = toFiniteNumber(totals.usd);
  const penTotal = toFiniteNumber(totals.pen);

  const extendedBalances = [
    ...normalizedBalances,
    ...sanitizedAdditional,
    { asset: "USD", total: usdTotal, usdValue: usdTotal },
    {
      asset: "PEN",
      total: penTotal,
      usdValue: safePenPrice ? penTotal * safePenPrice : 0,
    },
  ].filter((entry) => entry.usdValue > 0);

  const totalUsd = extendedBalances.reduce(
    (acc, entry) => acc + entry.usdValue,
    0
  );

  return { extendedBalances, totalUsd };
}

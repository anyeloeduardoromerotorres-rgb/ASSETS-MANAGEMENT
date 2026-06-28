import mongoose from "mongoose";

const feePartSchema = new mongoose.Schema(
  {
    amount: Number,
    currency: {
      type: String,
      uppercase: true,
      trim: true,
    },
    usdValue: Number,
  },
  { _id: false }
);

const holdSnapshotSchema = new mongoose.Schema(
  {
    score: Number,
    driftAnnual: Number,
    driftScore: Number,
    consistencyPct: Number,
    consistencyScore: Number,
    persistencePct: Number,
    persistenceScore: Number,
    trendR2: Number,
    trendQualityScore: Number,
  },
  { _id: false }
);

const strategyStateSchema = new mongoose.Schema(
  {
    signalType: String,
    hold: holdSnapshotSchema,
    atrAtEntry: Number,
    tp1Rr: Number,
    tp1QtyPct: Number,
    trailAtr: Number,
    finalTpRr: Number,
    initialStop: Number,
    tp1Price: Number,
    finalTpPrice: Number,
    runnerStop: Number,
    highestSinceEntry: Number,
    lowestSinceEntry: Number,
    tp1Reached: {
      type: Boolean,
      default: false,
    },
    qtyTp1: Number,
    qtyRunner: Number,
  },
  { _id: false }
);

const trendRunnerPositionSchema = new mongoose.Schema(
  {
    asset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrendRunnerAsset",
    },
    sourceSignal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrendRunnerSignal",
    },
    parentPosition: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrendRunnerPosition",
    },
    symbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    market: {
      type: String,
      enum: ["etf", "stock", "adr", "crypto"],
      required: true,
    },
    broker: {
      type: String,
      enum: ["etoro", "binance"],
      required: true,
    },
    type: {
      type: String,
      enum: ["long"],
      default: "long",
    },
    fiatCurrency: {
      type: String,
      required: true,
      default: "USD",
      uppercase: true,
      trim: true,
    },
    capitalSource: {
      type: String,
      enum: ["USD", "USD+SHV", "USDT", "MANUAL"],
      default: "MANUAL",
    },
    requiresShvSale: {
      type: Boolean,
      default: false,
    },

    openDate: { type: Date, required: true },
    openPrice: { type: Number, required: true },
    amount: { type: Number, required: true },
    openValueFiat: { type: Number, required: true },
    openFee: { type: Number, default: 0 },
    openFees: [feePartSchema],

    closeDate: Date,
    closePrice: Number,
    closeValueFiat: Number,
    closeFee: { type: Number, default: 0 },
    closeFees: [feePartSchema],
    closeReason: String,

    profitPercent: { type: Number, default: 0 },
    profitTotalFiat: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
      index: true,
    },
    strategy: strategyStateSchema,
    notes: String,
  },
  { timestamps: true }
);

trendRunnerPositionSchema.index({ symbol: 1, status: 1 });
trendRunnerPositionSchema.index({ market: 1, status: 1 });

const TrendRunnerPosition = mongoose.model(
  "TrendRunnerPosition",
  trendRunnerPositionSchema
);

export default TrendRunnerPosition;

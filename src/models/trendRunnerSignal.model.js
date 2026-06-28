import mongoose from "mongoose";

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

const parametersSchema = new mongoose.Schema(
  {
    atr: Number,
    tp1Rr: Number,
    tp1QtyPct: Number,
    trailAtr: Number,
    finalTpRr: Number,
    initialStop: Number,
    tp1Price: Number,
    finalTpPrice: Number,
    runnerStop: Number,
  },
  { _id: false }
);

const suggestedExecutionSchema = new mongoose.Schema(
  {
    price: Number,
    capitalUsd: Number,
    quantity: Number,
    valueFiat: Number,
    fiatCurrency: {
      type: String,
      default: "USD",
      uppercase: true,
    },
    capitalSource: {
      type: String,
      enum: ["USD", "USD+SHV", "USDT", "INSUFFICIENT"],
    },
    requiresShvSale: {
      type: Boolean,
      default: false,
    },
    availableCashUsd: Number,
    availableUsd: Number,
    availableShvUsd: Number,
    availableUsdt: Number,
  },
  { _id: false }
);

const notificationSchema = new mongoose.Schema(
  {
    sentAt: Date,
    title: String,
    body: String,
    error: String,
  },
  { _id: false }
);

const trendRunnerSignalSchema = new mongoose.Schema(
  {
    asset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrendRunnerAsset",
    },
    position: {
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
    side: {
      type: String,
      enum: ["open", "close"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "active",
        "inactive",
        "opened",
        "executed",
        "ignored",
        "omitted",
        "error",
      ],
      default: "active",
      index: true,
    },
    signalType: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
    },
    timeframe: {
      type: String,
      default: "1d",
    },
    signalDateKey: {
      type: String,
    },
    detectedAt: {
      type: Date,
      default: Date.now,
    },
    lastCheckedAt: {
      type: Date,
      default: Date.now,
    },
    deactivatedAt: {
      type: Date,
    },
    hold: holdSnapshotSchema,
    parameters: parametersSchema,
    suggested: suggestedExecutionSchema,
    omissionReason: {
      type: String,
    },
    notification: notificationSchema,
    raw: {
      type: Object,
    },
  },
  { timestamps: true }
);

trendRunnerSignalSchema.index({ side: 1, status: 1, symbol: 1 });
trendRunnerSignalSchema.index({ symbol: 1, side: 1, signalDateKey: 1, signalType: 1 });

const TrendRunnerSignal = mongoose.model(
  "TrendRunnerSignal",
  trendRunnerSignalSchema
);

export default TrendRunnerSignal;

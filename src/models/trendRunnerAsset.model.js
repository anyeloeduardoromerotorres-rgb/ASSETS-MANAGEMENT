import mongoose from "mongoose";

const trendRunnerAssetSchema = new mongoose.Schema(
  {
    symbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
    },
    displaySymbol: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
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
    dataSource: {
      type: String,
      enum: ["yahoo", "binance"],
      required: true,
    },
    dataSymbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    quoteCurrency: {
      type: String,
      default: "USD",
      trim: true,
      uppercase: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    minHistoryYears: {
      type: Number,
      default: 15,
    },
    requiredBars: {
      type: Number,
    },
    lastHistoryOk: {
      type: Boolean,
      default: false,
    },
    lastBarsCount: {
      type: Number,
      default: 0,
    },
    lastHoldScore: {
      type: Number,
    },
    lastSignalType: {
      type: String,
    },
    lastScanAt: {
      type: Date,
    },
    lastError: {
      type: String,
    },
  },
  { timestamps: true }
);

trendRunnerAssetSchema.index({ market: 1, enabled: 1 });

const TrendRunnerAsset = mongoose.model(
  "TrendRunnerAsset",
  trendRunnerAssetSchema
);

export default TrendRunnerAsset;

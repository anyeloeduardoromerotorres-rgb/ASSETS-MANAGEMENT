import mongoose from "mongoose";

const trendRunnerPushTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    platform: {
      type: String,
      trim: true,
    },
    deviceName: {
      type: String,
      trim: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    lastError: String,
  },
  { timestamps: true }
);

const TrendRunnerPushToken = mongoose.model(
  "TrendRunnerPushToken",
  trendRunnerPushTokenSchema
);

export default TrendRunnerPushToken;

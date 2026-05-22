import mongoose from "mongoose";

const capitalHistorySchema = new mongoose.Schema(
  {
    dateKey: {
      type: String,
      required: true,
      trim: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    totalUsd: {
      type: Number,
      required: true,
      min: 0,
    },
    source: {
      type: String,
      enum: ["frontend", "server"],
      default: "server",
    },
    breakdown: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

capitalHistorySchema.index({ dateKey: 1 }, { unique: true });

export default mongoose.model("CapitalHistory", capitalHistorySchema);

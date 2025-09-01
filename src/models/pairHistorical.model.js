import mongoose from "mongoose";

const { Schema, model } = mongoose;

// Subdocumento para cada vela
const candleSchema = new Schema({
  closeTime: { type: Date, required: true },
  close: { type: Number, required: true }
}, { _id: false });

// Subdocumento para cada timeFrame
const timeFrameSchema = new Schema({
  timeFrame: { type: String, required: true }, // "1d", "1w", "1y", etc.
  candles: [candleSchema]
}, { _id: false });

const closeHistorySchema = new Schema({
  symbol: {
    type: Schema.Types.ObjectId,
    ref: "Asset",   // referencia al esquema Asset
    required: true
  },
  historicalData: [timeFrameSchema]  // un array con diferentes timeFrames
}, {
  timestamps: true
});

const CloseHistory = model("CloseHistory", closeHistorySchema);

export default CloseHistory;




// models/quote.model.js
import mongoose from "mongoose";

const quoteSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true }, // USDT, BTC, BNB, etc.
  description: { type: String }, // opcional, por ejemplo "Tether USD"
}, { timestamps: true });

export default mongoose.model("Quote", quoteSchema);

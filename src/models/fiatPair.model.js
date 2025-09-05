import mongoose from "mongoose";

const fiatPairSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true }, // Ej: USDTUSD  
  currentAmount: { type: Number}, // Cuanto tengo actualmente de la moneda base
  maxValue: { type: Number, required: true },
  minValue: { type: Number, required: true },
}, { timestamps: true });

const FiatPair = mongoose.model("FiatPair", fiatPairSchema);

export default FiatPair;

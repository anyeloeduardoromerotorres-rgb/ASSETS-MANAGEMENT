// models/transaction.model.js
import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    asset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Asset", // 🔹 Ej: BTCUSDT, ETHPEN, AAPLUSD
      required: true,
    },
    type: {
      type: String,
      enum: ["long", "short"],
      required: true,
    },

    // 📌 Moneda base de liquidación (ej: USDT, USD, PEN)
    fiatCurrency: {
      type: String,
      required: true,
      default: "USDT",
    },

    // 📌 Datos de apertura
    openDate: { type: Date, required: true },
    openPrice: { type: Number, required: true }, // precio por unidad en fiat
    amount: { type: Number, required: true }, // cantidad en unidades del asset
    openValueFiat: { type: Number, required: true }, // monto total en fiat
    openFee: { type: Number, default: 0 }, // fee en fiat
    openFees: [
      {
        amount: Number,
        currency: String,
        usdValue: Number,
      },
    ],

    // 📌 Datos de cierre
    closeDate: { type: Date },
    closePrice: { type: Number },
    closeValueFiat: { type: Number }, // monto total en fiat
    closeFee: { type: Number, default: 0 }, // fee en fiat
    closeFees: [
      {
        amount: Number,
        currency: String,
        usdValue: Number,
      },
    ],

    // 📌 Resultados
    profitPercent: { type: Number, default: 0 }, // % de ganancia neta
    profitTotalFiat: { type: Number, default: 0 }, // ganancia neta en fiat

    // 📌 Estado
    status: {
      type: String,
      enum: ["open", "closed"],
      default: "open",
    },
  },
  { timestamps: true }
);

const Transaction = mongoose.model("Transaction", transactionSchema);
export default Transaction;


import mongoose from "mongoose";

const penSchema = new mongoose.Schema ({
   currentBalance: {
    type: Number,
    require: true,
    trim: true
   }
}, { timestamps: true })

export default mongoose.model('Pen', penSchema)
import mongoose from "mongoose";

const DepositeWithdrawal = new mongoose.Schema ({
    transaction:{
        type: String,
        required: true,
        enum: ["Deposito", "Retiro"]
    },
    quantity:{
        type: Number,
        required: true,
        trim: true
    }
}, { timestamps: true })

export default mongoose.model('DepositeWithdrawal', DepositeWithdrawal)

import mongoose from "mongoose";

const depositewithdrawal = new mongoose.Schema ({
    transaction:{
        type: String,
        require: true,
        enum: ["Deposito", "Retiro"]
    },
    quantity:{
        type: Number,
        require: true,
        trim: true
    }
}, { timestamps: true })

export default mongoose.model('Depositewithdrawal', depositewithdrawal)
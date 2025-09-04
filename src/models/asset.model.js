import mongoose from "mongoose";

const assetSchema = new mongoose.Schema ({
    symbol:{
        type: String,
        require: true,
    },
    exchange:{        
        type: mongoose.Schema.Types.ObjectId,
        ref: "Exchange",  // 👈 referencia a Exchange
    },
    currentBalance: {
        type: Number,
        default: 0,
        trim: true,
    },    
    initialInvestment:{
        type: Object,
        default: 200
    },
    maxPriceSevenYear: {
        type: Number,
        require: true,
        trim: true
    },
    minPriceSevenYear: {
        type: Number,
        trim: true
    },
    slope:{
        type: Number,
        require: true
    }
}, { timestamps: true })

export default mongoose.model('Asset', assetSchema)
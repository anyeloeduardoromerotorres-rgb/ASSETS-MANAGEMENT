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
        type: Object
    },
    maxPriceSevenYear: {
        type: Number,
        require: true,
        trim: true
    },
    minPriceSevenYear: {
        type: Number,
        default: 0,
        trim: true
    }
}, { timestamps: true })

export default mongoose.model('Asset', assetSchema)
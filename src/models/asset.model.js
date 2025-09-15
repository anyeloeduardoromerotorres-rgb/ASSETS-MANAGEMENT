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
    totalCapitalWhenLastAdded:{
        type: Number,
        default: 0,
        trim: true
    },
    initialInvestment:{
        type: Object,
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
    },
    type:{
        type: String,
        enum: ["fiat", "crypto", "stock", "commodity"]
    }
}, { timestamps: true })

export default mongoose.model('Asset', assetSchema)
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
    allocationPercentage:{
        type: Number,
        trim: true
    },
    totalCapitalWhenLastAdded:{
        type: Number,
        trim: true
    },
    initialInvestment:{
        type: Object,
    },    
    high: {
        type: Number,
        require: true,
        trim: true
    },
    low: {
        type: Number,
        trim: true
    },
    priceRangeSevenYearDetails: {
        high: {
            closeTime: Date,
            close: Number
        },
        lowCalculation: {
            max: {
                closeTime: Date,
                close: Number
            },
            min: {
                closeTime: Date,
                close: Number
            },
            drawdownPercent: Number
        }
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

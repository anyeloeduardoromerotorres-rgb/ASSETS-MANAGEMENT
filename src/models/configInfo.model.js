import mongoose from "mongoose";


const configInfoSchema = new mongoose.Schema ({
    name:{
        type: String,
        require: true,
    },
    description:{        
        type: String,
        require: true,
    },    
    total:{
        type: Number,
        default: 0,
        trim: true
    }
}, { timestamps: true })

export default mongoose.model('configInfo', configInfoSchema)
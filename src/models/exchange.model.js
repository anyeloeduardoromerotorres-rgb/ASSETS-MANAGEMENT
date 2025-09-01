import mongoose from "mongoose";

const exchangeSchema = new mongoose.Schema ({
    name:{
        type: String,
        require: true
    },
    apiURL:{
        type:String,
    }
}, { timestamps: true })

export default mongoose.model('Exchange', exchangeSchema)
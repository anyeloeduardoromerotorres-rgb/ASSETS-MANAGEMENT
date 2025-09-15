import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config(); 

export const connectdb = async () => {
  try {    
    await mongoose.connect(process.env.BD);
    console.log("✅ Conectado a la base de datos");
  } catch (e) {
    console.error("❌ Error conectando a la base de datos:", e.message);
  }
};


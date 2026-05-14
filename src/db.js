import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

export const connectdb = async () => {
  try {
    if (!process.env.BD) {
      throw new Error("La variable de entorno BD no esta definida");
    }

    await mongoose.connect(process.env.BD);
    console.log(
      `[db] Conectado a MongoDB: ${mongoose.connection.name} (${mongoose.connection.host})`
    );
  } catch (e) {
    console.error("[db] Error conectando a la base de datos:", e.message);
    throw e;
  }
};

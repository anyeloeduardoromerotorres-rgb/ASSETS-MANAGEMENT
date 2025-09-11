import Depositewithdrawal from "../models/depositewithdrawal.model.js";
import axios from "axios";

const EXCHANGE_API = "https://open.er-api.com/v6/latest/USD"; 
// 👆 devuelve tasas con USD como base

// Crear transacción (depósito o retiro)
export const postDepositeWithdrawal = async (req, res) => {
  try {
    const { transaction, quantity, currency } = req.body; 
    // transaction: "Deposito" | "Retiro"
    // quantity: número ingresado
    // currency: "USD" | "PEN"

    let finalQuantity = Number(quantity);

    if (currency === "PEN") {
      // buscar tipo de cambio
      const { data } = await axios.get(EXCHANGE_API);

      if (!data || !data.rates || !data.rates.PEN) {
        return res.status(500).json({ error: "No se pudo obtener tipo de cambio" });
      }

      const penRate = data.rates.PEN;
      // USD → PEN, así que 1 USD = penRate PEN
      // Para convertir PEN → USD: dividir
      finalQuantity = finalQuantity / penRate;
    }

    const newTx = new Depositewithdrawal({
      transaction,
      quantity: finalQuantity, // 👈 siempre guardamos en USD
    });

    await newTx.save();
    res.json({ success: true, data: newTx });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al guardar transacción" });
  }
};

// Obtener transacción por ID
export const getDepositeWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const tx = await Depositewithdrawal.findById(id);

    if (!tx) return res.status(404).json({ error: "Transacción no encontrada" });

    res.json(tx);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener transacción" });
  }
};

// Eliminar transacción
export const deleteDepositeWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    await Depositewithdrawal.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al eliminar transacción" });
  }
};

// Actualizar transacción
export const putDepositeWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { transaction, quantity, currency } = req.body;

    let finalQuantity = Number(quantity);

    if (currency === "PEN") {
      const { data } = await axios.get(EXCHANGE_API);
      if (!data?.rates?.PEN) {
        return res.status(500).json({ error: "No se pudo obtener tipo de cambio" });
      }
      finalQuantity = finalQuantity / data.rates.PEN;
    }

    const updatedTx = await Depositewithdrawal.findByIdAndUpdate(
      id,
      { transaction, quantity: finalQuantity },
      { new: true }
    );

    res.json({ success: true, data: updatedTx });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al actualizar transacción" });
  }
};

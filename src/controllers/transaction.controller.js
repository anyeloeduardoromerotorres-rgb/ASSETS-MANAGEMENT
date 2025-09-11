import Transaction from "../models/transaction.model.js";

/**
 * Helper: calcula profit % y total en fiat
 */
function calculateProfit(transaction) {
  if (
    transaction.closeValueFiat != null &&
    transaction.openValueFiat != null
  ) {
    const grossProfit = transaction.closeValueFiat - transaction.openValueFiat;
    const totalFees = (transaction.openFee || 0) + (transaction.closeFee || 0);
    const netProfit = grossProfit - totalFees;

    transaction.profitTotalFiat = netProfit;
    transaction.profitPercent =
      (netProfit / transaction.openValueFiat) * 100;
  }
}

/**
 * Crear nueva transacción (abrir posición)
 */
export async function createTransaction(req, res) {
  try {
    const {
      asset,
      openDate,
      openPrice,
      quantity,
      openValueFiat,
      openFee,
    } = req.body;

    if (!asset || !openPrice || !quantity || !openValueFiat) {
      return res.status(400).json({
        error: "Faltan datos obligatorios: asset, openPrice, quantity, openValueFiat",
      });
    }

    const tx = new Transaction({
      asset,
      openDate: openDate || new Date(),
      openPrice,
      quantity,
      openValueFiat,
      openFee: openFee || 0,
      status: "open",
    });

    await tx.save();

    res.status(201).json(tx);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}


/**
 * Cerrar transacción existente
 */
export async function closeTransaction(req, res) {
  try {
    const { id } = req.params;
    const tx = await Transaction.findById(id);
    if (!tx) return res.status(404).json({ error: "Transacción no encontrada" });

    if (tx.status === "closed")
      return res.status(400).json({ error: "La transacción ya está cerrada" });

    // Actualizar datos de cierre
    tx.closeDate = req.body.closeDate || new Date();
    tx.closePrice = req.body.closePrice;
    tx.closeValueFiat = req.body.closeValueFiat;
    tx.closeFee = req.body.closeFee || 0;

    tx.status = "closed";

    // Calcular profit
    calculateProfit(tx);

    await tx.save();
    res.json(tx);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * Obtener todas las transacciones
 */
export async function getTransactions(req, res) {
  try {
    const txs = await Transaction.find().populate("asset");
    res.json(txs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Obtener transacción por ID
 */
export async function getTransactionById(req, res) {
  try {
    const { id } = req.params;
    const tx = await Transaction.findById(id).populate("asset");
    if (!tx) return res.status(404).json({ error: "Transacción no encontrada" });
    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Eliminar transacción
 */
export async function deleteTransaction(req, res) {
  try {
    const { id } = req.params;
    const tx = await Transaction.findByIdAndDelete(id);
    if (!tx) return res.status(404).json({ error: "Transacción no encontrada" });

    res.json({ message: "Transacción eliminada correctamente" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

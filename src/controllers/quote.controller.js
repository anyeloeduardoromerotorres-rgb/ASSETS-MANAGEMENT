import Quote from "../models/quote.model.js";

// 📌 Crear un nuevo Quote
export const createQuote = async (req, res) => {
  try {
    const { symbol, description } = req.body;

    if (!symbol) {
      return res.status(400).json({ error: "El campo 'symbol' es requerido" });
    }

    // Normalizar a mayúsculas (USDT, BTC, etc.)
    const upperSymbol = symbol.toUpperCase();

    // Evitar duplicados
    const existing = await Quote.findOne({ symbol: upperSymbol });
    if (existing) {
      return res.status(409).json({ error: "Este quote ya existe" });
    }

    const newQuote = new Quote({
      symbol: upperSymbol,
      description
    });

    await newQuote.save();

    res.status(201).json({
      message: "✅ Quote creado con éxito",
      quote: newQuote
    });
  } catch (error) {
    console.error("❌ Error en createQuote:", error);
    res.status(500).json({ error: "Error al crear quote" });
  }
};

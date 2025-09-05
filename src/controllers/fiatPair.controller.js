import FiatPair from "../models/fiatPair.model.js";

// Crear un par fiat
export const createFiatPair = async (req, res) => {
  try {
    const { symbol, currentValue } = req.body;

    if (!symbol || !base || !quote || !currentValue) {
      return res.status(400).json({ error: "Todos los campos son obligatorios" });
    }

    const fiatPair = new FiatPair({
      symbol: symbol.toUpperCase(),
      base: base.toUpperCase(),
      quote: quote.toUpperCase(),
      currentValue,
      maxValue: currentValue, // inicializa con el valor actual
      minValue: currentValue
    });

    await fiatPair.save();
    res.status(201).json(fiatPair);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


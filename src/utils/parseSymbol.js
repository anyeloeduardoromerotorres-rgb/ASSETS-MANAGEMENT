// utils/parseSymbol.js
import Quote from "../models/quote.model.js";

export const parseSymbol = async (symbol) => {
  // Ejemplo: BTCUSDT
  const knownQuotes = await Quote.find().select("symbol -_id"); 
  const quotes = knownQuotes.map(q => q.symbol);

  // Buscar qué parte del symbol es el quote
  const quote = quotes.find(q => symbol.endsWith(q));
  if (!quote) {
    throw new Error(`Quote no reconocido para ${symbol}`);
  }

  const base = symbol.replace(quote, ""); // BTC
  return { base, quote };
};

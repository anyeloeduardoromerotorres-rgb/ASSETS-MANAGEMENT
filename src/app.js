

import express from 'express';
import morgan from 'morgan';
import depositeWithdrawalRoute from './routes/depositewithdrawal.route.js'
import asset from './routes/assets.route.js'
import exchange from './routes/exchange.route.js'
import quoteRoutes from "./routes/quote.route.js";
import binanceRoutes from "./routes/binance.routes.js";
import configInfoRoutes from "./routes/configInfo.route.js";
import transactionRoutes from "./routes/transaction.route.js";
import capitalHistoryRoutes from "./routes/capitalHistory.route.js";

const app = express();

app.use(morgan('dev'))

// Middleware básico (puedes agregar más)
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});



app.use("/api", configInfoRoutes);
app.use("/api", capitalHistoryRoutes);
app.use('/api', depositeWithdrawalRoute)
app.use('/api', asset)
app.use('/api', exchange)
// Rutas de Quotes
app.use("/api", quoteRoutes);
app.use("/api/binance", binanceRoutes);
app.use("/api/transactions", transactionRoutes);



export default app;

import express from 'express';
import morgan from 'morgan';
import depositeWithdrawalRoute from './routes/depositewithdrawal.route.js'
import asset from './routes/assets.route.js'
import exchange from './routes/exchange.route.js'
import quoteRoutes from "./routes/quote.route.js";

const app = express();

app.use(morgan('dev'))

// Middleware básico (puedes agregar más)
app.use(express.json());

app.use('/api', depositeWithdrawalRoute)
app.use('/api', asset)
app.use('/api', exchange)
// Rutas de Quotes
app.use("/api", quoteRoutes);



export default app;
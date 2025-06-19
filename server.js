const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const investmentRoutes = require('./routes/investmentRoutes');
require('./jobs/returnScheduler');

// Load environment variables
dotenv.config();

const app = express();

// ✅ Enable CORS for frontend
app.use(cors({
  origin: 'http://127.0.0.1:5500',
  credentials: true
}));

// ✅ MUST come BEFORE express.json() to keep raw body for Stripe
app.use('/api/pay/stripe-webhook', express.raw({ type: 'application/json' }));

// ✅ Global middleware AFTER webhook raw body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// ✅ Route handlers
app.use('/api', authRoutes);
app.use('/api/pay', paymentRoutes.router); // includes /stripe-webhook
app.use('/api/admin', adminRoutes);
app.use('/api/investment', investmentRoutes);

// ✅ Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.stack);
  res.status(500).json({ Success: false, Message: 'Internal Server Error' });
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');

// Load env first
dotenv.config();
const reviewRoutes = require('./routes/reviewRoutes');
// Routes
const authRoutes = require('./routes/authRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const investmentRoutes = require('./routes/investmentRoutes');
const kycRoutes = require('./routes/kyc');
const roiRoutes = require('./routes/roiRoutes');
const contactRoutes = require('./routes/contactRoutes');
// Start scheduler
require('./jobs/returnScheduler');

const app = express();

// CORS Configuration
app.use(cors({
  origin: ['http://127.0.0.1:5500', 'http://127.0.0.1:5502', 'https://www.primewish.ae','https://primewish.ae', 'https://primewish.ae/prime-Bond-Investment'],
  credentials: true
}));


// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for KYC uploads
app.use('/uploads/kyc', express.static(path.join(__dirname, 'uploads', 'kyc')));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch((err) => console.error('❌ MongoDB connection error:', err));

// API Routes
app.use(express.urlencoded({ extended: true })); // ✅ This is mandatory

app.use('/api/auth', authRoutes);
app.use('/api/pay', paymentRoutes.router); // If paymentRoutes exports { router }
app.use('/api/admin', adminRoutes);
app.use('/api/investment', investmentRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/roi', roiRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/contact', contactRoutes);
// Basic root endpoint
app.get('/', (req, res) => {
  res.send('🌍 PrimeWish API is running');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.stack);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

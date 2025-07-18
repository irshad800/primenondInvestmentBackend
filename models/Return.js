const mongoose = require('mongoose');

const ReturnSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'auth', required: true },
  investmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Investment', required: true },
  amount: { type: Number, required: true },
  payoutDate: { type: Date, default: Date.now },
  status: {
    type: String,
    enum: ['pending', 'due', 'paid', 'failed'], // 👈 Added 'due'
    default: 'pending'
  },
  paidAt: { type: Date, default: null }, // When the return was paid
  createdAt: { type: Date, default: Date.now }
});

// ✅ Safe export to prevent OverwriteModelError
module.exports = mongoose.models.Return || mongoose.model('Return', ReturnSchema);

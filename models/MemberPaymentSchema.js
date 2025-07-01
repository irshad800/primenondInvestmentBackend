const mongoose = require('mongoose');

const MemberPaymentSchema = new mongoose.Schema({
  payment_reference: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'auth',
    required: true
  },
  investmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Investment',
    default: null
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true
  },
  customer: {
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, default: 'N/A' }
  },
  status: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['bank', 'cash', 'card', 'walletcrypto'],
    required: true
  },
  paymentType: {
    type: String,
    enum: ['registration', 'investment', 'roi'],
    required: true
  },
  paymentUrl: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('MemberPayment', MemberPaymentSchema);
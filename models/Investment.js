  const mongoose = require('mongoose');

  const InvestmentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'auth', required: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'InvestmentPlan', required: true },
    amount: { type: Number, required: true },
    startDate: { type: Date, default: Date.now },
    nextPayoutDate: { type: Date, default: null },
    payoutOption: {
      type: String,
      enum: ['monthly', 'annually'],
      default: 'monthly'
    },

    
    totalPayouts: { type: Number, required: true },
    payoutsMade: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'active', 'completed', 'cancelled'],
      default: 'pending'
    }
  }, {
    timestamps: true
  });

  module.exports = mongoose.model('Investment', InvestmentSchema);

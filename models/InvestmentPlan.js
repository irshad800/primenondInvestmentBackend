const mongoose = require('mongoose');

const InvestmentPlanSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String },
  minAmount: { type: Number, required: true },
  maxAmount: { type: Number },
  returnRate: { type: Number, required: true }, // Monthly %
  annualReturnRate: { type: Number, required: true }, // Annual %
  payoutFrequency: { type: String, enum: ['monthly'], default: 'monthly' },
  payoutOption: { type: String }, // e.g., "Payouts every 30 days, reinvest or withdraw"
  durationMonths: { type: Number, required: true },
  security: { type: String }, // e.g., "100% Secured Investment"
  benefits: [{ type: String }], // Array of bullet points
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('InvestmentPlan', InvestmentPlanSchema);

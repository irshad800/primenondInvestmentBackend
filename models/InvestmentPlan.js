const mongoose = require('mongoose');

const InvestmentPlanSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // e.g., "Silver Plan"
  description: { type: String },
  minAmount: { type: Number, required: true }, // Minimum investment amount
  maxAmount: { type: Number }, // Maximum investment amount (optional)
  returnRate: { type: Number, required: true }, // Monthly return percentage
  payoutFrequency: { type: String, enum: ['monthly'], default: 'monthly' },
  durationMonths: { type: Number, required: true }, // Total duration in months
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('InvestmentPlan', InvestmentPlanSchema);
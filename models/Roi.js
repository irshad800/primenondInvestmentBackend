const mongoose = require('mongoose');

const RoiSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'auth', required: true },
  investmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Investment', required: true },
  returnRate: { type: Number, required: true, min: 0, max: 100 }, // ROI percentage
  monthlyReturnAmount: { type: Number, default: 0 }, // Calculated if monthly
  annualReturnAmount: { type: Number, default: 0 },  // Calculated regardless
  totalRoiPaid: { type: Number, default: 0 }, // Total ROI paid to date
  payoutsMade: { type: Number, default: 0 },  // Number of payouts made
  lastPayoutDate: { type: Date, default: null }, // Last payout date
  assignedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('Roi', RoiSchema);
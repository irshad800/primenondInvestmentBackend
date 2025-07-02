const express = require('express');
const router = express.Router();
const Roi = require('../models/Roi');
const Investment = require('../models/Investment');
const { ensureAuth } = require('../middleware/authMiddleware');
const Return = require('../models/Return');

// Get ROI data for a user with computed return earnings and payment history
// Get ROI data for a user with computed return earnings and payment history
router.get('/get/:userId', ensureAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    // Safeguard against undefined req.user
    if (!req.user || (!req.user._id && !req.user.role)) {
      return res.status(401).json({ success: false, error: 'Invalid or missing authentication token' });
    }

    // Ensure requesting user matches or is admin
    const userIdString = req.user._id ? req.user._id.toString() : null;
    if (userIdString !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized access' });
    }

    const roiData = await Roi.find({ userId })
      .populate({
        path: 'investmentId',
        select: 'amount planId startDate status payoutOption totalPayouts payoutsMade',
        populate: { path: 'planId', select: 'name' }
      })
      .lean();

    if (!roiData || roiData.length === 0) {
      return res.status(404).json({ success: false, error: 'No ROI data found for this user' });
    }

    // Compute monthly or annual returns and enrich with payment details
    const enrichedROI = roiData.map(roi => {
      const investment = roi.investmentId;
      if (!investment || !investment.amount) return roi;

      const amount = investment.amount;
      const returnRate = roi.returnRate || 0;
      const payoutOption = investment.payoutOption || 'monthly';
      const totalPayouts = investment.totalPayouts || 0;
      const payoutsMade = investment.payoutsMade || 0;
      const remainingPayouts = totalPayouts - payoutsMade;

      const monthlyReturn = (amount * returnRate) / 100;
      const annualReturn = payoutOption === 'annually' ? monthlyReturn : monthlyReturn * 12;

      return {
        ...roi,
        investmentAmount: amount,
        planName: investment.planId?.name || 'N/A',
        payoutOption,
        computedReturn: {
          monthly: payoutOption === 'monthly' ? monthlyReturn : 0,
          annually: annualReturn
        },
        paymentHistory: {
          totalRoiPaid: roi.totalRoiPaid || 0,
          payoutsMade: roi.payoutsMade || 0,
          lastPayoutDate: roi.lastPayoutDate ? roi.lastPayoutDate.toISOString() : null,
          remainingPayouts
        },
        nextPayoutDate: investment.nextPayoutDate ? investment.nextPayoutDate.toISOString() : null
      };
    });

    res.status(200).json({
      success: true,
      data: enrichedROI
    });

  } catch (error) {
    console.error('❌ ROI Fetch Error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch ROI data' });
  }
});

// New route to set ROI payout schedule manually
router.post('/set-payout/:investmentId', ensureAuth, async (req, res) => {
  try {
    const { investmentId } = req.params;
    const { payoutDate, amount } = req.body;

    if (!investmentId || !payoutDate || !amount) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const investment = await Investment.findById(investmentId);
    if (!investment) {
      return res.status(404).json({ success: false, error: 'Investment not found' });
    }

    const roi = await Roi.findOne({ investmentId, userId: investment.userId });
    if (!roi) {
      return res.status(404).json({ success: false, error: 'ROI record not found' });
    }

    // Check for an existing Return record with the same investmentId and payoutDate
    let returnRecord = await Return.findOne({ investmentId, payoutDate: new Date(payoutDate) });

    if (returnRecord) {
      // Update existing record if it exists
      returnRecord.amount = amount;
      await returnRecord.save();
    } else {
      // Create new record if it doesn't exist
      returnRecord = new Return({
        userId: investment.userId,
        investmentId,
        amount,
        payoutDate: new Date(payoutDate),
        status: 'pending'
      });
      await returnRecord.save();
    }

    res.status(200).json({
      success: true,
      message: 'ROI payout scheduled successfully',
      data: returnRecord
    });
  } catch (error) {
    console.error('❌ ROI Payout Set Error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to set ROI payout' });
  }
});

module.exports = router;
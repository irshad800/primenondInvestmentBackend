const express = require('express');
const router = express.Router();
const Roi = require('../models/Roi');
const { ensureAuth } = require('../middleware/authMiddleware');

// Get ROI data for a user
// Get ROI data for a user with computed return earnings
router.get('/get/:userId', ensureAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    // Ensure requesting user matches or is admin
    if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized access' });
    }

    const roiData = await Roi.find({ userId })
      .populate({
        path: 'investmentId',
        select: 'amount planId startDate status payoutOption',
        populate: { path: 'planId', select: 'name' }
      })
      .lean();

    if (!roiData || roiData.length === 0) {
      return res.status(404).json({ success: false, error: 'No ROI data found for this user' });
    }

    // Compute monthly or annual returns
    const enrichedROI = roiData.map(roi => {
      const investment = roi.investmentId;
      if (!investment || !investment.amount) return roi;

      const amount = investment.amount;
      const returnRate = roi.returnRate || 0;
      const payoutOption = investment.payoutOption || 'monthly';

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
        }
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


module.exports = router;
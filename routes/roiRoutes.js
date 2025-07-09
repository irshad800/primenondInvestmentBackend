const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Roi = require('../models/Roi');
const Investment = require('../models/Investment');
const Return = require('../models/Return');
const { ensureAuth } = require('../middleware/authMiddleware');
const { calculateNextPayoutDate } = require('../utils/calculateReturn');

// Helper function to format dates
const formatDate = (date) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Dubai'
  });
};

// Get ROI data for a user with computed return earnings and payment history
router.get('/get/:userId', ensureAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate userId format
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID format' });
    }

    // Safeguard against undefined req.user
    if (!req.user || (!req.user._id && !req.user.role)) {
      return res.status(401).json({ success: false, error: 'Invalid or missing authentication token' });
    }

    // Ensure requesting user matches or is admin
    const userIdString = req.user._id.toString();
    if (userIdString !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized access' });
    }

    // Query ROI data
    const roiData = await Roi.find({ userId })
      .populate({
        path: 'investmentId',
        select: 'amount planId startDate status payoutOption totalPayouts payoutsMade',
        populate: { path: 'planId', select: 'name description minAmount maxAmount' }
      })
      .lean();

    // Return empty array for no data
    if (!roiData || roiData.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    // Compute and enrich ROI data
    const enrichedROI = await Promise.all(
      roiData.map(async (roi) => {
        const investment = roi.investmentId;
        if (!investment || !investment.amount) {
          return {
            ...roi,
            investmentAmount: 0,
            currency: 'AED',
            planName: 'N/A',
            planDescription: 'N/A',
            investmentStatus: 'N/A',
            payoutOption: 'N/A',
            computedReturn: { monthly: 0, annually: 0 },
            paymentHistory: {
              totalRoiPaid: 0,
              payoutsMade: 0,
              lastPayoutDate: 'N/A',
              remainingPayouts: 0
            },
            nextPayoutDate: 'N/A'
          };
        }

        const amount = investment.amount;
        const returnRate = roi.returnRate || 0;
        const payoutOption = investment.payoutOption || 'monthly';
        const totalPayouts = investment.totalPayouts || 0;
        const payoutsMade = investment.payoutsMade || 0;
        const remainingPayouts = totalPayouts - payoutsMade;

        const monthlyReturn = (amount * returnRate) / 100;
        const annualReturn = payoutOption === 'annually' ? monthlyReturn : monthlyReturn * 12;

        // Check Return collection for next scheduled payout
        const nextReturn = await Return.findOne({
          investmentId: investment._id,
          status: { $in: ['pending', 'due'] },
          payoutDate: { $gte: new Date() }
        })
          .sort({ payoutDate: 1 })
          .lean();

        // Use investment.nextPayoutDate or compute from Return or startDate
        let nextPayoutDate = investment.nextPayoutDate;
        if (!nextPayoutDate && nextReturn) {
          nextPayoutDate = nextReturn.payoutDate;
        } else if (!nextPayoutDate) {
          nextPayoutDate = calculateNextPayoutDate(payoutOption, investment.startDate || new Date());
        }

        return {
          ...roi,
          investmentAmount: amount,
          currency: 'AED',
          planName: investment.planId?.name || 'N/A',
          planDescription: investment.planId?.description || 'N/A',
          investmentStatus: investment.status || 'N/A',
          payoutOption,
          computedReturn: {
            monthly: Number(payoutOption === 'monthly' ? monthlyReturn : 0).toFixed(2),
            annually: Number(annualReturn).toFixed(2)
          },
          paymentHistory: {
            totalRoiPaid: Number(roi.totalRoiPaid || 0).toFixed(2),
            payoutsMade,
            lastPayoutDate: formatDate(roi.lastPayoutDate),
            remainingPayouts
          },
          nextPayoutDate: formatDate(nextPayoutDate)
        };
      })
    );

    res.status(200).json({
      success: true,
      data: enrichedROI
    });
  } catch (error) {
    console.error(`❌ ROI Fetch Error: userId=${req.params.userId}, error=${error.message}`);
    res.status(500).json({ success: false, error: `Failed to fetch ROI data: ${error.message}` });
  }
});

// Set ROI payout schedule manually and update Investment.nextPayoutDate
router.post('/set-payout/:investmentId', ensureAuth, async (req, res) => {
  try {
    const { investmentId } = req.params;
    const { payoutDate, amount } = req.body;

    // Validate required fields
    if (!investmentId || !payoutDate || !amount) {
      console.error(`❌ Missing required fields: investmentId=${investmentId}, payoutDate=${payoutDate}, amount=${amount}`);
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Validate investmentId format
    if (!mongoose.isValidObjectId(investmentId)) {
      return res.status(400).json({ success: false, error: 'Invalid investment ID format' });
    }

    // Find investment
    const investment = await Investment.findById(investmentId);
    if (!investment) {
      console.error(`❌ Investment not found: investmentId=${investmentId}`);
      return res.status(404).json({ success: false, error: 'Investment not found' });
    }

    // Ensure requesting user matches or is admin
    const userIdString = req.user._id.toString();
    if (userIdString !== investment.userId.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Unauthorized access' });
    }

    // Find ROI record
    const roi = await Roi.findOne({ investmentId, userId: investment.userId });
    if (!roi) {
      console.error(`❌ ROI record not found: investmentId=${investmentId}, userId=${investment.userId}`);
      return res.status(404).json({ success: false, error: 'ROI record not found' });
    }

    // Validate payoutDate against payoutOption
    const providedPayoutDate = new Date(payoutDate);
    const expectedPayoutDate = calculateNextPayoutDate(investment.payoutOption, new Date());
    const maxAllowedDate = new Date(expectedPayoutDate);
    maxAllowedDate.setDate(maxAllowedDate.getDate() + 2);
    const minAllowedDate = new Date(expectedPayoutDate);
    minAllowedDate.setDate(minAllowedDate.getDate() - 2);

    if (providedPayoutDate < minAllowedDate || providedPayoutDate > maxAllowedDate) {
      console.error(`❌ Invalid payoutDate: provided=${providedPayoutDate}, expected=${expectedPayoutDate}, payoutOption=${investment.payoutOption}`);
      return res.status(400).json({
        success: false,
        error: `Payout date must be around ${expectedPayoutDate.toISOString().split('T')[0]} based on ${investment.payoutOption} payout option`
      });
    }

    // Check for existing Return record
    let returnRecord = await Return.findOne({ investmentId, payoutDate: providedPayoutDate });

    if (returnRecord) {
      // Update existing record
      returnRecord.amount = amount;
      await returnRecord.save();
      console.log(`✅ Updated existing Return: returnId=${returnRecord._id}, amount=${amount}, payoutDate=${providedPayoutDate}`);
    } else {
      // Create new record
      returnRecord = new Return({
        userId: investment.userId,
        investmentId,
        amount,
        payoutDate: providedPayoutDate,
        status: 'pending'
      });
      await returnRecord.save();
      console.log(`✅ Created new Return: returnId=${returnRecord._id}, amount=${amount}, payoutDate=${providedPayoutDate}`);
    }

    // Update Investment.nextPayoutDate
    await Investment.updateOne(
      { _id: investmentId },
      { $set: { nextPayoutDate: providedPayoutDate } }
    );

    res.status(200).json({
      success: true,
      message: 'ROI payout scheduled successfully',
      data: returnRecord
    });
  } catch (error) {
    console.error(`❌ ROI Payout Set Error: investmentId=${req.params.investmentId}, error=${error.message}, stack=${error.stack}`);
    res.status(500).json({ success: false, error: 'Failed to set ROI payout' });
  }
});

module.exports = router;
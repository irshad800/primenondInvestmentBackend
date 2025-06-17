const InvestmentPlan = require('../models/InvestmentPlan');
const Investment = require('../models/Investment');
const Return = require('../models/Return');

const getPlans = async (req, res) => {
  try {
    const plans = await InvestmentPlan.find({ active: true });
    res.json({ Success: true, plans });
  } catch (error) {
    console.error('❌ Get Plans Error:', error);
    res.status(500).json({ Success: false, Message: 'Internal Server Error' });
  }
};

const getUserInvestments = async (req, res) => {
  try {
    const userId = req.params.userId;
    if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ Success: false, Message: 'Access denied' });
    }

    const investments = await Investment.find({ userId }).populate('planId');
    res.json({ Success: true, investments });
  } catch (error) {
    console.error('❌ Get Investments Error:', error);
    res.status(500).json({ Success: false, Message: 'Internal Server Error' });
  }
};

const getUserReturns = async (req, res) => {
  try {
    const userId = req.params.userId;
    if (req.user._id.toString() !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ Success: false, Message: 'Access denied' });
    }

    const returns = await Return.find({ userId }).populate('investmentId');
    res.json({ Success: true, returns });
  } catch (error) {
    console.error('❌ Get Returns Error:', error);
    res.status(500).json({ Success: false, Message: 'Internal Server Error' });
  }
};

module.exports = { getPlans, getUserInvestments, getUserReturns };
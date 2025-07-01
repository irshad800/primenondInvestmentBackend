const InvestmentPlan = require('../models/InvestmentPlan');
const Investment = require('../models/Investment');
const Return = require('../models/Return');
const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema'); // Add this import
const { calculateNextPayoutDate } = require('../utils/calculateReturn');

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

const createInvestmentPlan = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ Success: false, Message: 'Only admin can add plans' });
    }

    const {
      name,
      description,
      minAmount,
      maxAmount,
      returnRate,
      annualReturnRate,
      durationMonths,
      payoutOption,
      security,
      benefits
    } = req.body;

    const newPlan = new InvestmentPlan({
      name,
      description,
      minAmount,
      maxAmount,
      returnRate,
      annualReturnRate,
      durationMonths,
      payoutOption,
      security,
      benefits
    });

    await newPlan.save();
    res.status(201).json({ Success: true, Message: 'Plan created successfully', plan: newPlan });
  } catch (error) {
    console.error('❌ Create Plan Error:', error);
    res.status(500).json({ Success: false, Message: 'Internal Server Error', error: error.message });
  }
};

const selectPlan = async (req, res) => {
  try {
    const userId = req.user._id;
    const { planId, amount, payoutOption } = req.body; // Get payoutOption from user input

    if (!planId) {
      return res.status(400).json({ Success: false, Message: 'Plan ID is required' });
    }

    if (!amount) {
      return res.status(400).json({ Success: false, Message: 'Amount is required' });
    }

    const plan = await InvestmentPlan.findById(planId);
    if (!plan || !plan.active) {
      return res.status(404).json({ Success: false, Message: 'Plan not found or inactive' });
    }

    if (amount < plan.minAmount || (plan.maxAmount && amount > plan.maxAmount)) {
      return res.status(400).json({ 
        Success: false, 
        Message: `Amount must be between $${plan.minAmount} and $${plan.maxAmount || '∞'}` 
      });
    }

    const user = await authDB.findById(userId);
    if (!user) {
      return res.status(404).json({ Success: false, Message: 'User not found' });
    }

    if (user.paymentStatus !== 'success') {
      return res.status(403).json({ Success: false, Message: 'Complete registration payment first' });
    }

    // Check if user already has an active investment
    const activeInvestment = await Investment.findOne({ userId, status: 'active' });
    if (activeInvestment) {
      return res.status(400).json({ 
        Success: false, 
        Message: 'You already have an active investment. No further selections are allowed.' 
      });
    }

    // Check if user has a successful investment payment
    const successfulInvestmentPayment = await MemberPayment.findOne({ userId, paymentType: 'investment', status: 'success' });
    if (successfulInvestmentPayment) {
      return res.status(400).json({ 
        Success: false, 
        Message: 'You have already paid for an investment. No further selections are allowed.' 
      });
    }

    user.selectedPlanId = planId;
    user.selectedInvestmentAmount = Number(amount);
    user.selectedPlanName = plan.name; // ✅ Add plan name
    await user.save();

    // Create or update a pending investment
    let investment = await Investment.findOne({ userId, status: 'pending' });

    if (investment) {
      // Update existing pending investment
      investment.planId = planId;
      investment.amount = amount;
      investment.nextPayoutDate = null; // ❌ Don't set it here
      investment.payoutOption = ['monthly', 'annually'].includes(payoutOption) ? payoutOption : 'monthly';
      investment.totalPayouts = plan.durationMonths;
      investment.updatedAt = new Date();
      await investment.save();
    } else {
      // Create new investment if none exists
      investment = new Investment({
        userId,
        planId,
        amount,
        payoutOption: ['monthly', 'annually'].includes(payoutOption) ? payoutOption : 'monthly', // ✅ Add this line
        totalPayouts: plan.durationMonths,
        status: 'pending',
        createdAt: new Date()
      });
      await investment.save();
    }

    res.json({ 
      Success: true, 
      Message: 'Plan selected and investment created successfully', 
      plan,
      investmentId: investment._id 
    });
  } catch (error) {
    console.error('❌ Select Plan Error:', error);
    res.status(500).json({ Success: false, Message: 'Internal Server Error', error: error.message });
  }
};

module.exports = { getPlans, getUserInvestments, getUserReturns, createInvestmentPlan, selectPlan };
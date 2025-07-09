const InvestmentPlan = require('../models/InvestmentPlan');
const Investment = require('../models/Investment');
const Return = require('../models/Return');
const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');
const Kyc = require('../models/Kyc'); // Add this line
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

    const returns = await Return.find({ userId })
      .populate('userId', 'name email userId')
      .populate('investmentId', 'amount planId status payoutOption totalPayouts payoutsMade');
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
    const { planId, amount, payoutOption } = req.body;

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

    const user = await authDB.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ Success: false, Message: 'User not found' });
    }

    // Check registration payment status
    if (user.paymentStatus !== 'success') {
      return res.status(403).json({ Success: false, Message: 'Complete registration payment first' });
    }

    // Check KYC approval
    const kyc = await Kyc.findOne({ userId });
    if (!kyc || kyc.status !== 'approved') {
      return res.status(403).json({ Success: false, Message: 'KYC must be approved before selecting a plan' });
    }

    // Check payout details
    if (!user.roiPayoutMethod || !user.bankDetails || Object.values(user.bankDetails).every(val => val === null)) {
      return res.status(403).json({ Success: false, Message: 'Please set your ROI payout method and details first' });
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
    user.selectedPlanName = plan.name;
    await authDB.findByIdAndUpdate(userId, user, { new: true });

    // Create or update a pending investment
    let investment = await Investment.findOne({ userId, status: 'pending' });

    if (investment) {
      investment.planId = planId;
      investment.amount = amount;
      investment.payoutOption = ['monthly', 'annually'].includes(payoutOption) ? payoutOption : 'monthly';
      investment.totalPayouts = plan.durationMonths;
      investment.updatedAt = new Date();
      await investment.save();
    } else {
      investment = new Investment({
        userId,
        planId,
        amount,
        payoutOption: ['monthly', 'annually'].includes(payoutOption) ? payoutOption : 'monthly',
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



const getUserStatus = async (req, res) => {
  try {
    const user = await authDB.findById(req.user._id).lean();
    if (!user) {
      return res.status(404).json({ Success: false, Message: 'User not found' });
    }

    return res.json({
      Success: true,
      user: {
        paymentStatus: user.paymentStatus,
        kycStatus: user.kycApproved ? 'approved' : 'pending',
        roiPayoutMethod: user.roiPayoutMethod || null,
        bankDetails: user.bankDetails || {}
      }
    });
  } catch (error) {
    console.error('❌ Error fetching user status:', error.message);
    res.status(500).json({ Success: false, Message: 'Internal Server Error' });
  }
};




module.exports = {
  getPlans,
  getUserInvestments,
  getUserReturns,
  createInvestmentPlan,
  selectPlan,
  getUserStatus // ✅ Add this!
};

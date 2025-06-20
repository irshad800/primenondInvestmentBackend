const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');
const Investment = require('../models/Investment');
const { generateAndSendReceipt } = require('./memberPaymentRoutes');
const { generateNextUserId } = require('./memberPaymentRoutes');

const confirmRegisterCash = async (req, res) => {
  try {
    const { userId, adminPassword } = req.body;
    const admin = [
      process.env.ADMIN1_PASSWORD,
      process.env.ADMIN2_PASSWORD
    ].includes(adminPassword);

    if (!admin) {
      return res.status(401).json({ Success: false, Message: 'Invalid admin password' });
    }

    const user = await authDB.findById(userId);
    if (!user) return res.status(404).json({ Success: false, Message: 'User not found' });

    const payment = await MemberPayment.findOne({
      userId: user._id,
      paymentMethod: 'bank',
      status: 'pending'
    });

    if (!payment) {
      return res.status(404).json({ Success: false, Message: 'No pending bank payment found' });
    }

    payment.status = 'success';
    await payment.save();

    if (!user.userId) {
      user.userId = await generateNextUserId();
    }
    user.paymentStatus = 'success';
    await user.save();

    const receiptData = {
      payment_id: payment.payment_reference,
      pay_currency: 'usd',
      price_amount: payment.amount,
      payment_status: 'success',
      payment_method: 'bank',
      updated_at: new Date(),
      customer_email: user.email,
      order_description: 'Prime Bond Registration'
    };

    await generateAndSendReceipt(receiptData, user.email, user.name, {
      userId: user.userId,
      phone: user.phone,
      alternateContact: user.alternateContact,
      passportNumber: user.passportNumber,
      addressLine1: user.street || '-',
      addressLine2: `${user.city || ''}, ${user.state || ''}, ${user.postalCode || ''}, ${user.country || ''}`
    });

    res.json({ Success: true, Message: 'Cash registration payment confirmed' });
  } catch (error) {
    console.error('❌ Confirm Register Cash Error:', error);
    res.status(500).json({ Success: false, Message: 'Internal Server Error' });
  }
};

const confirmInvestCash = async (req, res) => {
  try {
    const { userId, investmentId, adminPassword } = req.body;
    const admin = [
      process.env.ADMIN1_PASSWORD,
      process.env.ADMIN2_PASSWORD
    ].includes(adminPassword);

    if (!admin) {
      return res.status(401).json({ Success: false, Message: 'Invalid admin password' });
    }

    const user = await authDB.findById(userId);
    if (!user) return res.status(404).json({ Success: false, Message: 'User not found' });

    const investment = await Investment.findById(investmentId);
    if (!investment) return res.status(404).json({ Success: false, Message: 'Investment not found' });

    const payment = await MemberPayment.findOne({
      userId: user._id,
      amount: investment.amount,
      paymentMethod: 'bank',
      status: 'pending'
    });

    if (!payment) {
      return res.status(404).json({ Success: false, Message: 'No pending bank payment found' });
    }

    payment.status = 'success';
    await payment.save();

    investment.status = 'active';
    await investment.save();

    const plan = await InvestmentPlan.findById(investment.planId);

    const receiptData = {
      payment_id: payment.payment_reference,
      pay_currency: 'usd',
      price_amount: payment.amount,
      payment_status: 'success',
      payment_method: 'bank',
      updated_at: new Date(),
      customer_email: user.email,
      order_description: `Prime Bond ${plan.name} Investment`
    };

    await generateAndSendReceipt(receiptData, user.email, user.name, {
      userId: user.userId,
      phone: user.phone,
      alternateContact: user.alternateContact,
      passportNumber: user.passportNumber,
      addressLine1: user.street || '-',
      addressLine2: `${user.city || ''}, ${user.state || ''}, ${user.postalCode || ''}, ${user.country || ''}`
    });

    res.json({ Success: true, Message: 'Cash investment payment confirmed' });
  } catch (error) {
    console.error('❌ Confirm Invest Cash Error:', error);
    res.status(500).json({ Success: false, Message: 'Internal Server Error' });
  }
};

module.exports = { confirmRegisterCash, confirmInvestCash };
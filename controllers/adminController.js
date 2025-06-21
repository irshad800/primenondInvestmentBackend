const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');
const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const { generateAndSendReceipt, generateNextUserId } = require('../routes/paymentRoutes');

const confirmPayment = async (req, res) => {
  try {
    const { identifier, paymentType, paymentMethod, adminPassword, investmentId } = req.body;

    // Validate admin credentials
    const admin = [
      process.env.ADMIN1_PASSWORD,
      process.env.ADMIN2_PASSWORD
    ].includes(adminPassword);

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid admin password' });
    }

    // Validate input
    if (!identifier || !paymentType || !paymentMethod) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Find user by email or other identifiers (phone, passportNumber, username)
    const user = await authDB.findOne({
      $or: [
        { email: identifier },
        { phone: identifier },
        { passportNumber: identifier },
        { username: identifier }
      ]
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Find pending payment
    let paymentQuery = {
      userId: user._id,
      status: 'pending',
      paymentMethod: paymentMethod
    };

    if (paymentType === 'investment' && investmentId) {
      paymentQuery.investmentId = investmentId;
    }

    const payment = await MemberPayment.findOne(paymentQuery);

    if (!payment) {
      return res.status(404).json({ success: false, message: 'No pending payment found' });
    }

    // Update payment status
    payment.status = 'success';
    await payment.save();

    // Update user
    if (!user.userId) {
      user.userId = await generateNextUserId();
    }
    user.paymentStatus = 'success';
    user.paymentMethod = paymentMethod;
    await user.save();

    // Update investment if applicable
    let orderDescription = 'Prime Bond Registration';
    if (paymentType === 'investment' && investmentId) {
      const investment = await Investment.findById(investmentId);
      if (investment) {
        investment.status = 'active';
        await investment.save();
        const plan = await InvestmentPlan.findById(investment.planId);
        orderDescription = `Prime Bond ${plan.name} Investment`;
      }
    }

    // Generate receipt data
    const receiptData = {
      payment_id: payment.payment_reference,
      pay_currency: payment.currency || 'usd',
      price_amount: payment.amount,
      payment_status: 'success',
      payment_method: paymentMethod.toUpperCase(),
      updated_at: new Date(),
      customer_email: user.email,
      order_description: orderDescription
    };

    // Generate and send receipt
    await generateAndSendReceipt(receiptData, user.email, user.name, {
      userId: user.userId,
      phone: user.phone,
      alternateContact: user.alternateContact,
      passportNumber: user.passportNumber,
      addressLine1: user.street || '-',
      addressLine2: `${user.city || ''}, ${user.state || ''}, ${user.postalCode || ''}, ${user.country || ''}`
    });

    res.json({ success: true, message: `${paymentType} payment confirmed successfully` });
  } catch (error) {
    console.error('❌ Confirm Payment Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

module.exports = { confirmPayment };
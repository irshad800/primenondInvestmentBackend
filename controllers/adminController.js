// adminController.js
const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');
const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const Roi = require('../models/Roi');
const Return = require('../models/Return');
const Kyc = require('../models/Kyc');
const { generateAndSendReceipt, generateNextUserId } = require('../routes/paymentRoutes');
const { transporter } = require('../utils/emailService');
const { calculateReturnAmount, calculateNextPayoutDate } = require('../utils/calculateReturn');
const crypto = require('crypto');

const confirmPayment = async (req, res) => {
  try {
    const { identifier, paymentType, paymentMethod, adminPassword, investmentId } = req.body;

    const admin = [
      process.env.ADMIN1_PASSWORD,
      process.env.ADMIN2_PASSWORD
    ].includes(adminPassword);

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid admin password' });
    }

    if (!identifier || !paymentType || !paymentMethod) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

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
      const completedPayment = await MemberPayment.findOne({ userId: user._id, paymentType, investmentId, status: 'success' });
      if (completedPayment) {
        return res.status(400).json({ success: false, message: 'Payment already confirmed' });
      }
      return res.status(404).json({ success: false, message: 'No pending payment found' });
    }

    const validPaymentTypes = ['registration', 'investment', 'roi'];
    if (!payment.paymentType || !validPaymentTypes.includes(payment.paymentType)) {
      payment.paymentType = paymentType;
    }

    payment.status = 'success';
    await payment.save();

    if (!user.userId) {
      user.userId = await generateNextUserId();
    }
    user.paymentStatus = 'success';
    user.paymentMethod = paymentMethod;
    await user.save();

    let orderDescription = 'Prime Bond Registration';
    if (paymentType === 'investment' && investmentId) {
      const investment = await Investment.findById(investmentId);
      if (!investment) {
        return res.status(404).json({ success: false, message: 'Investment not found' });
      }
      investment.status = 'active';
      investment.nextPayoutDate = calculateNextPayoutDate(investment.payoutOption);
      investment.updatedAt = new Date();
      await investment.save();

      try {
        const plan = await InvestmentPlan.findById(investment.planId);
        if (!plan) {
          console.error('❌ Plan not found for investment:', investment._id);
          throw new Error('Plan not found');
        }

        await Roi.findOneAndUpdate(
          { userId: user._id, investmentId: investment._id },
          { returnRate: plan.returnRate, updatedAt: new Date() },
          { upsert: true, new: true }
        );
        console.log(`📈 ROI assigned: ${plan.returnRate}% for investment ${investment._id}`);

        const returnAmount = calculateReturnAmount(investment.amount, plan.returnRate);
        const nextPayoutDate = calculateNextPayoutDate(investment.payoutOption);
        await Return.create({
          userId: user._id,
          investmentId: investment._id,
          amount: returnAmount,
          payoutDate: nextPayoutDate,
          status: 'pending'
        });
        console.log(`💰 Return scheduled: ${returnAmount} for ${investment.payoutOption} payout`);
      } catch (error) {
        console.error('❌ ROI/Return Assignment Error:', error.message);
      }

      const plan = await InvestmentPlan.findById(investment.planId);
      orderDescription = `Prime Bond ${plan.name} Investment`;
    }

    const receiptData = {
      payment_id: payment.payment_reference,
      pay_currency: payment.currency || 'AED',
      price_amount: payment.amount,
      payment_status: 'success',
      payment_method: paymentMethod.toUpperCase(),
      updated_at: new Date(),
      customer_email: user.email,
      order_description: orderDescription
    };

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

const updateKycStatus = async (req, res) => {
  try {
    const { kycId, status, adminPassword, message } = req.body;

    const admin = [
      process.env.ADMIN1_PASSWORD,
      process.env.ADMIN2_PASSWORD
    ].includes(adminPassword);

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid admin password' });
    }

    if (!kycId || !status || !['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid KYC ID or status' });
    }

    const kyc = await Kyc.findById(kycId).populate('userId', 'email name');
    if (!kyc) {
      return res.status(404).json({ success: false, message: 'KYC record not found' });
    }

    kyc.status = status;
    await kyc.save();

    const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1);
    const mailOptions = {
      from: `"Prime Bond" <${process.env.EMAIL_ID}>`,
      to: kyc.userId.email,
      replyTo: 'support@primebond.com',
      subject: `KYC Verification ${capitalizedStatus}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
          <p>Dear ${kyc.userId.name},</p>
          <p>Your KYC submission has been ${status}.</p>
          <p>Message from admin: ${message || `Your KYC submission has been ${status}. Please contact support if you have any questions.`}</p>
          <p>If you have any questions, please contact our support team at support@primebond.com.</p>
        </div>
      `,
      headers: {
        'X-Entity-Ref-ID': crypto.randomUUID(),
        'Precedence': 'bulk'
      },
      priority: 'normal'
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ KYC status email sent to ${kyc.userId.email}. Message ID: ${info.messageId}`);
    } catch (err) {
      console.error('❌ Failed to send KYC status email:', err.message);
    }

    res.json({
      success: true,
      message: `KYC status updated to ${status} successfully`,
      data: kyc
    });
  } catch (error) {
    console.error('❌ KYC Status Update Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

const getAllInvestments = async (req, res) => {
  try {
    const investments = await Investment.find().populate('userId', 'name email userId').populate('planId');
    res.json({ success: true, investments });
  } catch (error) {
    console.error('❌ Admin Get All Investments Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

const getAllRois = async (req, res) => {
  try {
    const rois = await Roi.find().populate('userId', 'name email userId').populate('investmentId');
    res.json({ success: true, rois });
  } catch (error) {
    console.error('❌ Admin Get All ROI Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

const getAllReturns = async (req, res) => {
  try {
    const returns = await Return.find()
      .populate('userId', 'name email userId') // Populate specific user fields
      .populate('investmentId', 'amount planId status payoutOption totalPayouts payoutsMade'); // Populate specific investment fields
    res.json({ success: true, returns });
  } catch (error) {
    console.error('❌ Admin Get All Returns Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

const withdrawRoi = async (req, res) => {
  try {
    const { userId, investmentId, returnId, adminPassword } = req.body;

    const admin = [
      process.env.ADMIN1_PASSWORD,
      process.env.ADMIN2_PASSWORD
    ].includes(adminPassword);

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Invalid admin password' });
    }

    if (!userId || !investmentId || !returnId) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const user = await authDB.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.roiPayoutMethod) {
      return res.status(400).json({ success: false, message: 'User has not set an ROI payout method' });
    }

    const investment = await Investment.findById(investmentId).populate('planId');
    if (!investment) {
      return res.status(404).json({ success: false, message: 'Investment not found' });
    }

    const returnRecord = await Return.findById(returnId);
    if (!returnRecord) {
      return res.status(404).json({ success: false, message: 'Return record not found' });
    }

    if (returnRecord.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Return already paid' });
    }

    const roi = await Roi.findOne({ investmentId: investment._id, userId: user._id });
    if (!roi) {
      return res.status(404).json({ success: false, message: 'ROI record not found' });
    }

    returnRecord.status = 'paid';
    returnRecord.paidAt = new Date();
    await returnRecord.save();

    const returnAmount = returnRecord.amount;
    roi.totalRoiPaid += returnAmount;
    roi.payoutsMade += 1;
    roi.lastPayoutDate = new Date();
    await roi.save();

    investment.payoutsMade += 1;
    if (investment.payoutsMade >= investment.totalPayouts) {
      investment.status = 'completed';
    }
    investment.nextPayoutDate = calculateNextPayoutDate(investment.payoutOption, new Date());
    await investment.save();

    const paymentRecord = new MemberPayment({
      payment_reference: `ROI-${user._id}-${Date.now()}`,
      userId: user._id,
      amount: returnAmount,
      currency: 'AED',
      customer: {
        name: user.name,
        email: user.email,
        phone: user.phone || 'N/A'
      },
      status: 'success',
      paymentMethod: user.roiPayoutMethod,
      paymentType: 'roi',
      investmentId: investment._id
    });

    await paymentRecord.save();

    const receiptData = {
      payment_id: paymentRecord.payment_reference,
      pay_currency: 'AED',
      price_amount: returnAmount,
      payment_status: 'success',
      payment_method: user.roiPayoutMethod.toUpperCase(),
      updated_at: new Date(),
      customer_email: user.email,
      order_description: `ROI Payout for ${investment.planId.name}`,
      payout_details:
        user.roiPayoutMethod === 'bank'
          ? `Bank: ${user.bankDetails.bankName}, Account: ${user.bankDetails.accountNumber}, Holder: ${user.bankDetails.accountHolderName}`
          : user.roiPayoutMethod === 'crypto'
          ? `Wallet: ${user.cryptoDetails.walletAddress}, Coin: ${user.cryptoDetails.coinType}`
          : 'Cash payout at office'
    };

    await generateAndSendReceipt(receiptData, user.email, user.name, {
      userId: user.userId,
      phone: user.phone,
      alternateContact: user.alternateContact,
      passportNumber: user.passportNumber,
      addressLine1: user.street || '-',
      addressLine2: `${user.city || ''}, ${user.state || ''}, ${user.postalCode || ''}, ${user.country || ''}`,
      payoutDetails: receiptData.payout_details
    });

    const mailOptions = {
      from: `"Prime Bond" <${process.env.EMAIL_ID}>`,
      to: user.email,
      replyTo: 'support@primebond.com',
      subject: 'ROI Withdrawal Processed',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
          <p>Dear ${user.name},</p>
          <p>Your ROI withdrawal of ${returnAmount} AED for investment in ${investment.planId.name} has been processed successfully.</p>
          <p>Payment Method: ${user.roiPayoutMethod.toUpperCase()}</p>
          <p>Payout Details: ${
            user.roiPayoutMethod === 'bank'
              ? `Bank: ${user.bankDetails.bankName}, Account: ${user.bankDetails.accountNumber}, Holder: ${user.bankDetails.accountHolderName}`
              : user.roiPayoutMethod === 'crypto'
              ? `Wallet: ${user.cryptoDetails.walletAddress}, Coin: ${user.cryptoDetails.coinType}`
              : 'Cash payout at office'
          }</p>
          <p>Transaction Reference: ${paymentRecord.payment_reference}</p>
          <p>Next Payout Date: ${investment.nextPayoutDate.toLocaleDateString()}</p>
          <p>Please check your account for the funds or visit our office for cash payout. If you have any questions, contact support at support@primebond.com.</p>
        </div>
      `,
      headers: {
        'X-Entity-Ref-ID': crypto.randomUUID(),
        'Precedence': 'bulk'
      },
      priority: 'normal'
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ ROI withdrawal email sent to ${user.email}. Message ID: ${info.messageId}`);
    } catch (err) {
      console.error('❌ Failed to send ROI withdrawal email:', err.message);
    }

    res.json({
      success: true,
      message: 'ROI withdrawal processed successfully',
      data: {
        paymentId: paymentRecord._id,
        returnId: returnRecord._id,
        amount: returnAmount,
        paymentMethod: user.roiPayoutMethod,
        payoutDetails:
          user.roiPayoutMethod === 'bank'
            ? user.bankDetails
            : user.roiPayoutMethod === 'crypto'
            ? user.cryptoDetails
            : 'Cash payout at office',
        nextPayoutDate: investment.nextPayoutDate
      }
    });
  } catch (error) {
    console.error('❌ ROI Withdrawal Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const totalDeposits = await MemberPayment.aggregate([
      { $match: { paymentType: { $in: ['registration', 'investment'] }, status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    const totalInvested = await Investment.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);

    const totalRoiPaid = await Return.aggregate([
      { $match: { status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    const investments = await Investment.find();
    const completionRate = investments.length > 0 
      ? (investments.filter(i => i.payoutsMade >= i.totalPayouts).length / investments.length * 100).toFixed(2) 
      : 0;

    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const prevMonthDeposits = await MemberPayment.aggregate([
      { $match: { createdAt: { $lt: lastMonth }, paymentType: { $in: ['registration', 'investment'] }, status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    const depositGrowthRate = totalDeposits > 0 && prevMonthDeposits > 0 
      ? (((totalDeposits - prevMonthDeposits) / prevMonthDeposits) * 100).toFixed(2) 
      : 0;
    const investedGrowthRate = investments.length > 0 
      ? (((totalInvested - (await Investment.aggregate([
          { $match: { status: 'active', updatedAt: { $lt: lastMonth } } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]).then(result => result[0]?.total || 0))) / totalInvested) * 100).toFixed(2) 
      : 0;

    const capitalGainsIncrease = totalRoiPaid > 0 
      ? (((totalRoiPaid - (await Return.aggregate([{ $match: { paidAt: { $lt: lastMonth }, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]).then(result => result[0]?.total || 0))) / totalRoiPaid) * 100).toFixed(2) 
      : 0;

    const totalUsers = await authDB.countDocuments();
    const approvedKyc = await Kyc.countDocuments({ status: 'approved' });
    const techSupportPercentage = totalUsers > 0 ? (approvedKyc / totalUsers * 100).toFixed(2) : 0;
    const kycSince2018 = await Kyc.find({ createdAt: { $gte: new Date('2018-01-01') } }).countDocuments();
    const kycGrowthSince2018 = totalUsers > 0 ? (((approvedKyc - kycSince2018) / kycSince2018) * 100).toFixed(2) : 0;

    const totalOrders = await MemberPayment.countDocuments({ status: 'success' });
    const lastYearOrders = await MemberPayment.countDocuments({ createdAt: { $gte: new Date(new Date().getFullYear() - 1, 0, 1) }, status: 'success' });
    const yoyGrowth = lastYearOrders > 0 ? (((totalOrders - lastYearOrders) / lastYearOrders) * 100).toFixed(2) : 0;

    const lastMonthSales = await MemberPayment.aggregate([
      { $match: { createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), $lt: new Date() }, status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    const salesIncome = await MemberPayment.aggregate([
      { $match: { paymentType: { $in: ['investment', 'roi'] }, status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    const last12MonthsSales = await MemberPayment.aggregate([
      { $match: { createdAt: { $gte: new Date(new Date().getFullYear() - 1, 0, 1) }, status: 'success' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]).then(result => result[0]?.total || 0);
    const totalRevenue = salesIncome + totalRoiPaid;

    res.json({
      success: true,
      stats: {
        portfolioPerformance: {
          cashDeposits: { value: totalDeposits, growthRate: depositGrowthRate },
          investedDividends: { value: totalInvested, growthRate: investedGrowthRate, completionRate },
          capitalGains: { value: totalRoiPaid, increase: capitalGainsIncrease }
        },
        technicalSupport: { percentage: techSupportPercentage, growthSince2018: kycGrowthSince2018 },
        salesProgress: { totalOrders, yoyGrowth },
        financialBreakdown: {
          salesLastMonth: lastMonthSales,
          salesIncome,
          salesLast12Months: last12MonthsSales,
          totalRevenue
        }
      }
    });
  } catch (error) {
    console.error('❌ Dashboard Stats Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

module.exports = {
  confirmPayment,
  updateKycStatus,
  getAllInvestments,
  getAllRois,
  getAllReturns,
  withdrawRoi,
  getDashboardStats
};
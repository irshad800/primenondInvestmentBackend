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

// Helper function to get current date-time with timezone
const getCurrentDateTime = () => new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai', hour12: true });

const confirmPayment = async (req, res) => {
  try {
    const { identifier, paymentType, paymentMethod, adminPassword, investmentId } = req.body;
    const currentTime = getCurrentDateTime();

    const admin = [
      process.env.ADMIN1_PASSWORD,
      process.env.ADMIN2_PASSWORD
    ].includes(adminPassword);

    if (!admin) {
      console.error(`❌ [${currentTime}] Invalid admin password attempt`);
      return res.status(401).json({ success: false, message: 'Invalid admin password' });
    }

    if (!identifier || !paymentType || !paymentMethod) {
      console.error(`❌ [${currentTime}] Missing required fields: identifier=${identifier}, paymentType=${paymentType}, paymentMethod=${paymentMethod}`);
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
      console.error(`❌ [${currentTime}] User not found for identifier: ${identifier}`);
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
        console.error(`❌ [${currentTime}] Payment already confirmed: userId=${user._id}, paymentType=${paymentType}, investmentId=${investmentId}`);
        return res.status(400).json({ success: false, message: 'Payment already confirmed' });
      }
      console.error(`❌ [${currentTime}] No pending payment found: userId=${user._id}, paymentType=${paymentType}, investmentId=${investmentId}`);
      return res.status(404).json({ success: false, message: 'No pending payment found' });
    }

    const validPaymentTypes = ['registration', 'investment', 'roi'];
    if (!payment.paymentType || !validPaymentTypes.includes(payment.paymentType)) {
      payment.paymentType = paymentType;
    }

    payment.status = 'success';
    await payment.save();
    console.log(`✅ [${currentTime}] Payment confirmed: paymentId=${payment._id}, userId=${user._id}, type=${paymentType}`);

    if (!user.userId) {
      user.userId = await generateNextUserId();
    }
    user.paymentStatus = 'success';
    user.paymentMethod = paymentMethod;
    await user.save();
    console.log(`✅ [${currentTime}] User updated: userId=${user._id}, paymentStatus=success, paymentMethod=${paymentMethod}`);

    let orderDescription = 'Prime Bond Registration';
    if (paymentType === 'investment' && investmentId) {
      const investment = await Investment.findById(investmentId);
      if (!investment) {
        console.error(`❌ [${currentTime}] Investment not found: investmentId=${investmentId}`);
        return res.status(404).json({ success: false, message: 'Investment not found' });
      }
      investment.status = 'active';
      investment.nextPayoutDate = calculateNextPayoutDate(investment.payoutOption);
      investment.updatedAt = new Date();
      await investment.save();
      console.log(`✅ [${currentTime}] Investment activated: investmentId=${investmentId}, nextPayoutDate=${investment.nextPayoutDate}`);

      try {
        const plan = await InvestmentPlan.findById(investment.planId);
        if (!plan) {
          console.error(`❌ [${currentTime}] Plan not found for investment: investmentId=${investment._id}`);
          throw new Error('Plan not found');
        }

        await Roi.findOneAndUpdate(
          { userId: user._id, investmentId: investment._id },
          { returnRate: plan.returnRate, updatedAt: new Date() },
          { upsert: true, new: true }
        );
        console.log(`📈 [${currentTime}] ROI assigned: ${plan.returnRate}% for investment ${investment._id}`);

        const returnAmount = calculateReturnAmount(investment.amount, plan.returnRate);
        const nextPayoutDate = calculateNextPayoutDate(investment.payoutOption);
        await Return.create({
          userId: user._id,
          investmentId: investment._id,
          amount: returnAmount,
          payoutDate: nextPayoutDate,
          status: 'pending'
        });
        console.log(`💰 [${currentTime}] Return scheduled: amount=${returnAmount}, payoutDate=${nextPayoutDate}, investmentId=${investment._id}`);
      } catch (error) {
        console.error(`❌ [${currentTime}] ROI/Return Assignment Error: investmentId=${investmentId}, error=${error.message}`);
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
    console.log(`✅ [${currentTime}] Receipt sent: userEmail=${user.email}, paymentId=${payment.payment_reference}`);

    res.json({ success: true, message: `${paymentType} payment confirmed successfully` });
  } catch (error) {
    console.error(`❌ [${getCurrentDateTime()}] Confirm Payment Error: ${error.message}, stack=${error.stack}`);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

const updateKycStatus = async (req, res) => {
  try {
    const { kycId, status, adminPassword, message } = req.body;
    const currentTime = getCurrentDateTime();

    if (!kycId || !status || !['approved', 'rejected', 'pending'].includes(status)) {
      console.error(`❌ [${currentTime}] Invalid KYC ID or status: kycId=${kycId}, status=${status}`);
      return res.status(400).json({ success: false, message: 'Invalid KYC ID or status' });
    }

    const admin = [
      process.env.ADMIN1_PASSWORD,
      process.env.ADMIN2_PASSWORD
    ].includes(adminPassword);

    if (!admin) {
      console.error(`❌ [${currentTime}] Invalid admin password attempt`);
      return res.status(401).json({ success: false, message: 'Invalid admin password' });
    }

    const kyc = await Kyc.findById(kycId).populate('userId', 'email name _id kycApproved');
    if (!kyc) {
      console.error(`❌ [${currentTime}] KYC record not found: kycId=${kycId}`);
      return res.status(404).json({ success: false, message: 'KYC record not found' });
    }

    const adminMessage = (typeof message === 'string' && message.trim().length > 0)
      ? message.trim()
      : `Your KYC submission has been ${status} on ${new Date().toISOString()}. Please contact support if you have any questions.`;

    kyc.status = status;
    kyc.adminMessage = adminMessage;

    console.log(`📌 [${currentTime}] Incoming admin message:`, message);
    console.log(`📌 [${currentTime}] Final admin message to save:`, adminMessage);

    await kyc.save();
    console.log(`✅ [${currentTime}] KYC saved: kycId=${kycId}, status=${status}, userId=${kyc.userId._id}`);

    // Validate and update kycApproved
    const userId = kyc.userId._id;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error(`❌ [${currentTime}] Invalid userId format: ${userId}`);
      return res.status(500).json({ success: false, message: 'Invalid user ID' });
    }

    // Check if the user exists before updating
    const existingUser = await authDB.findById(userId).select('kycApproved');
    if (!existingUser) {
      console.error(`❌ [${currentTime}] User not found in auth collection: userId=${userId}`);
      return res.status(404).json({ success: false, message: 'User not found in auth collection' });
    }
    console.log(`📌 [${currentTime}] Current user state before update: kycApproved=${existingUser.kycApproved}, userId=${userId}`);

    const updateData = { kycApproved: status === 'approved' };
    const updateResult = await authDB.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true, upsert: false }
    );

    if (!updateResult) {
      console.error(`❌ [${currentTime}] Failed to update kycApproved for userId: ${userId}`);
      // Fetch again to confirm state
      const currentUser = await authDB.findById(userId).select('kycApproved');
      console.error(`❌ [${currentTime}] Current user state after failed update: kycApproved=${currentUser ? currentUser.kycApproved : 'User not found'}, userId=${userId}`);
    } else {
      console.log(`✅ [${currentTime}] Updated kycApproved to ${updateData.kycApproved} for userId: ${userId}, newDoc=${JSON.stringify(updateResult)}`);
    }

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
          <p>Message from admin: ${adminMessage}</p>
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
      console.log(`✅ [${currentTime}] KYC status email sent: ${info.messageId}`);
    } catch (err) {
      console.error(`❌ [${currentTime}] Email sending failed: ${err.message}`);
    }

    res.json({
      success: true,
      message: `KYC status updated to ${status} successfully`,
      data: kyc
    });
  } catch (error) {
    console.error(`❌ [${getCurrentDateTime()}] KYC Status Update Error: ${error.message}`, error.stack);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
const getAllInvestments = async (req, res) => {
  try {
    const currentTime = getCurrentDateTime();
    const investments = await Investment.find().populate('userId', 'name email userId').populate('planId');
    console.log(`✅ [${currentTime}] Fetched all investments: count=${investments.length}`);
    res.json({ success: true, investments });
  } catch (error) {
    const currentTime = getCurrentDateTime();
    console.error(`❌ [${currentTime}] Admin Get All Investments Error: ${error.message}, stack=${error.stack}`);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

const getAllRois = async (req, res) => {
  try {
    const currentTime = getCurrentDateTime();
    const rois = await Roi.find().populate('userId', 'name email userId').populate('investmentId');
    console.log(`✅ [${currentTime}] Fetched all ROIs: count=${rois.length}`);
    res.json({ success: true, rois });
  } catch (error) {
    const currentTime = getCurrentDateTime();
    console.error(`❌ [${currentTime}] Admin Get All ROI Error: ${error.message}, stack=${error.stack}`);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

const getAllReturns = async (req, res) => {
  try {
    const currentTime = getCurrentDateTime();
    const returns = await Return.find()
      .populate('userId', 'name email userId')
      .populate('investmentId', 'amount planId status payoutOption totalPayouts payoutsMade');
    console.log(`✅ [${currentTime}] Fetched all returns: count=${returns.length}`);
    res.json({ success: true, returns });
  } catch (error) {
    const currentTime = getCurrentDateTime();
    console.error(`❌ [${currentTime}] Admin Get All Returns Error: ${error.message}, stack=${error.stack}`);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

const withdrawRoi = async (req, res) => {
  try {
    const { userId, investmentId, returnId, adminPassword } = req.body;
    const currentTime = getCurrentDateTime();

    const admin = [
      process.env.ADMIN1_PASSWORD,
      process.env.ADMIN2_PASSWORD
    ].includes(adminPassword);

    if (!admin) {
      console.error(`❌ [${currentTime}] Invalid admin password for withdrawRoi: ${adminPassword}`);
      return res.status(401).json({ success: false, message: 'Invalid admin password' });
    }

    if (!userId || !investmentId || !returnId) {
      console.error(`❌ [${currentTime}] Missing required fields: userId=${userId}, investmentId=${investmentId}, returnId=${returnId}`);
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const user = await authDB.findById(userId);
    if (!user) {
      console.error(`❌ [${currentTime}] User not found: userId=${userId}`);
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.roiPayoutMethod) {
      console.error(`❌ [${currentTime}] User has no ROI payout method: userId=${userId}`);
      return res.status(400).json({ success: false, message: 'User has not set an ROI payout method' });
    }

    const investment = await Investment.findById(investmentId).populate('planId');
    if (!investment) {
      console.error(`❌ [${currentTime}] Investment not found: investmentId=${investmentId}`);
      return res.status(404).json({ success: false, message: 'Investment not found' });
    }

    const returnRecord = await Return.findById(returnId);
    if (!returnRecord) {
      console.error(`❌ [${currentTime}] Return record not found: returnId=${returnId}`);
      return res.status(404).json({ success: false, message: 'Return record not found' });
    }

    if (returnRecord.status === 'paid') {
      console.error(`❌ [${currentTime}] Return already paid: returnId=${returnId}`);
      return res.status(400).json({ success: false, message: 'Return already paid' });
    }

    const roi = await Roi.findOne({ investmentId: investment._id, userId: user._id });
    if (!roi) {
      console.error(`❌ [${currentTime}] ROI record not found for userId=${userId}, investmentId=${investmentId}`);
      return res.status(404).json({ success: false, message: 'ROI record not found' });
    }

    returnRecord.status = 'paid';
    returnRecord.paidAt = new Date();
    await returnRecord.save();
    console.log(`✅ [${currentTime}] Return marked as paid: returnId=${returnId}, paidAt=${returnRecord.paidAt}`);

    const returnAmount = returnRecord.amount;
    roi.totalRoiPaid += returnAmount;
    roi.payoutsMade += 1;
    roi.lastPayoutDate = new Date();
    await roi.save();
    console.log(`✅ [${currentTime}] ROI updated: totalRoiPaid=${roi.totalRoiPaid}, payoutsMade=${roi.payoutsMade}, lastPayoutDate=${roi.lastPayoutDate}`);

    investment.payoutsMade += 1;
    if (investment.payoutsMade >= investment.totalPayouts) {
      investment.status = 'completed';
      console.log(`✅ [${currentTime}] Investment completed: investmentId=${investmentId}, payoutsMade=${investment.payoutsMade}, totalPayouts=${investment.totalPayouts}`);
    }
    investment.nextPayoutDate = calculateNextPayoutDate(investment.payoutOption, new Date());
    await investment.save();
    console.log(`✅ [${currentTime}] Investment updated: investmentId=${investmentId}, payoutsMade=${investment.payoutsMade}, nextPayoutDate=${investment.nextPayoutDate}`);

    const paymentRecord = new MemberPayment({
      payment_reference: `ROI-${user._id}-${Date.now()}`,
      userId: user._id,
      amount: returnAmount,
      currency: 'AED',
      customer: { name: user.name, email: user.email, phone: user.phone || 'N/A' },
      status: 'success',
      paymentMethod: user.roiPayoutMethod,
      paymentType: 'roi',
      investmentId: investment._id
    });

    await paymentRecord.save();
    console.log(`✅ [${currentTime}] Payment record created: paymentId=${paymentRecord._id}, amount=${returnAmount}`);

    const receiptData = {
      payment_id: paymentRecord.payment_reference,
      pay_currency: 'AED',
      price_amount: returnAmount,
      payment_status: 'success',
      payment_method: user.roiPayoutMethod.toUpperCase(),
      updated_at: new Date(),
      customer_email: user.email,
      order_description: `ROI Payout for ${investment.planId.name}`,
      payout_details: user.roiPayoutMethod === 'bank'
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
      headers: { 'X-Entity-Ref-ID': crypto.randomUUID(), 'Precedence': 'bulk' },
      priority: 'normal'
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ [${currentTime}] ROI withdrawal email sent to ${user.email}. Message ID: ${info.messageId}`);
    } catch (err) {
      console.error(`❌ [${currentTime}] Failed to send ROI withdrawal email: ${err.message}`);
    }

    res.json({
      success: true,
      message: 'ROI withdrawal processed successfully',
      data: {
        paymentId: paymentRecord._id,
        returnId: returnRecord._id,
        amount: returnAmount,
        paymentMethod: user.roiPayoutMethod,
        payoutDetails: user.roiPayoutMethod === 'bank'
          ? user.bankDetails
          : user.roiPayoutMethod === 'crypto'
          ? user.cryptoDetails
          : 'Cash payout at office',
        nextPayoutDate: investment.nextPayoutDate
      }
    });
  } catch (error) {
    const currentTime = getCurrentDateTime();
    console.error(`❌ [${currentTime}] ROI Withdrawal Error: userId=${req.body.userId}, investmentId=${req.body.investmentId}, returnId=${req.body.returnId}, error=${error.message}, stack=${error.stack}`);
    res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const currentTime = getCurrentDateTime();
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

    console.log(`✅ [${currentTime}] Dashboard stats generated: totalDeposits=${totalDeposits}, totalInvested=${totalInvested}, totalRoiPaid=${totalRoiPaid}`);
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
    const currentTime = getCurrentDateTime();
    console.error(`❌ [${currentTime}] Dashboard Stats Error: ${error.message}, stack=${error.stack}`);
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
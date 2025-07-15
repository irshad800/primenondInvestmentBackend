const express = require('express');
const router = express.Router();
const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');
const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const Roi = require('../models/Roi');
const { payRegister, payInvestment, callback } = require('../controllers/paymentController');
const { ensureAuth } = require('../middleware/authMiddleware');
const { generateAndSendReceipt, generateNextUserId } = require('../utils/paymentUtils');
const fs = require('fs');
const path = require('path');

router.get('/test-receipt', async (req, res) => {
  try {
    const fakePaymentData = {
      payment_id: 'TEST12345678',
      updated_at: new Date().toISOString(),
      price_amount: 50,
      pay_currency: 'INR',
      order_description: 'Prime Bond Test Membership',
      payment_status: 'success',
      payment_method: 'CARD'
    };

    const testUserEmail = 'irshadvp800@gmail.com';
    const testUserName = 'Test User';

    const fakeUserDetails = {
      userId: 'PRB99999',
      phone: '+971500000000',
      alternateContact: '+971500000001',
      passportNumber: 'A12345678',
      addressLine1: 'Palm Jumeirah',
      addressLine2: 'Dubai, UAE'
    };

    await generateAndSendReceipt(fakePaymentData, testUserEmail, testUserName, fakeUserDetails);

    res.json({ success: true, message: `✅ Test email sent to ${testUserEmail}` });
  } catch (error) {
    console.error('❌ Test Receipt Error:', error);
    res.status(500).json({ success: false, message: 'Failed to send test receipt.' });
  }
});

router.get('/history/:userId', ensureAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user._id.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized access' });
    }

    const payments = await MemberPayment.find({ userId })
      .select('payment_reference amount currency status paymentMethod paymentType createdAt')
      .sort({ createdAt: -1 });

    res.json({ success: true, payments });
  } catch (error) {
    console.error('❌ Get Payment History Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

router.get('/download-receipt/:paymentId', ensureAuth, async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!paymentId) {
      return res.status(400).json({ success: false, message: 'Payment ID is required' });
    }

    const payment = await MemberPayment.findOne({ payment_reference: paymentId });
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    if (payment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized access' });
    }

    const receiptsDir = path.join(__dirname, "../receipts");
    const filePath = path.join(receiptsDir, `receipt-${paymentId}.pdf`);

    if (!fs.existsSync(filePath)) {
      const user = await authDB.findById(payment.userId);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const paymentData = {
        payment_id: payment.payment_reference,
        updated_at: payment.updatedAt?.toISOString() || new Date().toISOString(),
        price_amount: payment.amount,
        pay_currency: payment.currency,
        order_description: payment.investmentId
          ? `Investment in ${(await InvestmentPlan.findById((await Investment.findById(payment.investmentId)).planId)).name}`
          : 'Registration Payment',
        payment_status: payment.status,
        payment_method: payment.paymentMethod.toUpperCase(),
        paymentType: payment.paymentType
      };

      let investmentDetails = {};
      if (payment.paymentType === 'investment' && payment.investmentId) {
        const investment = await Investment.findById(payment.investmentId);
        if (investment) {
          const plan = await InvestmentPlan.findById(investment.planId);
          const roi = await Roi.findOne({ investmentId: payment.investmentId });
          investmentDetails = {
            planName: plan.name,
            amount: investment.amount,
            payoutOption: investment.payoutOption || 'n/a',
            roiDetails: {
              monthlyReturn: Number(roi?.monthlyReturnAmount || 0).toFixed(2),
              annualReturn: Number(roi?.annualReturnAmount || 0).toFixed(2)
            }
          };
        }
      }

      await generateAndSendReceipt(
        { ...paymentData, investmentDetails },
        user.email,
        user.name,
        {
          userId: user.userId,
          phone: user.phone,
          alternateContact: user.alternateContact,
          passportNumber: user.passportNumber,
          addressLine1: user.street || '-',
          addressLine2: `${user.city || ''}, ${user.state || ''}, ${user.postalCode || ''}, ${user.country || ''}`
        },
        true,
        false
      );

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: 'Receipt file not generated' });
      }
    }

    res.setHeader('Content-Disposition', `attachment; filename="receipt-${paymentId}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('end', () => fs.unlinkSync(filePath));
  } catch (error) {
    console.error('❌ Download Receipt Error:', error);
    res.status(500).json({ success: false, message: 'Failed to download receipt', error: error.message });
  }
});



// In paymentRoutes.js
router.get('/payment-details/:paymentId', ensureAuth, async (req, res) => {
    try {
        const { paymentId } = req.params;
        if (!paymentId) {
            return res.status(400).json({ success: false, message: 'Payment ID is required' });
        }

        const payment = await MemberPayment.findOne({ payment_reference: paymentId });
        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        if (payment.userId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Unauthorized access' });
        }

        const paymentData = {
            paymentType: payment.paymentType,
            amount: payment.amount,
            currency: payment.currency,
            transactionId: payment.transactionId || 'N/A',
            paymentMethod: payment.paymentMethod,
            customer: payment.customer,
        };

        if (payment.paymentType === 'investment' && payment.investmentId) {
            const investment = await Investment.findById(payment.investmentId);
            if (investment) {
                const plan = await InvestmentPlan.findById(investment.planId);
                const roi = await Roi.findOne({ investmentId: payment.investmentId });
                paymentData.investmentDetails = {
                    planName: plan.name,
                    amount: investment.amount,
                    payoutOption: investment.payoutOption || 'N/A',
                    durationMonths: investment.totalPayouts || 0
                };
                paymentData.roiDetails = {
                    monthlyReturn: Number(roi?.monthlyReturnAmount || 0).toFixed(2),
                    annualReturn: Number(roi?.annualReturnAmount || 0).toFixed(2)
                };
            }
        }

        res.json({ success: true, payment: paymentData });
    } catch (error) {
        console.error('❌ Get Payment Details Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch payment details', error: error.message });
    }
});


router.post('/register', ensureAuth, payRegister);
router.post('/investment', ensureAuth, payInvestment);
router.post('/callback', callback);

module.exports = { router };
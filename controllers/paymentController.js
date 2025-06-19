const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');
const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const fetch = require('node-fetch');
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET);
const { generateAndSendReceipt, generateNextUserId } = require('../routes/paymentRoutes'); // Fixed import
const { calculateNextPayoutDate } = require('../utils/calculateReturn');

const payRegister = async (req, res) => {
  try {
    const userMongoId = req.user?._id;
    if (!userMongoId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await authDB.findById(userMongoId);
    if (!user) return res.status(404).json({ error: 'User not found' });


   // ✅ Prevent re-payment if already paid
    if (user.paymentStatus === 'success') {
      return res.status(400).json({
        success: false,
        message: 'You have already completed your registration payment.'
      });
    }



    const fixedAmount = 50.0;
const method = req.body.method || req.body.payment_method || 'walletcrypto';
    const paymentCurrency = req.body.currency || 'usdttrc20';

    if (method === 'bank') {
      await authDB.updateOne(
        { _id: userMongoId },
        {
          paymentStatus: 'pending',
          paymentMethod: 'bank',
          transactionId: null,
          lastPaymentLink: null,
          cryptoCoin: null
        }
      );

      await new MemberPayment({
        payment_reference: `BANK-${Date.now()}`,
        userId: user._id,
        amount: fixedAmount,
        currency: 'usd',
        customer: {
          name: user.name,
          email: user.email,
          phone: user.phone || 'N/A'
        },
        status: 'pending',
        paymentMethod: 'bank'
      }).save();

      return res.json({
        success: true,
        message: 'Bank payment recorded. Awaiting manual confirmation.'
      });
    }

    if (method === 'card') {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: 'Prime Bond Registration' },
            unit_amount: 5000
          },
          quantity: 1
        }],
        mode: 'payment',
        customer_email: user.email,
        success_url: `${process.env.BASE_URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.BASE_URL}/payment-cancel.html`,
        payment_method_options: { card: { request_three_d_secure: 'any' } },
        metadata: { userId: user._id.toString() }
      });

      await new MemberPayment({
        payment_reference: session.id,
        userId: user._id,
        amount: fixedAmount,
        currency: 'usd',
        customer: {
          name: user.name,
          email: user.email,
          phone: user.phone || 'N/A'
        },
        status: 'pending',
        paymentMethod: 'card'
      }).save();

      return res.json({ success: true, sessionId: session.id, url: session.url });
    }

    const invoiceRes = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.NOWPAYMENTS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        price_amount: fixedAmount,
        price_currency: 'usd',
        pay_currency: paymentCurrency,
        order_description: 'Prime Bond Registration',
        ipn_callback_url: `${process.env.BASE_URL}/api/pay/callback`,
        success_url: `${process.env.BASE_URL}/dashboard.html`,
        cancel_url: `${process.env.BASE_URL}/payment-cancel.html`,
        customer_email: user.email
      })
    });

    const invoiceData = await invoiceRes.json();

    if (invoiceData.invoice_url && invoiceData.id) {
      await new MemberPayment({
        payment_reference: invoiceData.id,
        userId: user._id,
        amount: fixedAmount,
        currency: paymentCurrency,
        customer: {
          name: user.name,
          email: user.email,
          phone: user.phone || 'N/A'
        },
        status: 'pending',
        paymentMethod: 'walletcrypto'
      }).save();

      await authDB.updateOne(
        { _id: userMongoId },
        {
          transactionId: invoiceData.id,
          paymentStatus: 'pending',
          paymentMethod: 'walletcrypto',
          lastPaymentLink: invoiceData.invoice_url,
          cryptoCoin: paymentCurrency
        }
      );

      return res.json({
        success: true,
        message: 'Invoice created successfully',
        transactionId: invoiceData.id,
        redirectURL: invoiceData.invoice_url,
        payAmount: fixedAmount,
        currency: paymentCurrency
      });
    } else {
      return res.status(500).json({ error: 'Failed to create invoice' });
    }
  } catch (error) {
    console.error('❌ Payment Error:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
};

const payInvestment = async (req, res) => {
  try {
    const userMongoId = req.user?._id;
    const { planId, amount, method, currency } = req.body;

    if (!planId || !amount) {
      return res.status(400).json({ Success: false, Message: 'Missing planId or amount' });
    }

    const user = await authDB.findById(userMongoId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const plan = await InvestmentPlan.findById(planId);
    if (!plan) return res.status(404).json({ error: 'Investment plan not found' });

    if (amount < plan.minAmount || (plan.maxAmount && amount > plan.maxAmount)) {
      return res.status(400).json({ Success: false, Message: 'Amount outside plan limits' });
    }

    const investment = new Investment({
      userId: userMongoId,
      planId,
      amount,
      nextPayoutDate: calculateNextPayoutDate(),
      totalPayouts: plan.durationMonths,
      status: 'pending'
    });

    if (method === 'bank') {
      await investment.save();

      await new MemberPayment({
        payment_reference: `BANK-INV-${Date.now()}`,
        userId: user._id,
        amount,
        currency: 'usd',
        customer: {
          name: user.name,
          email: user.email,
          phone: user.phone || 'N/A'
        },
        status: 'pending',
        paymentMethod: 'bank'
      }).save();

      return res.json({
        success: true,
        message: 'Bank investment recorded. Awaiting manual confirmation.'
      });
    }

    if (method === 'card') {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: `Prime Bond ${plan.name}` },
            unit_amount: amount * 100
          },
          quantity: 1
        }],
        mode: 'payment',
        customer_email: user.email,
        success_url: `${process.env.BASE_URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.BASE_URL}/payment-cancel.html`,
        payment_method_options: { card: { request_three_d_secure: 'any' } },
        metadata: { userId: user._id.toString(), planId: planId.toString() }
      });

      await investment.save();

      await new MemberPayment({
        payment_reference: session.id,
        userId: user._id,
        amount,
        currency: 'usd',
        customer: {
          name: user.name,
          email: user.email,
          phone: user.phone || 'N/A'
        },
        status: 'pending',
        paymentMethod: 'card'
      }).save();

      return res.json({ success: true, sessionId: session.id, url: session.url });
    }

    const invoiceRes = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.NOWPAYMENTS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        price_amount: amount,
        price_currency: 'usd',
        pay_currency: currency || 'usdttrc20',
        order_description: `Prime Bond ${plan.name} Investment`,
        ipn_callback_url: `${process.env.BASE_URL}/api/pay/callback`,
        success_url: `${process.env.BASE_URL}/dashboard.html`,
        cancel_url: `${process.env.BASE_URL}/payment-cancel.html`,
        customer_email: user.email
      })
    });

    const invoiceData = await invoiceRes.json();

    if (invoiceData.invoice_url && invoiceData.id) {
      await investment.save();

      await new MemberPayment({
        payment_reference: invoiceData.id,
        userId: user._id,
        amount,
        currency: currency || 'usdttrc20',
        customer: {
          name: user.name,
          email: user.email,
          phone: user.phone || 'N/A'
        },
        status: 'pending',
        paymentMethod: 'walletcrypto'
      }).save();

      return res.json({
        success: true,
        message: 'Investment invoice created successfully',
        transactionId: invoiceData.id,
        redirectURL: invoiceData.invoice_url,
        payAmount: amount,
        currency
      });
    } else {
      return res.status(500).json({ error: 'Failed to create invoice' });
    }
  } catch (error) {
    console.error('❌ Investment Payment Error:', error);
    res.status(500).json({ error: 'Failed to process investment payment' });
  }
};

const callback = async (req, res) => {
  try {
    const data = req.body;
    console.log('📥 Payment Callback Received:', data);

    if (data.payment_status === 'finished') {
      const payment = await MemberPayment.findOneAndUpdate(
        { payment_reference: data.invoice_id },
        { status: 'success' },
        { new: true }
      );

      if (payment) {
        const user = await authDB.findById(payment.userId);
        if (user) {
          if (!user.userId) {
            user.userId = await generateNextUserId();
          }

          user.paymentStatus = 'success';
          await user.save();

          const investment = await Investment.findOne({
            userId: payment.userId,
            amount: payment.amount,
            status: 'pending'
          });

          if (investment) {
            investment.status = 'active';
            await investment.save();
          }

          const receiptRes = await fetch('https://api.nowpayments.io/v1/payment', {
            method: 'POST',
            headers: {
              'x-api-key': process.env.NOWPAYMENTS_API_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ payment_id: data.invoice_id })
          });

          let fullData = await receiptRes.json();
          fullData.payment_status = 'success';
          fullData.payment_method = 'WALLETCRYPTO';

          await generateAndSendReceipt(fullData, user.email, user.name, {
            userId: user.userId,
            phone: user.phone,
            alternateContact: user.alternateContact,
            passportNumber: user.passportNumber,
            addressLine1: user.street || '-',
            addressLine2: `${user.city || ''}, ${user.state || ''}, ${user.postalCode || ''}, ${user.country || ''}`
          });
        }
      }
    }

    res.status(200).send('IPN received');
  } catch (error) {
    console.error('❌ IPN Callback Error:', error);
    res.status(500).json({ message: 'Callback error' });
  }
};

module.exports = { payRegister, payInvestment, callback };
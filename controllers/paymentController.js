const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');
const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const fetch = require('node-fetch');
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET);
const { generateAndSendReceipt, generateNextUserId } = require('../routes/paymentRoutes');
const { calculateNextPayoutDate } = require('../utils/calculateReturn');

/**
 * @desc    Process registration payment
 * @route   POST /api/pay/register
 * @access  Private
 */
const payRegister = async (req, res) => {
  try {
    // Validate user authentication
    const userMongoId = req.user?._id;
    if (!userMongoId) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized: User not authenticated' 
      });
    }

    // Find user in database
    const user = await authDB.findById(userMongoId);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    // Check if payment already completed
    if (user.paymentStatus === 'success') {
      return res.status(400).json({
        success: false,
        message: 'You have already completed your registration payment.'
      });
    }

    // Payment configuration
    const fixedAmount = 50.0;
    const method = req.body.method?.trim().toLowerCase();
    const paymentCurrency = req.body.currency || 'usdttrc20';

    console.log('🔍 Payment Initiated:', {
      user: user.email,
      rawBody: req.body,
      method: method,
      amount: fixedAmount
    });

    // Validate payment method
    if (!method) {
      return res.status(400).json({ 
        success: false,
        error: 'Payment method is required' 
      });
    }

    const validMethods = ['bank', 'cash', 'card', 'walletcrypto'];
    if (!validMethods.includes(method)) {
      return res.status(400).json({ 
        success: false,
        error: `Invalid payment method: ${method}` 
      });
    }

    // Handle Bank or Cash payment
    if (['bank', 'cash'].includes(method)) {
      console.log(`💵 Confirmed ${method} payment processing for ${user.email}`);

      // Update user
      await authDB.updateOne(
        { _id: userMongoId },
        {
          paymentStatus: 'pending',
          paymentMethod: method,
          transactionId: null,
          lastPaymentLink: null,
          cryptoCoin: null,
          updatedAt: new Date()
        }
      );

      // Create payment record
      const paymentRecord = new MemberPayment({
        payment_reference: `${method.toUpperCase()}-REG-${Date.now()}`,
        userId: user._id,
        amount: fixedAmount,
        currency: 'usd',
        customer: {
          name: user.name,
          email: user.email,
          phone: user.phone || 'N/A'
        },
        status: 'pending',
        paymentMethod: method,
        paymentType: 'registration'
      });

      await paymentRecord.save();

      return res.json({
        success: true,
        message: `${method === 'bank' ? 'Bank transfer' : 'Cash'} payment recorded. Awaiting admin confirmation.`,
        paymentMethod: method
      });
    }

    // Handle Card payment
    if (method === 'card') {
      console.log(`💳 Processing CARD payment for ${user.email}`);
      
      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: { 
                name: 'Prime Bond Registration',
                description: 'Member registration fee'
              },
              unit_amount: fixedAmount * 100
            },
            quantity: 1
          }],
          mode: 'payment',
          customer_email: user.email,
          success_url: `${process.env.BASE_URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.BASE_URL}/payment-cancel.html`,
          payment_method_options: { 
            card: { 
              request_three_d_secure: 'any' 
            } 
          },
          metadata: { 
            userId: user._id.toString(),
            paymentType: 'registration'
          }
        });

        const paymentRecord = new MemberPayment({
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
          paymentMethod: 'card',
          paymentType: 'registration',
          paymentUrl: session.url
        });

        await paymentRecord.save();

        await authDB.updateOne(
          { _id: userMongoId },
          {
            paymentStatus: 'pending',
            paymentMethod: 'card',
            transactionId: session.id,
            lastPaymentLink: session.url,
            cryptoCoin: null,
            updatedAt: new Date()
          }
        );

        return res.json({ 
          success: true, 
          sessionId: session.id, 
          url: session.url,
          paymentMethod: 'card'
        });

      } catch (stripeError) {
        console.error('❌ Stripe Error:', stripeError);
        return res.status(500).json({ 
          success: false,
          error: 'Failed to process card payment',
          details: stripeError.message
        });
      }
    }

    // Handle Crypto payment (NOWPayments)
    if (method === 'walletcrypto') {
      console.log(`🪙 Processing CRYPTO payment for ${user.email} in ${paymentCurrency}`);
      
      try {
        const invoiceRes = await fetch('https://api.nowpayments.io/v1/invoice', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.NOWPAYMENTS_API_KEY,
            'Content-Type': 'application/json'
          },
        body: JSON.stringify({
  price_amount: fixedAmount,               // This is the price in USD
  pay_amount: fixedAmount,                // This is the amount user will pay in crypto
  price_currency: 'usd',
  pay_currency: paymentCurrency,          // e.g., 'usdttrc20'
  order_description: 'Prime Bond Registration',
  ipn_callback_url: `${process.env.BASE_URL}/api/pay/callback`,
  success_url: `${process.env.BASE_URL}/dashboard.html`,
  cancel_url: `${process.env.BASE_URL}/payment-cancel.html`,
  customer_email: user.email
})

        });

        const invoiceData = await invoiceRes.json();

        if (!invoiceData.invoice_url || !invoiceData.id) {
          console.error('❌ NOWPayments Error:', invoiceData);
          return res.status(500).json({ 
            success: false,
            error: 'Failed to create payment invoice',
            details: invoiceData
          });
        }

        const paymentRecord = new MemberPayment({
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
          paymentMethod: 'walletcrypto',
          paymentType: 'registration',
          paymentUrl: invoiceData.invoice_url
        });

        await paymentRecord.save();

        await authDB.updateOne(
          { _id: userMongoId },
          {
            paymentStatus: 'pending',
            paymentMethod: 'walletcrypto',
            transactionId: invoiceData.id,
            lastPaymentLink: invoiceData.invoice_url,
            cryptoCoin: paymentCurrency,
            updatedAt: new Date()
          }
        );

        return res.json({
          success: true,
          message: 'Crypto payment invoice created successfully',
          transactionId: invoiceData.id,
          redirectURL: invoiceData.invoice_url,
          payAmount: fixedAmount,
          currency: paymentCurrency,
          paymentMethod: 'walletcrypto'
        });

      } catch (nowpaymentsError) {
        console.error('❌ NOWPayments Error:', nowpaymentsError);
        return res.status(500).json({ 
          success: false,
          error: 'Failed to process crypto payment',
          details: nowpaymentsError.message
        });
      }
    }

    // This should never be reached due to validation, but added as a safeguard
    return res.status(500).json({ 
      success: false,
      error: 'Unexpected payment method processing error' 
    });

  } catch (error) {
    console.error('❌ Payment Processing Error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to process payment',
      details: error.message
    });
  }
};

/**
 * @desc    Process investment payment
 * @route   POST /api/pay/investment
 * @access  Private
 */
const payInvestment = async (req, res) => {
  try {
    // Validate user authentication
    const userMongoId = req.user?._id;
    if (!userMongoId) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized: User not authenticated' 
      });
    }

    // Validate request body
    const { planId, amount, method, currency } = req.body;
    if (!planId || !amount) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: planId or amount' 
      });
    }

    // Find user and plan
    const user = await authDB.findById(userMongoId);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    const plan = await InvestmentPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({ 
        success: false,
        error: 'Investment plan not found' 
      });
    }

    // Validate amount against plan limits
    if (amount < plan.minAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `Minimum investment amount is $${plan.minAmount}` 
      });
    }

    if (plan.maxAmount && amount > plan.maxAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `Maximum investment amount is $${plan.maxAmount}` 
      });
    }

    // Create investment record
    const investment = new Investment({
      userId: userMongoId,
      planId,
      amount,
      nextPayoutDate: calculateNextPayoutDate(),
      totalPayouts: plan.durationMonths,
      status: 'pending',
      createdAt: new Date()
    });

    // Validate payment method
    const paymentMethod = method?.toLowerCase();
    if (!paymentMethod) {
      return res.status(400).json({ 
        success: false,
        error: 'Payment method is required' 
      });
    }

    const validMethods = ['bank', 'cash', 'card', 'walletcrypto'];
    if (!validMethods.includes(paymentMethod)) {
      return res.status(400).json({ 
        success: false,
        error: `Invalid payment method: ${paymentMethod}` 
      });
    }

    console.log('🔍 Investment Payment Initiated:', {
      user: user.email,
      plan: plan.name,
      method: paymentMethod,
      amount: amount
    });

    // Handle Bank or Cash payment
    if (['bank', 'cash'].includes(paymentMethod)) {
      console.log(`💰 Processing ${paymentMethod.toUpperCase()} investment for ${user.email}`);
      
      await investment.save();

      const paymentRecord = new MemberPayment({
        payment_reference: `${paymentMethod.toUpperCase()}-INV-${Date.now()}`,
        userId: user._id,
        amount: amount,
        currency: 'usd',
        customer: {
          name: user.name,
          email: user.email,
          phone: user.phone || 'N/A'
        },
        status: 'pending',
        paymentMethod: paymentMethod,
        paymentType: 'investment',
        investmentId: investment._id
      });

      await paymentRecord.save();

      return res.json({
        success: true,
        message: `${paymentMethod === 'bank' ? 'Bank transfer' : 'Cash'} investment recorded. Awaiting admin confirmation.`,
        paymentId: paymentRecord._id,
        investmentId: investment._id,
        paymentMethod: paymentMethod
      });
    }

    // Handle Card payment
    if (paymentMethod === 'card') {
      console.log(`💳 Processing CARD investment for ${user.email}`);
      
      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: { 
                name: `Prime Bond ${plan.name}`,
                description: `Investment plan (${plan.durationMonths} months)`
              },
              unit_amount: amount * 100
            },
            quantity: 1
          }],
          mode: 'payment',
          customer_email: user.email,
          success_url: `${process.env.BASE_URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.BASE_URL}/payment-cancel.html`,
          payment_method_options: { 
            card: { 
              request_three_d_secure: 'any' 
            } 
          },
          metadata: { 
            userId: user._id.toString(),
            planId: planId.toString(),
            investmentId: investment._id.toString(),
            paymentType: 'investment'
          }
        });

        await investment.save();

        const paymentRecord = new MemberPayment({
          payment_reference: session.id,
          userId: user._id,
          amount: amount,
          currency: 'usd',
          customer: {
            name: user.name,
            email: user.email,
            phone: user.phone || 'N/A'
          },
          status: 'pending',
          paymentMethod: 'card',
          paymentType: 'investment',
          investmentId: investment._id,
          paymentUrl: session.url
        });

        await paymentRecord.save();

        return res.json({ 
          success: true, 
          sessionId: session.id, 
          url: session.url,
          paymentMethod: 'card',
          investmentId: investment._id
        });

      } catch (stripeError) {
        console.error('❌ Stripe Error:', stripeError);
        return res.status(500).json({ 
          success: false,
          error: 'Failed to process card payment',
          details: stripeError.message
        });
      }
    }

    // Handle Crypto payment (NOWPayments)
    if (paymentMethod === 'walletcrypto') {
      console.log(`🪙 Processing CRYPTO investment for ${user.email} in ${currency || 'usdttrc20'}`);
      
      try {
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
            customer_email: user.email,
            order_id: `INV-${user._id}-${Date.now()}`
          })
        });

        const invoiceData = await invoiceRes.json();

        if (!invoiceData.invoice_url || !invoiceData.id) {
          console.error('❌ NOWPayments Error:', invoiceData);
          return res.status(500).json({ 
            success: false,
            error: 'Failed to create investment invoice',
            details: invoiceData
          });
        }

        await investment.save();

        const paymentRecord = new MemberPayment({
          payment_reference: invoiceData.id,
          userId: user._id,
          amount: amount,
          currency: currency || 'usdttrc20',
          customer: {
            name: user.name,
            email: user.email,
            phone: user.phone || 'N/A'
          },
          status: 'pending',
          paymentMethod: 'walletcrypto',
          paymentType: 'investment',
          investmentId: investment._id,
          paymentUrl: invoiceData.invoice_url
        });

        await paymentRecord.save();

        return res.json({
          success: true,
          message: 'Crypto investment invoice created successfully',
          transactionId: invoiceData.id,
          redirectURL: invoiceData.invoice_url,
          payAmount: amount,
          currency: currency || 'usdttrc20',
          paymentMethod: 'walletcrypto',
          investmentId: investment._id
        });

      } catch (nowpaymentsError) {
        console.error('❌ NOWPayments Error:', nowpaymentsError);
        return res.status(500).json({ 
          success: false,
          error: 'Failed to process crypto payment',
          details: nowpaymentsError.message
        });
      }
    }

  } catch (error) {
    console.error('❌ Investment Payment Error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to process investment payment',
      details: error.message
    });
  }
};

/**
 * @desc    Handle payment callback from payment providers
 * @route   POST /api/pay/callback
 * @access  Public (called by payment providers)
 */
const callback = async (req, res) => {
  try {
    const data = req.body;
    console.log('📥 Payment Callback Received:', {
      paymentId: data.invoice_id,
      status: data.payment_status,
      amount: data.price_amount,
      currency: data.pay_currency
    });

    // Only process successful payments
    if (data.payment_status !== 'success') {
      console.log('ℹ️ Ignoring non-successful payment callback');
      return res.status(200).send('IPN received - payment not successful');
    }

    const payment = await MemberPayment.findOneAndUpdate(
      { payment_reference: data.invoice_id },
      { 
        status: 'success',
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!payment) {
      console.error('❌ Payment record not found for callback');
      return res.status(404).send('Payment record not found');
    }

    const user = await authDB.findById(payment.userId);
    if (user) {
      if (!user.userId) {
        user.userId = await generateNextUserId();
      }

      user.paymentStatus = 'success';
      user.updatedAt = new Date();
      await user.save();

      if (payment.investmentId) {
        const investment = await Investment.findById(payment.investmentId);
        if (investment) {
          investment.status = 'active';
          investment.updatedAt = new Date();
          await investment.save();
        }
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

      console.log(`✅ Successfully processed payment for ${user.email}`);
    }

    res.status(200).send('IPN received and processed');

  } catch (error) {
    console.error('❌ IPN Callback Error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Callback processing failed',
      error: error.message
    });
  }
};

module.exports = { 
  payRegister, 
  payInvestment, 
  callback 
};
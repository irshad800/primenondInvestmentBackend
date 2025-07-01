const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');
const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const Roi = require('../models/Roi');
const Return = require('../models/Return');
const crypto = require('crypto');
const { generateAndSendReceipt, generateNextUserId } = require('../routes/paymentRoutes');
const { calculateReturnAmount, calculateNextPayoutDate } = require('../utils/calculateReturn');

/**
 * Helper function to encrypt data for CCAvenue
 */
function encryptCCAvenue(data, workingKey) {
  console.log('🔐 Encryption Input:', {
    dataLength: data.length,
    workingKeyExists: !!workingKey,
    workingKeyLength: workingKey?.length,
    workingKeySample: workingKey ? `${workingKey.substring(0, 3)}...${workingKey.substring(workingKey.length - 3)}` : 'undefined'
  });

  if (!workingKey) {
    console.error('❌ No working key provided');
    return undefined;
  }

  try {
    const key = Buffer.from(workingKey, 'hex');
    console.log('🔑 Key Buffer:', {
      length: key.length,
      content: key.toString('hex')
    });

    const iv = Buffer.alloc(16, 0);
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    console.log('🔒 Encryption Successful:', {
      outputLength: encrypted.length,
      outputSample: `${encrypted.substring(0, 10)}...`
    });
    
    return encrypted;
  } catch (err) {
    console.error('❌ Encryption Error:', err.message);
    console.error('Stack:', err.stack);
    return undefined;
  }
}

/**
 * Helper function to decrypt CCAvenue response
 */
function decryptCCAvenue(encryptedData, workingKey) {
  const key = Buffer.from(workingKey, 'hex');
  const iv = Buffer.alloc(16, 0);
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Helper function to format CCAvenue request data
 */
function formatCCAvenueRequest(params) {
  return Object.keys(params)
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');
}

/**
 * Validate CCAvenue environment variables
 */
function validateCCAvenueEnv() {
  const requiredVars = ['CCAVENUE_MERCHANT_ID', 'CCAVENUE_ACCESS_CODE', 'CCAVENUE_WORKING_KEY', 'BASE_URL'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  if (missingVars.length) {
    throw new Error(`Missing CCAvenue environment variables: ${missingVars.join(', ')}`);
  }
}

/**
 * @desc    Process registration payment
 * @route   POST /api/pay/register
 * @access  Private
 */
const testString = "test_encryption";
const encryptedTest = encryptCCAvenue(testString, process.env.CCAVENUE_WORKING_KEY);
console.log('Encryption Test:', {
  input: testString,
  encrypted: encryptedTest,
  decrypted: encryptedTest ? decryptCCAvenue(encryptedTest, process.env.CCAVENUE_WORKING_KEY) : 'failed'
});

if (!encryptedTest) {
  throw new Error('Encryption test failed - check working key');
}

const payRegister = async (req, res) => {
  try {
    const userMongoId = req.user?._id;
    if (!userMongoId) {
      console.error('🔒 Authentication Error: No user ID in request');
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized: User not authenticated' 
      });
    }

    const user = await authDB.findById(userMongoId);
    if (!user) {
      console.error(`🔍 User Not Found: ID ${userMongoId}`);
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    if (user.paymentStatus === 'success') {
      console.warn(`⚠️ Duplicate Payment Attempt: ${user.email}`);
      return res.status(400).json({
        success: false,
        message: 'You have already completed your registration payment.'
      });
    }

    const fixedAmount = 50.0; // Registration amount fixed at 50 AED
    const method = req.body.method?.trim().toLowerCase();
    const paymentCurrency = 'AED'; // Using AED for UAE

    console.log('💳 Payment Initiation:', {
      user: user.email,
      method: method,
      amount: fixedAmount,
      currency: paymentCurrency
    });

    if (!method) {
      console.error('🚫 Missing Payment Method');
      return res.status(400).json({ 
        success: false,
        error: 'Payment method is required' 
      });
    }

    const validMethods = ['bank', 'cash', 'card', 'walletcrypto'];
    if (!validMethods.includes(method)) {
      console.error(`🚫 Invalid Payment Method: ${method}`);
      return res.status(400).json({ 
        success: false,
        error: `Invalid payment method: ${method}` 
      });
    }

    if (['bank', 'cash'].includes(method)) {
      console.log(`💵 Processing ${method.toUpperCase()} payment for ${user.email}`);
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

      const paymentRecord = new MemberPayment({
        payment_reference: `${method.toUpperCase()}-REG-${Date.now()}`,
        userId: user._id,
        amount: fixedAmount,
        currency: paymentCurrency,
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
        paymentMethod: method,
        paymentId: paymentRecord._id
      });
    }

    if (['card', 'walletcrypto'].includes(method)) {
      console.log(`💳 Initiating ${method.toUpperCase()} payment for ${user.email}`);
      
      validateCCAvenueEnv();

      try {
        const paymentReference = `REG-${user._id}-${Date.now()}`;
        const ccavenueParams = {
          merchant_id: process.env.CCAVENUE_MERCHANT_ID,
          order_id: `REG-${user._id}-${Date.now()}`,
          currency: 'AED',
          amount: fixedAmount.toFixed(2),
          redirect_url: `${process.env.BASE_URL}/api/pay/callback`,
          cancel_url: `${process.env.BASE_URL}/payment-cancel.html`,
          billing_name: user.name || 'Customer',
          billing_email: user.email,
          billing_tel: user.phone || '0000000000',
          billing_address: user.street || 'Not Provided',
          billing_city: user.city || 'Dubai',
          billing_state: user.state || 'Dubai',
          billing_zip: user.postalCode || '00000',
          billing_country: user.country || 'UAE',
          language: 'EN',
          payment_option: method === 'card' ? 'CC' : 'WALLET'
        };

        const requestData = formatCCAvenueOrderRequest(ccavenueParams);
        const encRequest = encryptCCAvenue(requestData, process.env.CCAVENUE_WORKING_KEY);
        
        if (!encRequest) {
          return res.status(500).json({
            success: false,
            error: 'Failed to generate encrypted request'
          });
        }

        const paymentUrl = `https://secure.ccavenue.ae/transaction/transaction.do?command=initiateTransaction&encRequest=${encRequest}&access_code=${process.env.CCAVENUE_ACCESS_CODE}`;

        const paymentRecord = new MemberPayment({
          payment_reference: paymentReference,
          userId: user._id,
          amount: fixedAmount,
          currency: paymentCurrency,
          customer: {
            name: user.name,
            email: user.email,
            phone: user.phone || 'N/A'
          },
          status: 'pending',
          paymentMethod: method,
          paymentType: 'registration',
          paymentUrl: paymentUrl
        });

        await paymentRecord.save();
        await authDB.updateOne(
          { _id: userMongoId },
          {
            paymentStatus: 'pending',
            paymentMethod: method,
            transactionId: paymentReference,
            lastPaymentLink: paymentUrl,
            cryptoCoin: null,
            updatedAt: new Date()
          }
        );

        return res.json({ 
          success: true, 
          sessionId: paymentReference, 
          url: paymentUrl,
          paymentMethod: method
        });
      } catch (error) {
        console.error('❌ CCAvenue Payment Error:', error);
        return res.status(500).json({ 
          success: false,
          error: `Failed to initiate ${method} payment`,
          details: error.message
        });
      }
    }
  } catch (error) {
    console.error('❌ Payment Processing Error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to process payment',
      details: error.message
    });
  }
};

function validateWorkingKey(key) {
  if (!key || typeof key !== 'string' || key.length !== 32 || !/^[0-9A-F]+$/i.test(key)) {
    throw new Error(`Invalid working key format. Must be 32-character hex string. Got: ${key}`);
  }
}

validateWorkingKey(process.env.CCAVENUE_WORKING_KEY);

/**
 * @desc    Process investment payment
 * @access  Private
 */
const payInvestment = async (req, res) => {
  try {
    const userMongoId = req.user?._id;
    if (!userMongoId) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized: User not authenticated' 
      });
    }

    const user = await authDB.findById(userMongoId);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    if (user.paymentStatus !== 'success') {
      return res.status(403).json({
        success: false,
        message: 'Complete registration payment first'
      });
    }

    let { method } = req.body;

    if (!method) {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment method is required' 
      });
    }

    // Check if user has a successful investment payment
    const successfulInvestmentPayment = await MemberPayment.findOne({ userId: userMongoId, paymentType: 'investment', status: 'success' });
    if (successfulInvestmentPayment) {
      return res.status(400).json({ 
        success: false, 
        message: 'You have already completed an investment payment. No further payments are allowed.' 
      });
    }

    const pendingInvestment = await Investment.findOne({ userId: userMongoId, status: 'pending' });

    if (!pendingInvestment) {
      return res.status(404).json({ 
        success: false, 
        message: 'No pending investment found. Please select a plan first.' 
      });
    }

    const planId = pendingInvestment.planId;
    const amount = pendingInvestment.amount;

    const plan = await InvestmentPlan.findById(planId);
    if (!plan) {
      return res.status(404).json({ 
        success: false,
        error: 'Plan not found' 
      });
    }

    if (amount < plan.minAmount || (plan.maxAmount && amount > plan.maxAmount)) {
      return res.status(400).json({ 
        success: false, 
        message: `Amount must be between $${plan.minAmount} and $${plan.maxAmount || '∞'}` 
      });
    }

    const paymentMethod = method.toLowerCase();
    const validMethods = ['bank', 'cash', 'card', 'walletcrypto'];
    if (!validMethods.includes(paymentMethod)) {
      return res.status(400).json({ 
        success: false,
        error: `Invalid payment method` 
      });
    }

    const investment = pendingInvestment;
    investment.updatedAt = new Date();

    if (['bank', 'cash'].includes(paymentMethod)) {
      await investment.save();

      const paymentRecord = new MemberPayment({
        payment_reference: `${paymentMethod.toUpperCase()}-INV-${Date.now()}`,
        userId: user._id,
        amount: amount,
        currency: 'AED',
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
        message: `${paymentMethod} payment recorded`,
        paymentId: paymentRecord._id,
        investmentId: investment._id
      });
    }

    if (['card', 'walletcrypto'].includes(paymentMethod)) {
      validateCCAvenueEnv();

      try {
        const paymentReference = `INV-${user._id}-${Date.now()}`;
        const ccavenueParams = {
          merchant_id: process.env.CCAVENUE_MERCHANT_ID,
          access_code: process.env.CCAVENUE_ACCESS_CODE,
          order_id: `INV-${user._id}-${Date.now()}`,
          currency: 'AED',
          amount: amount.toFixed(2),
          redirect_url: `${process.env.BASE_URL}/api/pay/callback`,
          cancel_url: `${process.env.BASE_URL}/payment-cancel.html`,
          billing_name: user.name || 'Customer',
          billing_email: user.email,
          billing_tel: user.phone || '0000000000',
          billing_address: user.street || 'Not Provided',
          billing_city: user.city || 'Dubai',
          billing_state: user.state || 'Dubai',
          billing_zip: user.postalCode || '00000',
          billing_country: user.country || 'UAE',
          language: 'EN',
          payment_option: method === 'card' ? 'CC' : 'WALLET'
        };

        const requestData = formatCCAvenueRequest(ccavenueParams);
        const encRequest = encryptCCAvenue(requestData, process.env.CCAVENUE_WORKING_KEY);

        await investment.save();

        const paymentUrl = `https://secure.ccavenue.ae/transaction/transaction.do?command=initiateTransaction&encRequest=${encRequest}&access_code=${process.env.CCAVENUE_ACCESS_CODE}`;

        const paymentRecord = new MemberPayment({
          payment_reference: paymentReference,
          userId: user._id,
          amount: amount,
          currency: 'AED',
          customer: {
            name: user.name,
            email: user.email,
            phone: user.phone || 'N/A'
          },
          status: 'pending',
          paymentMethod: paymentMethod,
          paymentType: 'investment',
          investmentId: investment._id,
          paymentUrl: paymentUrl
        });

        await paymentRecord.save();
        return res.json({ 
          success: true, 
          sessionId: paymentReference, 
          url: paymentUrl,
          paymentMethod: paymentMethod,
          investmentId: investment._id
        });
      } catch (error) {
        console.error('❌ CCAvenue Payment Error:', error);
        return res.status(500).json({ 
          success: false,
          error: `Payment initiation failed`,
          details: error.message
        });
      }
    }
  } catch (error) {
    console.error('❌ Investment Payment Error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Payment processing failed',
      details: error.message
    });
  }
};

/**
 * @desc    Handle payment callback from CCAvenue
 * @route   POST /api/pay/callback
 * @access  Public
 */
const callback = async (req, res) => {
  try {
    const encResp = req.body.encResp;
    if (!encResp) {
      return res.status(400).json({ 
        success: false,
        message: 'Missing encrypted response' 
      });
    }

    validateCCAvenueEnv();
    const decryptedResponse = decryptCCAvenue(encResp, process.env.CCAVENUE_WORKING_KEY);
    const responseParams = new URLSearchParams(decryptedResponse);
    const responseData = Object.fromEntries(responseParams);

    const { order_id, order_status, amount, currency, payment_mode } = responseData;

    if (order_status !== 'Success') {
      return res.status(200).send('IPN received - payment not successful');
    }

    const payment = await MemberPayment.findOneAndUpdate(
      { payment_reference: order_id },
      { status: 'success', updatedAt: new Date() },
      { new: true }
    );

    if (!payment) {
      return res.status(404).send('Payment record not found');
    }

    const user = await authDB.findById(payment.userId);
    if (user) {
      if (!user.userId) {
        user.userId = await generateNextUserId();
      }
      user.paymentStatus = 'success';
      user.paymentMethod = payment.paymentMethod;
      user.transactionId = order_id;
      user.lastPaymentLink = null;
      user.cryptoCoin = null;
      user.updatedAt = new Date();
      await user.save();

      if (payment.investmentId) {
        const investment = await Investment.findById(payment.investmentId);
        if (investment) {
          investment.status = 'active';
          investment.nextPayoutDate = calculateNextPayoutDate(investment.payoutOption);
          investment.updatedAt = new Date();
          await investment.save();

          // Create ROI and Return records for investment
          try {
            const plan = await InvestmentPlan.findById(investment.planId);
            if (!plan) {
              console.error('❌ Plan not found for investment:', investment._id);
              throw new Error('Plan not found');
            }

            // Create ROI record using InvestmentPlan.returnRate
            const returnRate = plan.returnRate;
            const investmentAmount = investment.amount;
            const payoutOption = investment.payoutOption || 'monthly';

            const monthlyReturnAmount = payoutOption === 'monthly'
              ? (investmentAmount * returnRate) / 100
              : 0;

            const annualReturnAmount = payoutOption === 'monthly'
              ? monthlyReturnAmount * 12
              : (investmentAmount * returnRate) / 100;

            await Roi.findOneAndUpdate(
              { userId: user._id, investmentId: investment._id },
              {
                returnRate,
                monthlyReturnAmount,
                annualReturnAmount,
                updatedAt: new Date()
              },
              { upsert: true, new: true }
            );

            console.log(`📊 ROI saved: Rate = ${returnRate}%, Monthly = ${monthlyReturnAmount}, Annual = ${annualReturnAmount}`);

            console.log(`📈 ROI assigned: ${plan.returnRate}% for investment ${investment._id}`);

            // Create initial Return record
            const returnAmount = calculateReturnAmount(investment.amount, plan.returnRate);
            const nextPayoutDate = calculateNextPayoutDate(investment.payoutOption);
            await Return.create({
              userId: user._id,
              investmentId: investment._id,
              amount: returnAmount,
              payoutDate: nextPayoutDate,
              status: 'pending'
            });
            console.log(`💰 Return scheduled: $${returnAmount} for ${investment.payoutOption} payout`);
          } catch (error) {
            console.error('❌ ROI/Return Assignment Error:', error.message);
          }

          // Update auth_schema with specific plan details after successful investment payment
          user.selectedPlanId = '685274fe90dc45ccb6268f32'; // Hardcoded as requested
          user.selectedInvestmentAmount = 30000; // Hardcoded as requested
          user.selectedPlanName = 'Prime Bond Investment – Tier 5'; // Hardcoded as requested
          await user.save();
          console.log(`📝 Updated auth_schema for user ${user._id} with selectedPlanId: 685274fe90dc45ccb6268f32, selectedInvestmentAmount: 30000, selectedPlanName: Prime Bond Investment – Tier 5`);
        }
      }

      const orderDescription = payment.investmentId
        ? `Investment in ${(await InvestmentPlan.findById((await Investment.findById(payment.investmentId)).planId)).name}`
        : 'Registration Payment';
      await generateAndSendReceipt({
        payment_id: order_id,
        updated_at: new Date().toISOString(),
        price_amount: parseFloat(amount),
        pay_currency: currency,
        order_description: orderDescription,
        payment_status: 'success',
        payment_method: payment.paymentMethod.toUpperCase()
      }, user.email, user.name, {
        userId: user.userId,
        phone: user.phone,
        alternateContact: user.alternateContact,
        passportNumber: user.passportNumber,
        addressLine1: user.street || '-',
        addressLine2: `${user.city || ''}, ${user.state || ''}, ${user.postalCode || ''}, ${user.country || ''}`
      });
    }

    res.redirect(`${process.env.BASE_URL}/payment-success.html?order_id=${order_id}`);
  } catch (error) {
    console.error('❌ Callback Error:', error);
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
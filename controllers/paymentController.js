const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');
const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const crypto = require('crypto');
const { generateAndSendReceipt, generateNextUserId } = require('../routes/paymentRoutes');
const { calculateNextPayoutDate } = require('../utils/calculateReturn');

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
const key = Buffer.from(workingKey, 'hex'); // <-- FIXED
  const iv = Buffer.alloc(16, 0); // CCAvenue uses a zero IV
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

    const fixedAmount = 50.0;
    const method = req.body.method?.trim().toLowerCase();
    const paymentCurrency = 'inr';

    console.log('🔍 Payment Initiated (Live Mode):', {
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
      console.log(`💵 Processing ${method.toUpperCase()} payment for ${user.email} (Live Mode)`);
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
      console.log(`✅ ${method.toUpperCase()} Payment Recorded: ${paymentRecord.payment_reference}`);
      return res.json({
        success: true,
        message: `${method === 'bank' ? 'Bank transfer' : 'Cash'} payment recorded. Awaiting admin confirmation.`,
        paymentMethod: method,
        paymentId: paymentRecord._id
      });
    }

    if (['card', 'walletcrypto'].includes(method)) {
      console.log(`💳 Initiating ${method.toUpperCase()} payment for ${user.email} (Live Mode)`);
      console.log('🔍 CCAvenue Credentials (Live Mode):', {
        merchantId: process.env.CCAVENUE_MERCHANT_ID,
        accessCode: process.env.CCAVENUE_ACCESS_CODE,
        workingKey: process.env.CCAVENUE_WORKING_KEY.substring(0, 3) + '...' + process.env.CCAVENUE_WORKING_KEY.substring(process.env.CCAVENUE_WORKING_KEY.length - 3)
      });

      validateCCAvenueEnv();

      try {
        const paymentReference = `REG-${user._id}-${Date.now()}`;
        const ccavenueParams = {
          merchant_id: process.env.CCAVENUE_MERCHANT_ID,
          order_id: paymentReference,
          currency: paymentCurrency,
          amount: fixedAmount.toFixed(2),
          redirect_url: `${process.env.BASE_URL}/api/pay/callback`, // Ensure this is your live domain
          cancel_url: `${process.env.BASE_URL}/payment-cancel.html`, // Ensure this is your live domain
          billing_name: user.name || 'N/A',
          billing_email: user.email,
          billing_tel: user.phone || 'N/A',
          billing_address: user.street || 'N/A',
          billing_city: user.city || 'N/A',
          billing_state: user.state || 'N/A',
          billing_zip: user.postalCode || 'N/A',
          billing_country: user.country || 'India',
          language: 'EN',
          payment_option: method === 'card' ? 'CC' : 'WALLET'
        };

        console.log('🔍 CCAvenue Parameters (Live Mode):', ccavenueParams);
        const requestData = formatCCAvenueRequest(ccavenueParams);
        const encRequest = encryptCCAvenue(requestData, process.env.CCAVENUE_WORKING_KEY);
        console.log('🔍 Generated encRequest (Live Mode):', encRequest);
        if (!encRequest) {
          console.error('❌ encRequest is undefined');
          return res.status(500).json({
            success: false,
            error: 'Failed to generate encrypted request'
          });
        }

        const paymentUrl = `https://secure.ccavenue.com/transaction.do?command=initiateTransaction&encRequest=${encRequest}&access_code=${process.env.CCAVENUE_ACCESS_CODE}`;
        console.log('🔍 Constructed paymentUrl (Live Mode):', paymentUrl);

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

        try {
          await paymentRecord.save();
          console.log('🔍 Saved paymentRecord (Live Mode):', paymentRecord.toObject());
        } catch (saveError) {
          console.error('❌ Error saving paymentRecord:', saveError);
          return res.status(500).json({
            success: false,
            error: 'Failed to save payment record',
            details: saveError.message
          });
        }

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

        console.log(`✅ CCAvenue Payment URL Generated (Live Mode): ${paymentUrl}`);
        return res.json({ 
          success: true, 
          sessionId: paymentReference, 
          url: paymentUrl,
          paymentMethod: method
        });
      } catch (error) {
        console.error('❌ CCAvenue Payment Error (Live Mode):', error.message);
        return res.status(500).json({ 
          success: false,
          error: `Failed to initiate ${method} payment`,
          details: error.message
        });
      }
    }
  } catch (error) {
    console.error('❌ Payment Processing Error (Live Mode):', error.message);
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
      console.error('🔒 Authentication Error: No user ID in request');
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized: User not authenticated' 
      });
    }

    // Find user in database
    const user = await authDB.findById(userMongoId);
    if (!user) {
      console.error(`🔍 User Not Found: ID ${userMongoId}`);
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    // Check if registration payment is completed
    if (user.paymentStatus !== 'success') {
      console.warn(`⚠️ Registration Payment Incomplete: ${user.email}`);
      return res.status(403).json({
        success: false,
        message: 'Registration payment must be completed before making an investment payment.'
      });
    }

    // Validate request body
    const { planId, amount, method, currency } = req.body;
    if (!planId || !amount || !method) {
      console.error('🚫 Missing Required Fields:', { planId, amount, method });
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: planId, amount, or method' 
      });
    }

    // Find plan
    const plan = await InvestmentPlan.findById(planId);
    if (!plan) {
      console.error(`🔍 Investment Plan Not Found: ID ${planId}`);
      return res.status(404).json({ 
        success: false,
        error: 'Investment plan not found' 
      });
    }

    // Validate amount against plan limits
    if (amount < plan.minAmount) {
      console.error(`🚫 Amount Below Minimum: ${amount} < ${plan.minAmount}`);
      return res.status(400).json({ 
        success: false, 
        message: `Minimum investment amount is $${plan.minAmount}` 
      });
    }

    if (plan.maxAmount && amount > plan.maxAmount) {
      console.error(`🚫 Amount Above Maximum: ${amount} > ${plan.maxAmount}`);
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
    const paymentMethod = method.toLowerCase();
    const validMethods = ['bank', 'cash', 'card', 'walletcrypto'];
    if (!validMethods.includes(paymentMethod)) {
      console.error(`🚫 Invalid Payment Method: ${paymentMethod}`);
      return res.status(400).json({ 
        success: false,
        error: `Invalid payment method: ${paymentMethod}` 
      });
    }

    console.log('🔍 Investment Payment Initiated:', {
      user: user.email,
      plan: plan.name,
      method: paymentMethod,
      amount: amount,
      currency: currency || 'INR'
    });

    // Handle Bank or Cash payment
    if (['bank', 'cash'].includes(paymentMethod)) {
      console.log(`💰 Processing ${paymentMethod.toUpperCase()} investment for ${user.email}`);
      
      await investment.save();

      const paymentRecord = new MemberPayment({
        payment_reference: `${paymentMethod.toUpperCase()}-INV-${Date.now()}`,
        userId: user._id,
        amount: amount,
        currency: 'INR',
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

      console.log(`✅ ${paymentMethod.toUpperCase()} Investment Recorded: ${paymentRecord.payment_reference}`);
      return res.json({
        success: true,
        message: `${paymentMethod === 'bank' ? 'Bank transfer' : 'Cash'} investment recorded. Awaiting admin confirmation.`,
        paymentId: paymentRecord._id,
        investmentId: investment._id,
        paymentMethod: paymentMethod
      });
    }

    // Handle Card or Wallet payment (CCAvenue)
    if (['card', 'walletcrypto'].includes(paymentMethod)) {
      console.log(`💳 Initiating ${paymentMethod.toUpperCase()} investment for ${user.email}`);
      
      // Validate CCAvenue environment variables
      validateCCAvenueEnv();

      try {
        const paymentReference = `INV-${user._id}-${Date.now()}`;
        const ccavenueParams = {
          merchant_id: process.env.CCAVENUE_MERCHANT_ID,
          order_id: paymentReference,
          currency: 'INR',
          amount: amount.toFixed(2),
          redirect_url: `${process.env.BASE_URL}/api/pay/callback`,
          cancel_url: `${process.env.BASE_URL}/payment-cancel.html`,
          billing_name: user.name || 'N/A',
          billing_email: user.email,
          billing_tel: user.phone || 'N/A',
          billing_address: user.street || 'N/A',
          billing_city: user.city || 'N/A',
          billing_state: user.state || 'N/A',
          billing_zip: user.postalCode || 'N/A',
          billing_country: user.country || 'India',
          language: 'EN',
          payment_option: paymentMethod === 'card' ? 'CC' : 'WALLET'
        };

        // Encrypt request data
        const requestData = formatCCAvenueRequest(ccavenueParams);
        const encRequest = encryptCCAvenue(requestData, process.env.CCAVENUE_WORKING_KEY);

        await investment.save();

        const paymentRecord = new MemberPayment({
          payment_reference: paymentReference,
          userId: user._id,
          amount: amount,
          currency: 'INR',
          customer: {
            name: user.name,
            email: user.email,
            phone: user.phone || 'N/A'
          },
          status: 'pending',
          paymentMethod: paymentMethod,
          paymentType: 'investment',
          investmentId: investment._id,
          paymentUrl: `https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction&encRequest=${encRequest}&access_code=${process.env.CCAVENUE_ACCESS_CODE}`
        });

        await paymentRecord.save();

        console.log(`✅ CCAvenue Payment URL Generated: ${paymentRecord.paymentUrl}`);
        return res.json({ 
          success: true, 
          sessionId: paymentReference, 
          url: paymentRecord.paymentUrl,
          paymentMethod: paymentMethod,
          investmentId: investment._id
        });

      } catch (error) {
        console.error('❌ CCAvenue Payment Error:', error.message);
        return res.status(500).json({ 
          success: false,
          error: `Failed to initiate ${paymentMethod} payment`,
          details: error.message
        });
      }
    }

  } catch (error) {
    console.error('❌ Investment Payment Error:', error.message);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to process investment payment',
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
      console.error('🚫 Missing encResp in CCAvenue Callback');
      return res.status(400).json({ 
        success: false,
        message: 'Missing encrypted response'
      });
    }

    console.log('📥 CCAvenue Callback Received:', { encResp });



    validateCCAvenueEnv();



    // Decrypt response
    const decryptedResponse = decryptCCAvenue(encResp, process.env.CCAVENUE_WORKING_KEY);
    const responseParams = new URLSearchParams(decryptedResponse);
    const responseData = Object.fromEntries(responseParams);

    const { order_id, order_status, amount, currency, payment_mode } = responseData;

    console.log('📥 Payment Callback Data:', {
      paymentId: order_id,
      status: order_status,
      amount: parseFloat(amount),
      currency,
      paymentMode: payment_mode
    });

    // Only process successful payments
    if (order_status !== 'Success') {
      console.log(`ℹ️ Non-Successful Payment Callback: ${order_status}`);
      return res.status(200).send('IPN received - payment not successful');
    }

    const payment = await MemberPayment.findOneAndUpdate(
      { payment_reference: order_id },
      { 
        status: 'success',
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!payment) {
      console.error(`❌ Payment Record Not Found: ${order_id}`);
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
          investment.updatedAt = new Date();
          await investment.save();
        }
      }

      const orderDescription = payment.investmentId
        ? `Prime Bond ${(await InvestmentPlan.findById((await Investment.findById(payment.investmentId)).planId)).name} Investment`
        : 'Prime Bond Registration';

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

      console.log(`✅ Payment Processed Successfully for ${user.email}: ${order_id}`);
    }

    res.redirect(`${process.env.BASE_URL}/payment-success.html?order_id=${order_id}`);

  } catch (error) {
    console.error('❌ CCAvenue Callback Error:', error.message);
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
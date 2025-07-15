const express = require('express');
const router = express.Router();
const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');
const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const Roi = require('../models/Roi');
const Return = require('../models/Return');
const crypto = require('crypto');
const qs = require('querystring');
const { generateAndSendReceipt, generateNextUserId } = require('../utils/paymentUtils');
const { calculateReturnAmount, calculateNextPayoutDate } = require('../utils/calculateReturn');

/**
 * CCAvenue Encryption and Decryption
 */
function encrypt(plainText, workingKey) {
    if (!workingKey) {
        console.error('❌ No working key provided');
        return undefined;
    }

    try {
        const m = crypto.createHash('md5');
        m.update(workingKey);
        const key = Buffer.from(m.digest('latin1'), 'latin1');
        const iv = Buffer.from('\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f', 'binary');
        const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
        let encoded = cipher.update(plainText, 'utf8', 'hex');
        encoded += cipher.final('hex');
        return encoded;
    } catch (err) {
        console.error('❌ Encryption Error:', err.message);
        return undefined;
    }
}

function decrypt(encText, workingKey) {
    try {
        const m = crypto.createHash('md5');
        m.update(workingKey);
        const key = Buffer.from(m.digest('latin1'), 'latin1');
        const iv = Buffer.from('\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f', 'binary');
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        let decoded = decipher.update(encText, 'hex', 'utf8');
        decoded += decipher.final('utf8');
        return decoded;
    } catch (err) {
        console.error('❌ Decryption Error:', err.message);
        return undefined;
    }
}

/**
 * Helper functions
 */
function formatCCAvenueRequest(params) {
    return Object.keys(params)
        .map(key => `${key}=${encodeURIComponent(params[key])}`)
        .join('&');
}

function validateCCAvenueEnv() {
    const requiredVars = ['CCAVENUE_MERCHANT_ID', 'CCAVENUE_ACCESS_CODE', 'CCAVENUE_WORKING_KEY', 'BASE_URL'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    if (missingVars.length) {
        throw new Error(`Missing CCAvenue environment variables: ${missingVars.join(', ')}`);
    }
}

function validateWorkingKey(key) {
    if (!key || typeof key !== 'string' || key.length !== 32 || !/^[0-9A-F]+$/i.test(key)) {
        throw new Error(`Invalid working key format. Must be 32-character hex string. Got: ${key}`);
    }
}

/**
 * Payment Controller Functions
 */

const payRegister = async (req, res) => {
    try {
        const userMongoId = req.user?._id;
        if (!userMongoId) {
            return res.status(401).json({ success: false, error: 'Unauthorized: User not authenticated' });
        }

        const user = await authDB.findById(userMongoId).select('+kycApproved');
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        if (user.paymentStatus === 'success') {
            return res.status(400).json({ success: false, message: 'You have already completed your registration payment.' });
        }

        if (user.isPartiallyRegistered) {
            return res.status(403).json({ success: false, message: 'Complete profile registration before payment.' });
        }

        if (!user.userId) {
            const newUserId = await generateNextUserId();
            await authDB.findByIdAndUpdate(userMongoId, { userId: newUserId }, { new: true });
            console.log(`Assigned new userId: ${newUserId} to user ${userMongoId}`);
        }

        const fixedAmount = 10.0;
        const method = req.body.method?.trim().toLowerCase();
        const paymentCurrency = 'AED';
        const currentTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' });

        if (!method) {
            return res.status(400).json({ success: false, error: 'Payment method is required' });
        }

        const validMethods = ['bank', 'cash', 'card', 'walletcrypto'];
        if (!validMethods.includes(method)) {
            return res.status(400).json({ success: false, error: `Invalid payment method: ${method}` });
        }   

        if (['bank', 'cash'].includes(method)) {
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
                customer: { name: user.name, email: user.email, phone: user.phone || 'N/A' },
                status: 'pending',
                paymentMethod: method,
                paymentType: 'registration',
                createdAt: new Date()
            });

            await paymentRecord.save();
            return res.json({
                success: true,
                message: `${method === 'bank' ? 'Bank transfer' : 'Cash'} payment recorded at ${currentTime}. Awaiting admin approval.`
            });
        }

        if (['card', 'walletcrypto'].includes(method)) {
            validateCCAvenueEnv();

            try {
                const paymentReference = `REG-${Date.now()}`;
                if (paymentReference.length > 30) {
                    return res.status(400).json({ success: false, error: 'Generated order ID is too long' });
                }

                const ccavenueParams = {
                    merchant_id: process.env.CCAVENUE_MERCHANT_ID,
                    order_id: paymentReference,
                    currency: 'AED',
                    amount: fixedAmount.toFixed(2),
                    redirect_url: `${process.env.BASE_URL}/api/pay/callback`,
                    cancel_url: `${process.env.CCA_CANCEL_URL}`,
                    billing_name: user.name || 'Customer',
                    billing_email: user.email || 'no-reply@example.com',
                    billing_tel: user.phone || '0000000000',
                    billing_address: user.street || 'Not Provided',
                    billing_city: user.city || 'Dubai',
                    billing_state: user.state || 'Dubai',
                    billing_zip: user.postalCode || '00000',
                    billing_country: user.country || 'UAE',
                    delivery_name: user.name || 'Customer',
                    delivery_address: user.street || 'Not Provided',
                    delivery_city: user.city || 'Dubai',
                    delivery_state: user.state || 'Dubai',
                    delivery_zip: user.postalCode || '00000',
                    delivery_country: user.country || 'UAE',
                    language: 'EN',
                    integration_type: 'iframe_normal'
                };

                console.log(`Initiating payment at ${currentTime}`, ccavenueParams);

                const requestData = formatCCAvenueRequest(ccavenueParams);
                const encRequest = encrypt(requestData, process.env.CCAVENUE_WORKING_KEY);

                if (!encRequest) {
                    return res.status(500).json({ success: false, error: 'Failed to generate encrypted request' });
                }

                const paymentRecord = new MemberPayment({
                    payment_reference: paymentReference,
                    userId: user._id,
                    amount: fixedAmount,
                    currency: paymentCurrency,
                    customer: { name: user.name, email: user.email || 'no-reply@example.com', phone: user.phone || 'N/A' },
                    status: 'pending',
                    paymentMethod: method,
                    paymentType: 'registration',
                    createdAt: new Date()
                });

                await paymentRecord.save();

                await authDB.updateOne(
                    { _id: userMongoId },
                    {
                        paymentStatus: 'pending',
                        paymentMethod: method,
                        transactionId: paymentReference,
                        lastPaymentLink: null,
                        cryptoCoin: null,
                        updatedAt: new Date()
                    }
                );

                const iframeSrc = `https://secure.ccavenue.ae/transaction/transaction.do?command=initiateTransaction&merchant_id=${process.env.CCAVENUE_MERCHANT_ID}&encRequest=${encRequest}&access_code=${process.env.CCAVENUE_ACCESS_CODE}`;
                return res.json({ success: true, url: iframeSrc });
            } catch (error) {
                console.error(`❌ CCAvenue Payment Error at ${currentTime}:`, error);
                return res.status(500).json({ success: false, error: `Failed to initiate ${method} payment`, details: error.message });
            }
        }
    } catch (error) {
        console.error(`❌ Payment Processing Error at ${currentTime}:`, error);
        return res.status(500).json({ success: false, error: 'Failed to process payment', details: error.message });
    }
};

const payInvestment = async (req, res) => {
    try {
        const userMongoId = req.user?._id;
        if (!userMongoId) {
            return res.status(401).json({ 
                success: false,
                error: 'Unauthorized: User not authenticated' 
            });
        }

        const user = await authDB.findById(userMongoId).select('+kycApproved');
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

        const successfulInvestmentPayment = await MemberPayment.findOne({ 
            userId: userMongoId, 
            paymentType: 'investment', 
            status: 'success' 
        });
        
        if (successfulInvestmentPayment) {
            return res.status(400).json({ 
                success: false, 
                message: 'You have already completed an investment payment.' 
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
                const paymentReference = `INV-${Date.now()}`;
                const ccavenueParams = {
                    merchant_id: process.env.CCAVENUE_MERCHANT_ID,
                    order_id: paymentReference,
                    currency: 'AED',
                    amount: amount.toFixed(2),
                    redirect_url: `${process.env.BASE_URL}/api/pay/callback`,
                    cancel_url: `${process.env.CCA_CANCEL_URL}`,
                    billing_name: user.name || 'Customer',
                    billing_email: user.email,
                    billing_tel: user.phone || '0000000000',
                    billing_address: user.street || 'Not Provided',
                    billing_city: user.city || 'Dubai',
                    billing_state: user.state || 'Dubai',
                    billing_zip: user.postalCode || '00000',
                    billing_country: user.country || 'UAE',
                    delivery_name: user.name || 'Customer',
                    delivery_address: user.street || 'Not Provided',
                    delivery_city: user.city || 'Dubai',
                    delivery_state: user.state || 'Dubai',
                    delivery_zip: user.postalCode || '00000',
                    delivery_country: user.country || 'UAE',
                    language: 'EN',
                    integration_type: 'iframe_normal'
                };

                const requestData = formatCCAvenueRequest(ccavenueParams);
                const encRequest = encrypt(requestData, process.env.CCAVENUE_WORKING_KEY);

                await investment.save();

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
                    investmentId: investment._id
                });

                await paymentRecord.save();

                const iframeSrc = `https://secure.ccavenue.ae/transaction/transaction.do?command=initiateTransaction&merchant_id=${process.env.CCAVENUE_MERCHANT_ID}&encRequest=${encRequest}&access_code=${process.env.CCAVENUE_ACCESS_CODE}`;

                return res.json({ success: true, url: iframeSrc });
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

const callback = async (req, res) => {
    try {
        console.log('Payment callback received', req.body, req.query);
        const encResp = req.body.encResp || req.query.encResp;

        if (!encResp) {
            console.error('No encResp received', req.body, req.query);
            return res.redirect(`${process.env.FRONTEND_URL}/payment-failed.html?reason=no_response`);
        }

        console.log('Using working key:', process.env.CCAVENUE_WORKING_KEY);

        const decryptedResponse = decrypt(encResp, process.env.CCAVENUE_WORKING_KEY);
        if (!decryptedResponse) {
            console.error('Decryption failed - Check working key or encResp', encResp);
            return res.redirect(`${process.env.FRONTEND_URL}/payment-failed.html?reason=decrypt_failed`);
        }

        console.log('Decrypted response:', decryptedResponse);

        const responseData = qs.parse(decryptedResponse);
        console.log('🔍 Full CCAvenue response fields:');
        for (const key in responseData) {
            console.log(`${key}: ${responseData[key]}`);
        }

        console.log('Parsed response with order_status:', responseData.order_status);

        const status = (responseData.order_status || '').toLowerCase();
        const orderId = responseData.order_id || 'unknown';
        const trackingId = responseData.tracking_id || 'none';
        const message = responseData.failure_message || responseData.status_message || 'No detailed failure message provided';

        console.log('Order status:', status, 'Message:', message, 'Order ID:', orderId);

        await processPaymentAsync(responseData);

        if (status === 'success') {
            return res.redirect(
                `http://127.0.0.1:5502/payment-success.html` +
                `?order_id=${orderId}` +
                `&tracking_id=${trackingId}`
            );
        } else {
            console.log('Failure details:', { status, message, orderId, fullResponse: responseData });
            return res.redirect(
                `${process.env.FRONTEND_URL}/payment-failed.html` +
                `?order_id=${orderId}` +
                `&reason=${encodeURIComponent(status)}` +
                `&message=${encodeURIComponent(message)}`
            );
        }
    } catch (error) {
        console.error('Callback error:', error.stack);
        return res.redirect(`${process.env.FRONTEND_URL}/payment-failed.html?reason=exception`);
    }
};

async function processPaymentAsync(responseData) {
    try {
        const { order_id, order_status, tracking_id } = responseData;

        console.log('Updating payment for order_id:', order_id, 'with status:', order_status);
        const payment = await MemberPayment.findOneAndUpdate(
            { payment_reference: order_id },
            {
                status: order_status === 'Success' ? 'success' : 'failed',
                transactionId: tracking_id,
                updatedAt: new Date()
            },
            { new: true }
        );

        if (!payment) {
            console.error('Payment record not found for order_id:', order_id);
            return;
        }

        console.log('Updated payment record:', payment);

        if (payment.paymentType === 'registration') {
            await authDB.findByIdAndUpdate(payment.userId, {
                paymentStatus: order_status === 'Success' ? 'success' : 'pending',
                transactionId: tracking_id,
                updatedAt: new Date()
            });
            console.log('Updated authDB for user:', payment.userId);
        }

        if (payment.paymentType === 'investment' && order_status === 'Success') {
            await Investment.findByIdAndUpdate(payment.investmentId, {
                status: 'active',
                updatedAt: new Date()
            });

            await authDB.findByIdAndUpdate(payment.userId, {
                transactionId: tracking_id,
                updatedAt: new Date()
            });
            console.log('Updated Investment and authDB for investmentId:', payment.investmentId);

            const investment = await Investment.findById(payment.investmentId).populate('planId');
            if (!investment || !investment.planId) {
                console.error('Investment or planId not found for investmentId:', payment.investmentId, 'investment:', investment);
                return;
            }
            console.log('Fetched investment with planId:', investment);

            let roi = await Roi.findOne({ investmentId: payment.investmentId, userId: payment.userId });
            const monthlyReturn = calculateReturnAmount(investment.amount, investment.planId.returnRate, 'monthly') || 0;
            const annualReturn = calculateReturnAmount(investment.amount, investment.planId.annualReturnRate, 'annually') || 0;

            console.log(`Calculated returns: monthlyReturn=${monthlyReturn}, annualReturn=${annualReturn}`);

            if (!roi) {
                roi = new Roi({
                    userId: payment.userId,
                    investmentId: payment.investmentId,
                    returnRate: investment.planId.returnRate || 0,
                    monthlyReturnAmount: monthlyReturn,
                    annualReturnAmount: annualReturn,
                    totalRoiPaid: 0,
                    payoutsMade: 0,
                    lastPayoutDate: null,
                    assignedAt: new Date()
                });
                await roi.save();
                console.log('Initialized Roi record:', roi);
            } else {
                roi.monthlyReturnAmount = monthlyReturn;
                roi.annualReturnAmount = annualReturn;
                roi.updatedAt = new Date();
                await roi.save();
                console.log('Updated Roi record:', roi);
            }

            const startDate = investment.startDate || new Date();
            let payoutDate = calculateNextPayoutDate(investment.payoutOption, startDate);
            const totalPayouts = investment.totalPayouts || investment.planId.durationMonths;
            const returnAmount = calculateReturnAmount(
                investment.amount,
                investment.payoutOption === 'monthly' ? investment.planId.returnRate : investment.planId.annualReturnRate,
                investment.payoutOption
            ) || 0;

            console.log(`Calculated returnAmount for ${investment.payoutOption} payout: ${returnAmount}`);

            // Clear existing Return records to avoid duplicates
            await Return.deleteMany({ investmentId: payment.investmentId, status: 'pending' });

            for (let i = 0; i < totalPayouts; i++) {
                const returnRecord = new Return({
                    userId: payment.userId,
                    investmentId: payment.investmentId,
                    amount: returnAmount,
                    payoutDate: payoutDate,
                    status: 'pending'
                });
                await returnRecord.save();
                console.log(`Created Return record for payoutDate: ${payoutDate}, amount: ${returnAmount}`);
                payoutDate = calculateNextPayoutDate(investment.payoutOption, payoutDate);
            }

            await Investment.findByIdAndUpdate(payment.investmentId, {
                nextPayoutDate: calculateNextPayoutDate(investment.payoutOption, startDate)
            });

            const user = await authDB.findById(payment.userId).select('userId phone alternateContact passportNumber street city state postalCode country email name');
            if (user) {
                const paymentData = {
                    payment_id: payment.payment_reference,
                    updated_at: payment.updatedAt,
                    price_amount: payment.amount,
                    pay_currency: payment.currency,
                    payment_status: payment.status,
                    payment_method: payment.paymentMethod,
                    paymentType: payment.paymentType,
                    investmentDetails: {
                        planName: investment.planId.name || 'N/A',
                        amount: investment.amount || 0,
                        payoutOption: investment.payoutOption || 'N/A',
                        durationMonths: investment.totalPayouts || 0
                    },
                    roiDetails: {
                        monthlyReturn: Number(roi.monthlyReturnAmount || 0).toFixed(2),
                        annualReturn: Number(roi.annualReturnAmount || 0).toFixed(2)
                    }
                };
                console.log('Payment data for receipt:', paymentData);
                const userInfo = {
                    userId: user.userId || "N/A",
                    phonene: user.name || 'Customer',
                    email: user.email || 'no-reply@example.com',
                    phone: user.phone || '0000000000',
                    street: user.street || 'Not Provided',
                    city: user.city || 'Dubai',
                    state: user.state || 'Dubai',
                    postalCode: user.postalCode || '00000',
                    country: user.country || 'UAE'
                };
                await generateAndSendReceipt(paymentData, user.email, user.name, userInfo);
                console.log('Receipt sent for order_id:', order_id, 'with userId:', user.userId);
            } else {
                console.error('User not found for payment:', payment.userId);
            }
        }

        if (order_status === 'Success' && payment.paymentType === 'registration') {
            const user = await authDB.findById(payment.userId).select('userId phone alternateContact passportNumber street city state postalCode country email name');
            if (user) {
                const paymentData = {
                    payment_id: payment.payment_reference,
                    updated_at: payment.updatedAt,
                    price_amount: payment.amount,
                    pay_currency: payment.currency,
                    payment_status: payment.status,
                    payment_method: payment.paymentMethod,
                    paymentType: payment.paymentType
                };
                const userInfo = {
                    userId: user.userId || "N/A",
                    phone: user.phone || "N/A",
                    alternateContact: user.alternateContact || "N/A",
                    passportNumber: user.passportNumber || "N/A",
                    addressLine1: user.street || "N/A",
                    addressLine2: `${user.city || ''}, ${user.state || ''}, ${user.postalCode || ''}, ${user.country || ''}`
                };
                await generateAndSendReceipt(paymentData, user.email, user.name, userInfo);
                console.log('Receipt sent for order_id:', order_id, 'with userId:', user.userId);
            } else {
                console.error('User not found for payment:', payment.userId);
            }
        }
    } catch (err) {
        console.error('Background processing error:', err);
    }
}

module.exports = { 
    router,
    payRegister, 
    payInvestment, 
    callback 
};
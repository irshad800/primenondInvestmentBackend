const express = require('express');
const router = express.Router();
const { payRegister, payInvestment, callback } = require('../controllers/paymentController');
const { ensureAuth } = require('../middleware/authMiddleware');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_ID,
    pass: process.env.EMAIL_APP_PASSWORD
  }
});

async function generateNextUserId() {
  const lastUser = await authDB.findOne().sort({ userId: -1 });
  let nextId = 'PRB00001';
  if (lastUser && lastUser.userId) {
    const lastIdNumber = parseInt(lastUser.userId.replace('PRB', ''), 10);
    nextId = `PRB${(lastIdNumber + 1).toString().padStart(5, '0')}`;
  }
  return nextId;
}

async function generateAndSendReceipt(data, toEmail, name, userDetails) {
  try {
    const doc = new PDFDocument({ margin: 50 });
    const filePath = path.join(__dirname, `../receipts/receipt-${data.payment_id}.pdf`);
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    doc.image(path.join(__dirname, '../assets/images/Wish.JPG'), 50, 50, { width: 100 });
    doc.image(path.join(__dirname, '../assets/images/paid_seal.png'), 400, 50, { width: 100 });

    doc.fontSize(20).text('Prime Bond Investment Platform', { align: 'center' });
    doc.moveDown();
    doc.fontSize(16).text('Payment Receipt', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Receipt Number: ${data.payment_id}`);
    doc.text(`Date: ${new Date(data.updated_at).toLocaleDateString()}`);
    doc.text(`Customer Name: ${name}`);
    doc.text(`Email: ${toEmail}`);
    doc.text(`User ID: ${userDetails.userId || 'Pending'}`);
    doc.text(`Phone: ${userDetails.phone || 'N/A'}`);
    doc.text(`Alternate Contact: ${userDetails.alternateContact || 'N/A'}`);
    doc.text(`Passport Number: ${userDetails.passportNumber || 'N/A'}`);
    doc.text(`Address: ${userDetails.addressLine1}, ${userDetails.addressLine2}`);
    doc.moveDown();

    doc.text(`Description: ${data.order_description}`);
    doc.text(`Amount: ${data.price_amount} ${data.pay_currency.toUpperCase()}`);
    doc.text(`Payment Method: ${data.payment_method}`);
    doc.text(`Status: ${data.payment_status.charAt(0).toUpperCase() + data.payment_status.slice(1)}`);
    doc.moveDown();

    doc.text('Thank you for your payment!', { align: 'center' });
    doc.text('Prime Bond Team', { align: 'center' });

    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const mailOptions = {
      from: `"Prime Bond" <${process.env.EMAIL_ID}>`,
      to: toEmail,
      subject: `Payment Receipt - ${data.payment_id}`,
      text: `Dear ${name},\n\nPlease find attached your payment receipt.\n\nBest regards,\nPrime Bond Team`,
      attachments: [
        {
          filename: `receipt-${data.payment_id}.pdf`,
          path: filePath
        }
      ]
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Receipt sent to ${toEmail} for payment ${data.payment_id}`);
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error('❌ Receipt Generation Error:', error);
    throw error;
  }
}

// Pay registration fee ($50)
router.post('/register', ensureAuth, payRegister);

// Pay investment amount
router.post('/investment', ensureAuth, payInvestment);

// Payment callback (NOWPayments)
router.post('/callback', callback);

module.exports = {
  router,
  generateNextUserId,
  generateAndSendReceipt
};
const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');
const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const { payRegister, payInvestment, callback } = require('../controllers/paymentController');
const { ensureAuth } = require('../middleware/authMiddleware');

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
  const prefix = 'PRB';
  let lastId = 1;

  const lastUser = await authDB
    .find({ userId: { $regex: `^${prefix}\\d{5}$` } })
    .sort({ userId: -1 })
    .limit(1);

  if (lastUser.length > 0 && lastUser[0].userId) {
    const lastNumeric = parseInt(lastUser[0].userId.replace(prefix, ''), 10);
    lastId = lastNumeric + 1;
  }

  let newUserId;
  let exists = true;

  while (exists) {
    newUserId = `${prefix}${String(lastId).padStart(5, '0')}`;
    exists = await authDB.exists({ userId: newUserId });
    if (exists) lastId++;
  }

  return newUserId;
}


async function generateAndSendReceipt(data, userEmail, userName, userInfo = {}) {
  try {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const receiptsDir = path.join(__dirname, "../receipts");
    if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir);
    const filePath = path.join(receiptsDir, `receipt-${data.payment_id}.pdf`);
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    const logoPath = path.join(__dirname, '../assets/images/baclogo.png');
    const paidSealPath = path.join(__dirname, '../assets/images/image.png');

    const primaryColor = "#F37021";  // Orange (Logo Color)
    const darkColor = "#333333";     // Dark gray
    const lightGray = "#f9f9f9";

    const leftX = 50;
    const tableX1 = 65;
    const tableX2 = 230;
    const tableWidth = 480;
    const rowHeight = 20;

    // Header Logo
// Centered Logo
if (fs.existsSync(logoPath)) {
  const logoWidth = 80;
  const pageWidth = doc.page.width;
  const centerX = (pageWidth - logoWidth) / 2;
  doc.image(logoPath, centerX, 40, { width: logoWidth });
}

doc.moveDown(5); // Add more spacing between logo and content

// Title & Contact Info
doc.fontSize(16).fillColor(primaryColor).font("Helvetica-Bold")
  .text("PRIME BOND", { align: "center" });

doc.moveDown(0.5);
doc.fontSize(9).font("Helvetica").fillColor("#000")
  .text("4004/4005, 40th Floor, Citadel Tower, Al Marasi Drive Business Bay, Dubai- U.A.E.", { align: "center" })
  .text("Email: primebond@primewish.ae | Phone: +971-508009426, +97142597167", { align: "center" });


    doc.moveDown(4);
    doc.fontSize(13).fillColor(primaryColor).font("Helvetica-Bold")
      .text("INVESTMENT PAYMENT RECEIPT", { align: "center", underline: true });

    // Receipt No & Date
    const receiptNo = `PB-${(data.payment_id || "XXXXXXX").slice(-8).toUpperCase()}`;
    const issueDate = new Date(data.updated_at || Date.now()).toLocaleString("en-US", { timeZone: "Asia/Dubai" });

    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text("Receipt No:", leftX, doc.y);
    doc.font("Helvetica").text(receiptNo, leftX + 75, doc.y - 12);
    doc.font("Helvetica-Bold").text("Date:", leftX, doc.y + 5);
    doc.font("Helvetica").text(issueDate, leftX + 75, doc.y - 12);
    doc.moveDown(2);

    // Investor Info
    const sanitize = (str) => typeof str === "string" ? str.replace(/[^\x00-\x7F]/g, "") : str;

    const user = {
      userId: userInfo.userId || "Pending",
      name: userName,
      email: userEmail,
      phone: userInfo.phone || "N/A",
      alternateContact: userInfo.alternateContact || "N/A",
      passportNumber: userInfo.passportNumber || "N/A",
      addressLine1: sanitize(userInfo.addressLine1 || "-"),
      addressLine2: sanitize(userInfo.addressLine2 || "-")
    };

    doc.font("Helvetica-Bold").fillColor(primaryColor).fontSize(11).text("INVESTOR INFORMATION", leftX);
    doc.moveTo(leftX, doc.y + 3).lineTo(545, doc.y + 3).strokeColor(primaryColor).lineWidth(0.5).stroke();
    doc.moveDown();

    const infoPairs = [
      ["Investor ID:", user.userId],
      ["Name:", user.name],
      ["Email:", user.email],
      ["Phone:", user.phone],
      ["Alt. Contact:", user.alternateContact],
      ["Passport No:", user.passportNumber],
      ["Address:", `${user.addressLine1}\n${user.addressLine2}`]
    ];

    infoPairs.forEach(([label, value]) => {
      doc.font("Helvetica-Bold").fillColor("#000").text(label, leftX, doc.y);
      doc.font("Helvetica").fillColor("#000").text(value, leftX + 100, doc.y - 12);
      doc.moveDown(0.8);
    });

    doc.moveDown(1.5);

    // Payment Details
    const payment = {
      method: (data.payment_method || "WALLETCRYPTO").toUpperCase(),
      currency: data.pay_currency?.toUpperCase() || "USDT",
      transactionId: data.payment_id,
      status: data.payment_status?.toUpperCase() || "PENDING",
      amount: data.price_amount || 50
    };

    doc.font("Helvetica-Bold").fillColor(primaryColor).fontSize(11).text("PAYMENT DETAILS", leftX);
    doc.moveTo(leftX, doc.y + 3).lineTo(545, doc.y + 3).strokeColor(primaryColor).lineWidth(0.5).stroke();
    doc.moveDown();

    const tableStartY = doc.y;
    doc.rect(tableX1 - 5, tableStartY, tableWidth, rowHeight).fill(darkColor);
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10)
      .text("Field", tableX1, tableStartY + 5)
      .text("Value", tableX2, tableStartY + 5);

    const rows = [
      ["Payment Method", `${payment.method} (${payment.currency})`],
      ["Transaction ID", payment.transactionId],
      ["Payment Status", payment.status]
    ];

    let y = tableStartY + rowHeight;
    rows.forEach(([label, value], i) => {
      const bgColor = i % 2 === 0 ? lightGray : "#ffffff";
      doc.rect(tableX1 - 5, y, tableWidth, rowHeight).fill(bgColor);

      doc.fillColor("#000").font("Helvetica-Bold").fontSize(9).text(label, tableX1, y + 5);
      doc.font(label === "Payment Status" ? "Helvetica-Bold" : "Helvetica")
        .fillColor(label === "Payment Status" ? primaryColor : "#000")
        .fontSize(label === "Transaction ID" ? 7 : 9)
        .text(value, tableX2, y + 5, {
          width: tableWidth - (tableX2 - tableX1) - 10,
          continued: false,
          lineGap: 2,
        });

      y += rowHeight;
    });

    // Total Paid
    doc.moveDown(2);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(primaryColor);
    doc.text(`TOTAL PAID: $${payment.amount} ${payment.currency}`, tableX1, doc.y);

    // Paid Stamp
    if (payment.status.toLowerCase() === "success" && fs.existsSync(paidSealPath)) {
      const stampWidth = 100;
      const stampX = 400;
      const stampY = doc.y - 15;
      doc.save()
        .rotate(-20, { origin: [stampX + stampWidth / 2, stampY + stampWidth / 2] })
        .image(paidSealPath, stampX, stampY, { width: stampWidth })
        .restore();
    }

    // Footer
    const footerY = doc.page.height - 100;
    doc.font("Helvetica-Oblique").fontSize(9).fillColor("#555")
      .text("Thank you for investing with Prime Bond!", 50, footerY, { align: "center", width: 500 })
      .text("Need help? Email: primebond@primewish.ae", { align: "center", width: 500 })
      .text("Visit us: www.primewish.ae", { align: "center", width: 500 });

    doc.end();

    // Wait for stream and send email
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    await transporter.sendMail({
      from: `"Prime Bond" <${process.env.EMAIL_ID}>`,
      to: userEmail,
      subject: `✅ Prime Bond Receipt - ${receiptNo}`,
      text: `Dear ${userName},\n\nYour investment receipt is attached.\n\nThank you for choosing Prime Bond.\n\nBest regards,\nPrime Bond Team`,
      attachments: [
        {
          filename: `receipt-${receiptNo}.pdf`,
          path: filePath
        }
      ]
    });

    fs.unlinkSync(filePath);
    console.log("📧 Receipt sent to:", userEmail);
  } catch (error) {
    console.error('❌ Receipt Generation Error:', error);
    throw error;
  }
}


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



// In paymentRoutes.js, add after existing routes
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



// In paymentRoutes.js, add this route
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

    // Assuming the receipt is stored or can be regenerated
    const receiptsDir = path.join(__dirname, "../receipts");
    const filePath = path.join(receiptsDir, `receipt-${paymentId}.pdf`);

    if (!fs.existsSync(filePath)) {
      // Regenerate the receipt if not found
      const user = await authDB.findById(payment.userId);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const paymentData = {
        payment_id: payment.payment_reference,
        updated_at: payment.updatedAt.toISOString(),
        price_amount: payment.amount,
        pay_currency: payment.currency,
        order_description: payment.investmentId
          ? `Investment in ${(await InvestmentPlan.findById((await Investment.findById(payment.investmentId)).planId)).name}`
          : 'Registration Payment',
        payment_status: payment.status,
        payment_method: payment.paymentMethod.toUpperCase()
      };

      await generateAndSendReceipt(paymentData, user.email, user.name, {
        userId: user.userId,
        phone: user.phone,
        alternateContact: user.alternateContact,
        passportNumber: user.passportNumber,
        addressLine1: user.street || '-',
        addressLine2: `${user.city || ''}, ${user.state || ''}, ${user.postalCode || ''}, ${user.country || ''}`
      });

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: 'Receipt file not generated' });
      }
    }

    res.setHeader('Content-Disposition', `attachment; filename="receipt-${paymentId}.pdf"`);
    res.setHeader('Content-Type', 'application/pdf');
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    // Optional: Delete the file after sending to save space
    fileStream.on('end', () => fs.unlinkSync(filePath));
  } catch (error) {
    console.error('❌ Download Receipt Error:', error);
    res.status(500).json({ success: false, message: 'Failed to download receipt', error: error.message });
  }
});



router.post('/register', ensureAuth, payRegister);
router.post('/investment', ensureAuth, payInvestment);
router.post('/callback', callback);

module.exports = {
  router, 
  generateNextUserId,
  generateAndSendReceipt
};
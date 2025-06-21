const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET);
const { payRegister, payInvestment, callback } = require('../controllers/paymentController');
const { ensureAuth } = require('../middleware/authMiddleware');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const authDB = require('../models/auth_schema');
const MemberPayment = require('../models/MemberPaymentSchema');
const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');

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

async function generateAndSendReceipt(data, userEmail, userName, userInfo = {}) {
  try {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const receiptsDir = path.join(__dirname, "../receipts");
    if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir);
    const filePath = path.join(receiptsDir, `receipt-${data.payment_id}.pdf`);
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    const logoPath = path.join(__dirname, '../assets/images/Wish.JPG');
    const paidSealPath = path.join(__dirname, '../assets/images/paid_seal.png');
    const themeColor = "#3b4a39";
    const leftX = 50;
    const tableX1 = 65;
    const tableX2 = 230;
    const tableWidth = 480;
    const rowHeight = 20;

    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 55, 40, { width: 80 });
    }

    doc.fontSize(16).fillColor("#00796b").font("Helvetica-Bold").text("PRIME BOND", 0, 40, { align: "center" });
    doc.fontSize(9).font("Helvetica").fillColor("#000")
      .text("Bur Dubai, Dubai, UAE", { align: "center" })
      .text("Email: info@primebond.ae | Phone: +971-50-000-0000", { align: "center" })
      .text("www.primebond.ae", { align: "center" });

    doc.moveDown(4);
    doc.fontSize(13).fillColor(themeColor).font("Helvetica-Bold")
      .text("INVESTMENT PAYMENT RECEIPT", { align: "center", underline: true });

    const receiptNo = `PB-${(data.payment_id || "XXXXXXX").slice(-8).toUpperCase()}`;
    const issueDate = new Date(data.updated_at || Date.now()).toLocaleString("en-US", { timeZone: "Asia/Dubai" });

    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text("Receipt No:", leftX, doc.y);
    doc.font("Helvetica").text(receiptNo, leftX + 75, doc.y - 12);
    doc.font("Helvetica-Bold").text("Date:", leftX, doc.y + 5);
    doc.font("Helvetica").text(issueDate, leftX + 75, doc.y - 12);
    doc.moveDown(2);

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

    doc.font("Helvetica-Bold").fillColor(themeColor).fontSize(11).text("INVESTOR INFORMATION", leftX);
    doc.moveTo(leftX, doc.y + 3).lineTo(545, doc.y + 3).strokeColor(themeColor).lineWidth(0.5).stroke();
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

    const payment = {
      method: (data.payment_method || "WALLETCRYPTO").toUpperCase(),
      currency: data.pay_currency?.toUpperCase() || "USDT",
      transactionId: data.payment_id,
      status: data.payment_status?.toUpperCase() || "PENDING",
      amount: data.price_amount || 50
    };

    doc.font("Helvetica-Bold").fillColor(themeColor).fontSize(11).text("PAYMENT DETAILS", leftX);
    doc.moveTo(leftX, doc.y + 3).lineTo(545, doc.y + 3).strokeColor(themeColor).lineWidth(0.5).stroke();
    doc.moveDown();

    const tableStartY = doc.y;
    doc.rect(tableX1 - 5, tableStartY, tableWidth, rowHeight).fill(themeColor);
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
      const bgColor = i % 2 === 0 ? "#f9f9f9" : "#ffffff";
      doc.rect(tableX1 - 5, y, tableWidth, rowHeight).fill(bgColor);

      doc.fillColor("#000").font("Helvetica-Bold").fontSize(9).text(label, tableX1, y + 5);
      doc.font(label === "Payment Status" ? "Helvetica-Bold" : "Helvetica")
        .fillColor(label === "Payment Status" ? "#00796b" : "#000")
        .fontSize(label === "Transaction ID" ? 7 : 9)
        .text(value, tableX2, y + 5, {
          width: tableWidth - (tableX2 - tableX1) - 10,
          continued: false,
          lineGap: 2,
        });

      y += rowHeight;
    });

    doc.moveDown(2);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(themeColor);
    doc.text(`TOTAL PAID: $${payment.amount} ${payment.currency}`, tableX1, doc.y);

    if (payment.status.toLowerCase() === "success" && fs.existsSync(paidSealPath)) {
      const stampWidth = 100;
      const stampX = 400;
      const stampY = doc.y - 15;
      doc.save()
        .rotate(-20, { origin: [stampX + stampWidth / 2, stampY + stampWidth / 2] })
        .image(paidSealPath, stampX, stampY, { width: stampWidth })
        .restore();
    }

    const footerY = doc.page.height - 100;
    doc.font("Helvetica-Oblique").fontSize(9).fillColor("#555")
      .text("Thank you for investing with Prime Bond!", 50, footerY, { align: "center", width: 500 })
      .text("Need help? Email: info@primebond.ae", { align: "center", width: 500 })
      .text("Visit us: www.primebond.ae", { align: "center", width: 500 });

    doc.end();

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

router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ Stripe Webhook Error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
      expand: ['payment_intent']
    });

    const paymentIntentId = session.payment_intent.id;
    console.log("💳 Stripe PaymentIntent ID:", paymentIntentId);

    const payment = await MemberPayment.findOneAndUpdate(
      { payment_reference: session.id },
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
        user.paymentMethod = 'card';
        user.transactionId = session.id;
        user.lastPaymentLink = session.url || null;
        user.cryptoCoin = null;
        await user.save();

        if (payment.investmentId) {
          const investment = await Investment.findById(payment.investmentId);
          if (investment) {
            investment.status = 'active';
            await investment.save();
          }
        }

        const orderDescription = payment.investmentId
          ? `Prime Bond ${(await InvestmentPlan.findById((await Investment.findById(payment.investmentId)).planId)).name} Investment`
          : 'Prime Bond Registration';

        await generateAndSendReceipt({
          payment_id: session.id,
          updated_at: new Date().toISOString(),
          price_amount: session.amount_total / 100,
          pay_currency: session.currency,
          order_description: orderDescription,
          payment_status: 'success',
          payment_method: 'CARD'
        }, user.email, user.name, {
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

  res.status(200).json({ received: true });
});

router.get('/test-receipt', async (req, res) => {
  try {
    const fakePaymentData = {
      payment_id: 'TEST12345678',
      updated_at: new Date().toISOString(),
      price_amount: 50,
      pay_currency: 'usd',
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

router.post('/register', ensureAuth, payRegister);
router.post('/investment', ensureAuth, payInvestment);
router.post('/callback', callback);

module.exports = {
  router,
  generateNextUserId,
  generateAndSendReceipt
};
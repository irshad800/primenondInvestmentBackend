const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

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

  const authDB = require('../models/auth_schema');
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
    if (!data || !data.payment_id) {
      throw new Error('Invalid payment data: payment_id is required');
    }

    console.log('Generating receipt with data:', data); // Debug the data object

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const receiptsDir = path.join(__dirname, "../receipts");
    if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir);
    const filePath = path.join(receiptsDir, `receipt-${data.payment_id}.pdf`);
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    const logoPath = path.join(__dirname, '../assets/images/baclogo.png');
    const paidSealPath = path.join(__dirname, '../assets/images/image.png');

    const primaryColor = "#F37021";
    const darkColor = "#333333";
    const lightGray = "#f9f9f9";

    const leftX = 50;
    const tableX1 = 65;
    const tableX2 = 230;
    const tableWidth = 480;
    const rowHeight = 20;

    if (fs.existsSync(logoPath)) {
      const logoWidth = 80;
      const pageWidth = doc.page.width;
      const centerX = (pageWidth - logoWidth) / 2;
      doc.image(logoPath, centerX, 40, { width: logoWidth });
    }

    doc.moveDown(5);

    doc.fontSize(16).fillColor(primaryColor).font("Helvetica-Bold")
      .text("PRIME BOND", { align: "center" });

    doc.moveDown(0.5);
    doc.fontSize(9).font("Helvetica").fillColor("#000")
      .text("4004/4005, 40th Floor, Citadel Tower, Al Marasi Drive Business Bay, Dubai- U.A.E.", { align: "center" })
      .text("Email: primebond@primewish.ae | Phone: +971-508009426, +97142597167", { align: "center" });

    doc.moveDown(4);
    doc.fontSize(13).fillColor(primaryColor).font("Helvetica-Bold")
      .text(data.paymentType === 'registration' ? "INVESTMENT REGISTRATION PAYMENT" : "CURRENT INVESTMENT PAYMENT RECEIPT", { align: "center", underline: true });

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
      userId: userInfo.userId || "N/A",
      name: userName || "Unknown User",
      email: userEmail || "No Email",
      phone: userInfo.phone || "N/A",
      alternateContact: userInfo.alternateContact || "N/A",
      passportNumber: userInfo.passportNumber || "N/A",
      addressLine1: sanitize(userInfo.addressLine1 || "N/A"),
      addressLine2: sanitize(userInfo.addressLine2 || "N/A")
    };

    if (!userInfo.userId) {
      console.warn(`UserId not provided for payment_id: ${data.payment_id}`);
    }

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

    const payment = {
      method: (data.payment_method || "UNKNOWN").toUpperCase(),
      currency: data.pay_currency?.toUpperCase() || "N/A",
      transactionId: data.payment_id || "N/A",
      status: data.payment_status?.toUpperCase() || "N/A",
      amount: data.price_amount || 0
    };

    if (!data.price_amount) {
      console.warn(`Price amount not provided for payment_id: ${data.payment_id}, using 0`);
    }

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

    doc.moveDown(2);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(primaryColor);
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
      .text("Need help? Email: primebond@primewish.ae", { align: "center", width: 500 })
      .text("Visit us: www.primewish.ae", { align: "center", width: 500 });

    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

await transporter.sendMail({
  from: `"Prime Bond" <${process.env.EMAIL_ID}>`,
  to: userEmail,
  subject: `✅ Prime Bond Receipt - ${receiptNo}`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #0056b3; padding: 20px; text-align: center; }
        .header img { max-width: 150px; }
        .content { padding: 20px; background-color: #f8f9fa; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
        .receipt-details { background-color: #fff; border: 1px solid #ddd; padding: 15px; margin: 15px 0; }
        .button { display: inline-block; padding: 10px 20px; background-color: #0056b3; color: white; text-decoration: none; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="color: white; margin: 0;">Prime Bond Investments</h1>
        </div>
        <div class="content">
          <p>Dear ${userName || 'Investor'},</p>
          <p>Thank you for your investment with Prime Bond Investments. Please find below the details of your transaction:</p>
          <div class="receipt-details">
            <h3 style="margin-top: 0;">Receipt Summary</h3>
            <p><strong>Receipt Number:</strong> ${receiptNo}</p>
            <p><strong>Amount:</strong> ${payment.currency} ${payment.amount}</p>
            <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-GB')}</p>
          </div>
          <p>Your official receipt is attached to this email for your records. Should you have any questions regarding this transaction, please don't hesitate to contact our customer service team.</p>
          <p>Thank you for choosing Prime Bond Investments.</p>
          <p>Best regards,<br>The Prime Bond Team</p>
        </div>
        <div class="footer">
          <p>Prime Bond Investments | 40th Floor, Citadel Tower, Al Marasi Drive, Business Bay, Dubai, UAE</p>
          <p>Email: primebond@primewish.ae | Phone: +971-508009426</p>
          <p>Commercial License: 1234567 | TRN: 123456789123456</p>
        </div>
      </div>
    </body>
    </html>
  `,
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

module.exports = { generateNextUserId, generateAndSendReceipt };
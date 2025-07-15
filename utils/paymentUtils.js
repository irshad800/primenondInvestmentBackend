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

async function generateAndSendReceipt(data, userEmail, userName, userInfo = {}, isDownload = false, sendEmail = true) {
  try {
    if (!data || !data.payment_id) {
      throw new Error('Invalid payment data: payment_id is required');
    }

    console.log('Generating receipt with data:', data);

    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    const receiptsDir = path.join(__dirname, "../receipts");
    if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
    const filePath = path.join(receiptsDir, `receipt-${data.payment_id}.pdf`);
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    const logoPath = path.join(__dirname, '../assets/images/baclogo.png');
    const paidSealPath = path.join(__dirname, '../assets/images/image.png');

    const primaryColor = "#F37021";
    const darkColor = "#333333";
    const lightGray = "#f9f9fa";

    const leftX = 50;
    const tableX1 = 65;
    const tableX2 = 230;
    const tableWidth = 480;
    const rowHeight = 18;

    // Header
    if (fs.existsSync(logoPath)) {
      const logoWidth = 80;
      const pageWidth = doc.page.width;
      const centerX = (pageWidth - logoWidth) / 2;
      doc.image(logoPath, centerX, 20, { width: logoWidth });
    }

    doc.moveDown(5);
    doc.fontSize(16).fillColor(primaryColor).font("Helvetica-Bold")
      .text("PRIME BOND", { align: "center" });

    doc.moveDown(0.3);
    doc.fontSize(9).font("Helvetica").fillColor("#000")
      .text("4004/4005, 40th Floor, Citadel Tower, Al Marasi Drive Business Bay, Dubai- U.A.E.", { align: "center", width: 500 })
      .moveDown(0.2)
      .text("Email: primebond@primewish.ae | Phone: +971-508009428, +971-42597167", { align: "center", width: 500 });

    doc.moveDown(2);
    doc.fontSize(13).fillColor(primaryColor).font("Helvetica-Bold")
      .text(data.paymentType === 'registration' ? "INVESTOR REGISTRATION PAYMENT" : "INVESTMENT PAYMENT RECEIPT", { align: "center", underline: true });

    const receiptNo = `PB-${(data.payment_id || "XXXXXXX").slice(-8).toUpperCase()}`;
    const issueDate = data.updated_at ? new Date(data.updated_at).toLocaleString("en-US", { timeZone: "Asia/Dubai" }) : new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: true });

    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text("Receipt No:", leftX, doc.y, { continued: true }).font("Helvetica").text(receiptNo, leftX + 90);
    doc.font("Helvetica-Bold").text("Date:", leftX, doc.y + 5, { continued: true }).font("Helvetica").text(issueDate, leftX + 90);

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

    doc.moveDown(1);
    doc.save()
      .rect(leftX, doc.y, 490, 18)
      .fillColor("#1F2937")
      .fillOpacity(0.9)
      .fill()
      .restore();
    doc.font("Helvetica-Bold").fillColor("#FFFFFF").fontSize(10).text("INVESTOR INFORMATION", leftX + 10, doc.y + 3, { align: "left" });
    doc.moveDown(1);

    const infoPairs = data.paymentType === 'registration' ? [
      ["Investor ID", user.userId],
      ["Name", user.name],
      ["Email", user.email],
      ["Phone", user.phone],
      ["Alt. Contact", user.alternateContact],
      ["Passport No", user.passportNumber],
      ["Address", `${user.addressLine1}\n${user.addressLine2}`]
    ] : [
      ["Investor ID", user.userId],
      ["Name", user.name],
      ["Email", user.email]
    ];

    infoPairs.forEach(([label, value]) => {
      doc.font("Helvetica").fillColor("#1F2937").fontSize(9).text(`${label}: ${value}`, leftX, doc.y, { width: 480, align: "left" });
      doc.moveDown(0.5);
    });

    // Payment Details
    doc.moveDown(2);
    doc.font("Helvetica-Bold").fillColor(primaryColor).fontSize(11).text("PAYMENT DETAILS", leftX);
    doc.moveTo(leftX, doc.y + 3).lineTo(545, doc.y + 3).strokeColor(primaryColor).lineWidth(0.5).stroke();
    doc.moveDown(1);

    const payment = {
      method: (data.payment_method || "UNKNOWN").toUpperCase(),
      currency: data.pay_currency?.toUpperCase() || "AED",
      transactionId: data.payment_id || "N/A",
      status: data.payment_status?.toUpperCase() || "N/A",
      amount: data.price_amount || 0
    };

    if (!data.price_amount) {
      console.warn(`Price amount not provided for payment_id: ${data.payment_id}, using 0`);
    }

    const tableStartY = doc.y;
    doc.rect(tableX1 - 5, tableStartY, tableWidth, rowHeight).fill(darkColor);
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10)
      .text("Field", tableX1, tableStartY + 5, { width: tableX2 - tableX1 - 10, align: "left" })
      .text("Value", tableX2, tableStartY + 5, { width: tableWidth - (tableX2 - tableX1), align: "left" });

    const paymentRows = [
      ["Payment Method", `${payment.method} (${payment.currency})`],
      ["Transaction ID", payment.transactionId],
      ["Payment Status", payment.status]
    ];

    let y = tableStartY + rowHeight;
    paymentRows.forEach(([label, value], i) => {
      const bgColor = i % 2 === 0 ? lightGray : "#ffffff";
      doc.rect(tableX1 - 5, y, tableWidth, rowHeight).fill(bgColor);

      doc.fillColor("#000").font("Helvetica-Bold").fontSize(9).text(label, tableX1, y + 5, { width: tableX2 - tableX1 - 10, align: "left" });
      doc.font(label === "Payment Status" ? "Helvetica-Bold" : "Helvetica")
        .fillColor(label === "Payment Status" ? primaryColor : "#000")
        .fontSize(label === "Transaction ID" ? 7 : 9)
        .text(value, tableX2, y + 5, { width: tableWidth - (tableX2 - tableX1), align: "left" });

      y += rowHeight;
    });

    // Investment Details (only for investment payments)
    if (data.paymentType === 'investment') {
      doc.moveDown(1);
      doc.font("Helvetica-Bold").fillColor(primaryColor).fontSize(11).text("INVESTMENT DETAILS", leftX);
      doc.moveTo(leftX, doc.y + 3).lineTo(545, doc.y + 3).strokeColor(primaryColor).lineWidth(0.5).stroke();
      doc.moveDown(1);

      const investmentTableStartY = doc.y;
      doc.rect(tableX1 - 5, investmentTableStartY, tableWidth, rowHeight).fill(darkColor);
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10)
        .text("Field", tableX1, investmentTableStartY + 5, { width: tableX2 - tableX1 - 10, align: "left" })
        .text("Value", tableX2, investmentTableStartY + 5, { width: tableWidth - (tableX2 - tableX1), align: "left" });

      const payoutOption = data.investmentDetails?.payoutOption?.toLowerCase() || "n/a";
      const investmentRows = [
        ["Plan Name", data.investmentDetails?.planName || "N/A"],
        ["Investment Amount", `${data.investmentDetails?.amount || 0} ${payment.currency}`],
        ["Payout Option", payoutOption]
      ];

      y = investmentTableStartY + rowHeight;
      investmentRows.forEach(([label, value], i) => {
        const bgColor = i % 2 === 0 ? lightGray : "#ffffff";
        doc.rect(tableX1 - 5, y, tableWidth, rowHeight).fill(bgColor);

        doc.fillColor("#000").font("Helvetica-Bold").fontSize(9).text(label, tableX1, y + 5, { width: tableX2 - tableX1 - 10, align: "left" });
        doc.font("Helvetica").fillColor("#000").fontSize(9).text(value, tableX2, y + 5, { width: tableWidth - (tableX2 - tableX1), align: "left" });

        y += rowHeight;
      });
    }

    // Total Paid
    doc.moveDown(2);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(primaryColor);
    doc.text(`TOTAL PAID: $${payment.amount} ${payment.currency}`, tableX1, doc.y, { align: "left" });

    // Paid Seal
    if (payment.status.toLowerCase() === "success" && fs.existsSync(paidSealPath)) {
      const stampWidth = 80;
      const stampX = 400;
      const stampY = doc.y - 10;
      doc.save()
        .rotate(-20, { origin: [stampX + stampWidth / 2, stampY + stampWidth / 2] })
        .image(paidSealPath, stampX, stampY, { width: stampWidth })
        .restore();
    }

    // Footer
    const footerY = doc.page.height - 60;
    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#555")
      .text("Thank you for investing with Prime Bond!", 50, footerY, { align: "center", width: 500 })
      .text("Need help? Email: primebond@primewish.ae", { align: "center", width: 500 })
      .text("Visit us: www.primewish.ae", { align: "center", width: 500 });

    doc.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // Send email only if sendEmail is true (default is true)
    if (sendEmail) {
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
              .content { padding: 20px; background-color: #f8f9fa; }
              .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
              .receipt-details { background-color: #fff; border: 1px solid #ddd; padding: 15px; margin: 15px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1 style="color: white; margin: 0;">Prime Bond Investments</h1>
              </div>
              <div class="content">
                <p>یشن

                <p>Dear ${userName || 'Investor'},</p>
                <p>Thank you for your ${data.paymentType === 'registration' ? 'registration' : 'investment'} with Prime Bond Investments. Please find below the details of your transaction:</p>
                <div class="receipt-details">
                  <h3 style="margin-top: 0;">Receipt Summary</h3>
                  <p><strong>Receipt Number:</strong> ${receiptNo}</p>
                  <p><strong>Amount:</strong> ${payment.currency} ${payment.amount}</p>
                  <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-GB')}</p>
                </div>
                ${data.paymentType === 'investment' ? `
                  <div class="receipt-details">
                    <h3>Investment Details</h3>
                    <p><strong>Plan Name:</strong> ${data.investmentDetails?.planName || 'N/A'}</p>
                    <p><strong>Investment Amount:</strong> ${data.investmentDetails?.amount || 0} ${payment.currency}</p>
                    <p><strong>Payout Option:</strong> ${data.investmentDetails?.payoutOption || 'N/A'}</p>
                  </div>
                ` : ''}
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

      console.log("📧 Receipt generated and sent to:", userEmail);
    }

    if (!isDownload) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('❌ Receipt Generation Error:', error);
    throw error;
  }
}

module.exports = { generateNextUserId, generateAndSendReceipt };
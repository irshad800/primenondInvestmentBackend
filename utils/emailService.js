require('dotenv').config(); // ✅ Load environment variables at the very beginning

const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Debug email configuration
console.log('📧 Email Config Loaded:', {
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE,
  user: process.env.EMAIL_ID,
  pass: process.env.EMAIL_APP_PASSWORD ? '[REDACTED]' : undefined
});

// Email Transporter Setup
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT, 10),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_ID,
    pass: process.env.EMAIL_APP_PASSWORD
  },
  logger: true,
  debug: true,
  connectionTimeout: 10000,
  tls: {
    ciphers: 'SSLv3',
    rejectUnauthorized: false // WARNING: Set to true in production
  }
});

// Verify transporter configuration
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ SMTP Connection Error:', error.message);
  } else {
    console.log('✅ SMTP Server is ready to send emails');
  }
});

// Generate random token
const generateVerificationToken = () => crypto.randomBytes(20).toString('hex');

// Send verification email
const sendVerificationEmail = async (email, token) => {
  const verificationUrl = `http://localhost:5000/api/auth/verify-email/${token}`;

  const mailOptions = {
    from: `"Prime Bond" <${process.env.EMAIL_ID}>`,
    to: email,
    replyTo: 'support@primebond.com',
    subject: 'Confirm your email for Prime Bond',
    text: `Please confirm your email address by clicking the link below:\n\n${verificationUrl}\n\nThis link expires in 24 hours.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
        <p>Hello,</p>
        <p>Please confirm your email address to activate your Prime Bond account:</p>
        <p style="margin: 25px 0;">
          <a href="${verificationUrl}" 
             style="background-color: #2563eb; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
            Confirm Email Address
          </a>
        </p>
        <p>This link expires in 24 hours.</p>
        <p style="color: #6b7280; font-size: 14px;">
          If you didn't request this, please ignore this message.
        </p>
      </div>
    `,
    headers: {
      'X-Entity-Ref-ID': crypto.randomUUID(),
      'List-Unsubscribe': '<https://primebond.com/unsubscribe>, <mailto:verification@wishgroup.ae>',
      'Precedence': 'bulk'
    },
    priority: 'normal'
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${email}. Message ID: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error('❌ Failed to send email:', {
      message: err.message,
      code: err.code,
      command: err.command
    });
    throw new Error(`Email delivery failed: ${err.message}`);
  }
};

// Send password reset email
const sendPasswordResetEmail = async (email, resetToken) => {
const resetUrl = `http://127.0.0.1:5500/reset-password.html?token=${resetToken}`;

  const mailOptions = {
    from: `"Prime Bond" <${process.env.EMAIL_ID}>`,
    to: email,
    replyTo: 'support@primebond.com',
    subject: 'Reset your Prime Bond password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.6;">
        <p>Hello,</p>
        <p>We received a request to reset your Prime Bond password.</p>
        <p style="margin: 25px 0;">
          <a href="${resetUrl}" 
             style="background-color: #ef4444; color: white; padding: 12px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
            Reset Password
          </a>
        </p>
        <p>This link expires in 1 hour. If you didn’t request this, please ignore it.</p>
      </div>
    `,
    headers: {
      'X-Entity-Ref-ID': crypto.randomUUID(),
      'Precedence': 'bulk'
    },
    priority: 'high'
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Password reset email sent to ${email}. Message ID: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error('❌ Failed to send password reset email:', err.message);
    throw new Error(`Password reset email failed: ${err.message}`);
  }
};


module.exports = {
  transporter,
  generateVerificationToken,
  sendVerificationEmail,
  sendPasswordResetEmail // 👈 add this line
};


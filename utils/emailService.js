const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_ID,
    pass: process.env.EMAIL_APP_PASSWORD
  },
  logger: true,
  debug: true
});

const generateVerificationToken = () => Math.random().toString(36).substring(2);

const sendVerificationEmail = async (email, token) => {
  const verificationUrl = `${process.env.BASE_URL}/api/verify-email?token=${token}`;

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
      'X-Entity-Ref-ID': require('crypto').randomUUID(),
      'List-Unsubscribe': '<https://primebond.com/unsubscribe>, <mailto:unsubscribe@primebond.com>',
      'Precedence': 'bulk'
    },
    priority: 'normal'
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${email}. MessageId: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error('Failed to send email:', err);
    throw new Error('Email delivery failed');
  }
};

module.exports = { transporter, generateVerificationToken, sendVerificationEmail };
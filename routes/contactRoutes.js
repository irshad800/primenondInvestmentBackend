const express = require('express');
const router = express.Router();
const ContactMessage = require('../models/ContactMessage');
const { transporter } = require('../utils/emailService');
const { ensureAuth } = require('../middleware/authMiddleware');

// ----------------------------------------
// PUBLIC: Contact Form Submission
// ----------------------------------------
router.post('/submit', async (req, res) => {
  try {
    const { email, subject, message } = req.body;

    if (!email || !subject || !message) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    // Save to DB
    const newMessage = new ContactMessage({
      email,
      subject,
      message,
    });
    await newMessage.save();

    // Send confirmation email to user
    const mailOptions = {
      from: `"Prime Bond Support" <${process.env.EMAIL_ID}>`,
      to: email,
      subject: 'Your message has been received',
      html: `
        <p>Dear User,</p>
        <p>Thank you for contacting Prime Bond Investment. We have received your message:</p>
        <blockquote>${message}</blockquote>
        <p>Our support team will get back to you shortly.</p>
        <p>Best regards,<br>Prime Bond Support Team</p>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: 'Message submitted successfully' });
  } catch (error) {
    console.error('❌ Contact form error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// ----------------------------------------
// ADMIN: Reply to Message
// ----------------------------------------
router.post('/reply/:id', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only' });
  }

  try {
    const { id } = req.params;
    const { reply } = req.body;

    if (!reply) {
      return res.status(400).json({ success: false, message: 'Reply message is required' });
    }

    const contact = await ContactMessage.findById(id);
    if (!contact) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    // Save reply
    contact.reply = reply;
    contact.repliedAt = new Date();
    await contact.save();

    // Send email
    const mailOptions = {
      from: `"Prime Bond Support" <${process.env.EMAIL_ID}>`,
      to: contact.email,
      subject: `RE: ${contact.subject}`,
      html: `
        <p>Dear User,</p>
        <p>This is a response to your message:</p>
        <blockquote>${contact.message}</blockquote>
        <p><strong>Reply:</strong></p>
        <p>${reply}</p>
        <p>Regards,<br>Prime Bond Support Team</p>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: 'Reply sent and saved successfully' });
  } catch (error) {
    console.error('❌ Reply error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

module.exports = router;

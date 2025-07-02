const express = require('express');
const router = express.Router();
const ContactMessage = require('../models/ContactMessage');
const { transporter } = require('../utils/emailService');
const { ensureAuth } = require('../middleware/authMiddleware');

// Admin replies to a message
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

    // Save the reply
    contact.reply = reply;
    contact.repliedAt = new Date();
    await contact.save();

    // Send reply to user's email
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
module.exports = router; // ✅ CORRECT

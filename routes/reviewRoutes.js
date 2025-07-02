const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
const authDB = require('../models/auth_schema');
const { ensureAuth } = require('../middleware/authMiddleware');

// Submit Review (User Only)
router.post('/submit', ensureAuth, async (req, res) => {
  try {
    const { message, rating } = req.body;

    if (!message || !rating) {
      return res.status(400).json({ success: false, message: 'Message and rating are required' });
    }

    const user = await authDB.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const review = new Review({
      userId: user._id,
      username: user.username,
      message,
      rating
    });

    await review.save();
    res.json({ success: true, message: 'Review submitted successfully' });
  } catch (error) {
    console.error('❌ Submit review error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// Get All Reviews (Admin Only)
router.get('/all', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only' });
  }

  try {
    const reviews = await Review.find().sort({ createdAt: -1 }).populate('userId', 'email name userId');
    res.json({ success: true, reviews });
  } catch (error) {
    console.error('❌ Get all reviews error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

module.exports = router; // ✅ CORRECT


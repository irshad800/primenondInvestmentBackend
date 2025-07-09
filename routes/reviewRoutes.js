const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Review = require('../models/Review');
const authDB = require('../models/auth_schema');
const { ensureAuth } = require('../middleware/authMiddleware');

// Helper function to format dates
const formatDate = (date) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Dubai'
  });
};

// Submit Review (User Only)
router.post('/submit', ensureAuth, async (req, res) => {
  try {
    const { message, rating } = req.body;

    if (!message || !rating) {
      return res.status(400).json({ success: false, message: 'Message and rating are required' });
    }
    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be a number between 1 and 5' });
    }
    if (message.length > 500) {
      return res.status(400).json({ success: false, message: 'Message cannot exceed 500 characters' });
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
    res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      data: {
        _id: review._id,
        userId: review.userId,
        username: review.username,
        message: review.message,
        rating: review.rating,
        createdAt: formatDate(review.createdAt)
      }
    });
  } catch (error) {
    console.error(`❌ Submit review error: userId=${req.user?._id || 'unknown'}, error=${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to submit review' });
  }
});

// Get All Reviews (Admin Only)
router.get('/all', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only' });
  }

  try {
    const reviews = await Review.find()
      .sort({ createdAt: -1 })
      .populate('userId', 'email name userId')
      .lean();

    const enrichedReviews = reviews.map(review => ({
      ...review,
      createdAt: formatDate(review.createdAt),
      updatedAt: formatDate(review.updatedAt)
    }));

    res.json({ success: true, reviews: enrichedReviews });
  } catch (error) {
    console.error(`❌ Get all reviews error: error=${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
  }
});

// Get Reviews for a Specific User (User or Admin)
router.get('/get/:userId', ensureAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    const userIdString = req.user._id.toString();
    if (userIdString !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized access' });
    }

    const reviews = await Review.find({ userId })
      .sort({ createdAt: -1 })
      .populate('userId', 'email name userId')
      .lean();

    const enrichedReviews = reviews.map(review => ({
      ...review,
      createdAt: formatDate(review.createdAt),
      updatedAt: formatDate(review.updatedAt)
    }));

    res.json({ success: true, reviews: enrichedReviews });
  } catch (error) {
    console.error(`❌ Get user reviews error: userId=${req.params.userId}, error=${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to fetch reviews' });
  }
});

// Get All Reviews (Public, No Authentication Required)
router.get('/public', async (req, res) => {
  try {
    const reviews = await Review.find()
      .sort({ createdAt: -1 })
      .populate('userId', 'username')
      .lean();

    const enrichedReviews = reviews.map(review => ({
      _id: review._id,
      username: review.userId?.username || 'Anonymous',
      message: review.message,
      rating: review.rating,
      createdAt: formatDate(review.createdAt),
      updatedAt: formatDate(review.updatedAt)
    }));

    res.json({ success: true, reviews: enrichedReviews });
  } catch (error) {
    console.error(`❌ Get public reviews error: error=${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to fetch public reviews' });
  }
});

// Get Reviews for Current User (User Only)
router.get('/my-reviews', ensureAuth, async (req, res) => {
  try {
    const userId = req.user._id;

    const reviews = await Review.find({ userId })
      .sort({ createdAt: -1 })
      .populate('userId', 'email name userId')
      .lean();

    const enrichedReviews = reviews.map(review => ({
      ...review,
      createdAt: formatDate(review.createdAt),
      updatedAt: formatDate(review.updatedAt)
    }));

    res.json({ success: true, reviews: enrichedReviews });
  } catch (error) {
    console.error(`❌ Get my reviews error: userId=${req.user._id}, error=${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to fetch your reviews' });
  }
});

// Update Review (Admin or User Owner)
router.put('/update/:reviewId', ensureAuth, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { message, rating } = req.body;

    if (!mongoose.isValidObjectId(reviewId)) {
      return res.status(400).json({ success: false, message: 'Invalid review ID format' });
    }

    if (!message && !rating) {
      return res.status(400).json({ success: false, message: 'At least one field (message or rating) is required' });
    }
    if (rating && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
      return res.status(400).json({ success: false, message: 'Rating must be a number between 1 and 5' });
    }
    if (message && message.length > 500) {
      return res.status(400).json({ success: false, message: 'Message cannot exceed 500 characters' });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    // Check if the user is the owner or an admin
    if (review.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized to update this review' });
    }

    if (message) review.message = message;
    if (rating) review.rating = rating;

    await review.save();

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: {
        _id: review._id,
        userId: review.userId,
        username: review.username,
        message: review.message,
        rating: review.rating,
        createdAt: formatDate(review.createdAt),
        updatedAt: formatDate(review.updatedAt)
      }
    });
  } catch (error) {
    console.error(`❌ Update review error: reviewId=${req.params.reviewId}, error=${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to update review' });
  }
});

// Delete Review (Admin or User Owner)
router.delete('/delete/:reviewId', ensureAuth, async (req, res) => {
  try {
    const { reviewId } = req.params;

    if (!mongoose.isValidObjectId(reviewId)) {
      return res.status(400).json({ success: false, message: 'Invalid review ID format' });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    // Check if the user is the owner or an admin
    if (review.userId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized to delete this review' });
    }

    await Review.findByIdAndDelete(reviewId);

    res.json({ success: true, message: 'Review deleted successfully' });
  } catch (error) {
    console.error(`❌ Delete review error: reviewId=${req.params.reviewId}, error=${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to delete review' });
  }
});

// Update Review (Admin Only) - Keeping the original admin-only version
router.put('/update/:reviewId', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only' });
  }

  try {
    const { reviewId } = req.params;
    const { message, rating } = req.body;

    if (!mongoose.isValidObjectId(reviewId)) {
      return res.status(400).json({ success: false, message: 'Invalid review ID format' });
    }

    if (!message && !rating) {
      return res.status(400).json({ success: false, message: 'At least one field (message or rating) is required' });
    }
    if (rating && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
      return res.status(400).json({ success: false, message: 'Rating must be a number between 1 and 5' });
    }
    if (message && message.length > 500) {
      return res.status(400).json({ success: false, message: 'Message cannot exceed 500 characters' });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    if (message) review.message = message;
    if (rating) review.rating = rating;

    await review.save();

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: {
        _id: review._id,
        userId: review.userId,
        username: review.username,
        message: review.message,
        rating: review.rating,
        createdAt: formatDate(review.createdAt),
        updatedAt: formatDate(review.updatedAt)
      }
    });
  } catch (error) {
    console.error(`❌ Update review error: reviewId=${req.params.reviewId}, error=${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to update review' });
  }
});

// Delete Review (Admin Only) - Keeping the original admin-only version
router.delete('/delete/:reviewId', ensureAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only' });
  }

  try {
    const { reviewId } = req.params;

    if (!mongoose.isValidObjectId(reviewId)) {
      return res.status(400).json({ success: false, message: 'Invalid review ID format' });
    }

    const review = await Review.findByIdAndDelete(reviewId);
    if (!review) {
      return res.status(404).json({ success: false, message: 'Review not found' });
    }

    res.json({ success: true, message: 'Review deleted successfully' });
  } catch (error) {
    console.error(`❌ Delete review error: reviewId=${req.params.reviewId}, error=${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to delete review' });
  }
});

module.exports = router;
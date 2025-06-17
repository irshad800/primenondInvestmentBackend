const express = require('express');
const router = express.Router();
const { getPlans, getUserInvestments, getUserReturns } = require('../controllers/investmentController');
const { ensureAuth } = require('../middleware/authMiddleware');

// Get all available investment plans
router.get('/plans', ensureAuth, getPlans);

// Get user investments
router.get('/investments/:userId', ensureAuth, getUserInvestments);

// Get user returns
router.get('/returns/:userId', ensureAuth, getUserReturns);

module.exports = router;
const express = require('express');
const router = express.Router();
const { getUserStatus } = require('../controllers/investmentController');
const { getPlans, getUserInvestments, getUserReturns, createInvestmentPlan, selectPlan } = require('../controllers/investmentController');
const { ensureAuth } = require('../middleware/authMiddleware');

// Get all available investment plans (no authentication required)
router.get('/plans', getPlans);

// Get user investments
router.get('/investments/:userId', ensureAuth, getUserInvestments);

// Get user returns
router.get('/returns/:userId', ensureAuth, getUserReturns);

// Admin creates investment plan
router.post('/plans/create', ensureAuth, createInvestmentPlan);

// Select an investment plan
router.post('/plans/select', ensureAuth, selectPlan);


router.get('/user/status', ensureAuth, getUserStatus);

module.exports = router;
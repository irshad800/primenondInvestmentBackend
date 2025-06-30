const express = require('express');
const router = express.Router();
const { getPlans, getUserInvestments, getUserReturns, createInvestmentPlan, selectPlan } = require('../controllers/investmentController');
const { ensureAuth } = require('../middleware/authMiddleware');

// Get all available investment plans
router.get('/plans', ensureAuth, getPlans);

// Get user investments
router.get('/investments/:userId', ensureAuth, getUserInvestments);

// Get user returns
router.get('/returns/:userId', ensureAuth, getUserReturns);

// Admin creates investment plan
router.post('/plans/create', ensureAuth, createInvestmentPlan);

// Select an investment plan
router.post('/plans/select', ensureAuth, selectPlan);



module.exports = router;
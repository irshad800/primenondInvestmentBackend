const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const {
  confirmPayment,
  updateKycStatus,
  getAllInvestments,
  getAllRois,
  getAllReturns,
  withdrawRoi,
  getDashboardStats,
} = require('../controllers/adminController');

const { ensureAuth } = require('../middleware/authMiddleware');

// Admin Login (no token required)
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const adminCredentials = [
    { username: process.env.ADMIN1_USERNAME, password: process.env.ADMIN1_PASSWORD },
    { username: process.env.ADMIN2_USERNAME, password: process.env.ADMIN2_PASSWORD }
  ];

  const admin = adminCredentials.find(
    (admin) => admin.username === username && admin.password === password
  );

  if (!admin) {
    return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
  }

  const token = jwt.sign({ username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1d' });

  res.status(200).json({
    success: true,
    message: 'Admin login successful',
    token
  });
});

// Protect all admin routes with ensureAuth + role check
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access only' });
  }
  next();
};

router.post('/confirm-payment', ensureAuth, adminOnly, confirmPayment);
router.post('/kyc/update-status', ensureAuth, adminOnly, updateKycStatus);
router.get('/all-investments', ensureAuth, adminOnly, getAllInvestments);
router.get('/all-rois', ensureAuth, adminOnly, getAllRois);
router.get('/all-returns', ensureAuth, adminOnly, getAllReturns);
router.post('/withdraw-roi', ensureAuth, adminOnly, withdrawRoi);
router.get('/dashboard-stats', ensureAuth, adminOnly, getDashboardStats);

module.exports = router;
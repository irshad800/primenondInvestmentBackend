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
  calculateRoiForAll // ✅ Add this here
} = require('../controllers/adminController');

const { ensureAuth } = require('../middleware/authMiddleware');
const MemberPayment = require('../models/MemberPaymentSchema');
const Kyc = require('../models/Kyc');

// Helper function to get current date-time with timezone
const getCurrentDateTime = () => new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai', hour12: true });

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

// Get Pending Payments (Admin)
router.get('/pending-payments', ensureAuth, adminOnly, async (req, res) => {
  try {
    const currentTime = getCurrentDateTime();
    const payments = await MemberPayment.find({ status: 'pending' })
      .populate('userId', 'name email userId')
      .populate('investmentId', 'amount planId')
      .sort({ createdAt: -1 });
    console.log(`✅ [${currentTime}] Fetched pending payments: count=${payments.length}`);
    res.json({ success: true, payments });
  } catch (error) {
    const currentTime = getCurrentDateTime();
    console.error(`❌ [${currentTime}] Fetch Pending Payments Error: ${error.message}, stack=${error.stack}`);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// Get Pending KYC Records (Admin)
router.get('/pending-kyc', ensureAuth, adminOnly, async (req, res) => {
  try {
    const currentTime = getCurrentDateTime();
    const kycRecords = await Kyc.find({ status: 'pending' })
      .populate('userId', 'name email userId')
      .sort({ createdAt: -1 });
    console.log(`✅ [${currentTime}] Fetched pending KYC records: count=${kycRecords.length}`);
    res.json({ success: true, kycRecords });
  } catch (error) {
    const currentTime = getCurrentDateTime();
    console.error(`❌ [${currentTime}] Fetch Pending KYC Error: ${error.message}, stack=${error.stack}`);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});


// In authController.js or adminController.js
const getAllInvestors = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access only' });
    }
    const investors = await authDB.find()
      .select('userId name email phone paymentStatus kycApproved createdAt')
      .lean();
    res.json({ success: true, investors });
  } catch (error) {
    console.error(`❌ Get all investors error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
// In authRoutes.js
router.get('/investors', ensureAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access only' });
    }
    const investors = await authDB.find({
      paymentStatus: 'success' // Changed from 'completed' to 'success'
      // Optionally remove or adjust the kycApproved filter based on requirements
      // kycApproved: true
    })
      .select('userId name email phone paymentStatus kycApproved createdAt')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, investors });
  } catch (error) {
    console.error('❌ Get Investors Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});


router.get('/all-payments', ensureAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin access only' });
    }
    const payments = await MemberPayment.find()
      .populate('userId', 'name email userId')
      .select('payment_reference amount currency status paymentMethod paymentType createdAt investmentId')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, payments });
  } catch (error) {
    console.error('❌ Get All Payments Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});


// Existing routes
router.post('/confirm-payment', ensureAuth, adminOnly, confirmPayment);
router.post('/kyc/update-status', ensureAuth, adminOnly, updateKycStatus);
router.get('/all-investments', ensureAuth, adminOnly, getAllInvestments);
router.get('/all-rois', ensureAuth, adminOnly, getAllRois);
router.get('/all-returns', ensureAuth, adminOnly, getAllReturns);
router.post('/withdraw-roi', ensureAuth, adminOnly, withdrawRoi);
router.get('/dashboard-stats', ensureAuth, adminOnly, getDashboardStats);
router.get('/calculate-roi', ensureAuth, calculateRoiForAll);

module.exports = router;
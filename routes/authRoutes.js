const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const cloudinary = require('../config/cloudinary');
const authDB = require('../models/auth_schema');


const { ensureAuth } = require('../middleware/authMiddleware');
const {
  register,
  verifyEmail,
  login,
  googleLogin,
  googleRegister, // ✅ included here
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile
} = require('../controllers/authController');

// Register user with optional passport upload
router.post('/register', upload.single('passportCopy'), register);

// Verify email
router.get('/verify-email/:token', verifyEmail);

// Login
router.post('/login', login);

// Google Login
router.post('/google-login', googleLogin);

// Google-based Registration (no email input or verification needed)
router.post('/google-register', googleRegister); // ✅ route added

// Forgot Password
router.post('/forgot-password', forgotPassword);

// Reset Password
router.post('/reset-password', resetPassword);

// Get Profile
router.get('/me', ensureAuth, getProfile);

// Update Profile
router.put('/update-profile', ensureAuth, updateProfile);


// View Passport (authenticated access only)
router.get('/view-passport', ensureAuth, async (req, res) => {
  try {
    const user = await authDB.findById(req.user._id);
    if (!user || !user.passportCopy) {
      return res.status(404).json({ Success: false, Message: 'No passport found' });
    }

    // Only the user or an admin can view
    if (req.user.role !== 'admin' && req.user.email !== user.email) {
      return res.status(403).json({ Success: false, Message: 'Access denied' });
    }

    const secureUrl = cloudinary.url(user.passportCopy, {
      type: 'authenticated',
      sign_url: true,
      expires_at: Math.floor(Date.now() / 1000) + 600 // valid for 10 mins
    });

    res.json({ Success: true, passportUrl: secureUrl });
  } catch (error) {
    console.error('❌ Error viewing passport:', error.message);
    res.status(500).json({ Success: false, Message: 'Internal Server Error' });
  }
});



module.exports = router;
  
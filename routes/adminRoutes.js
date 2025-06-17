const express = require('express');
const router = express.Router();
const { register, verifyEmail } = require('../controllers/authController');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// Register user with optional passport upload
router.post('/register', upload.single('passportCopy'), register);

// Verify email
router.get('/verify-email/:token', verifyEmail);

module.exports = router;
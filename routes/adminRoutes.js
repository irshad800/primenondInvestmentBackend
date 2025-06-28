const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();
const { confirmPayment, updateKycStatus } = require('../controllers/adminController');

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  const adminCredentials = [
    {
      username: process.env.ADMIN1_USERNAME,
      password: process.env.ADMIN1_PASSWORD
    },
    {
      username: process.env.ADMIN2_USERNAME,
      password: process.env.ADMIN2_PASSWORD
    }
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

router.post('/confirm-payment', confirmPayment);
router.post('/kyc/update-status', updateKycStatus);

module.exports = router;
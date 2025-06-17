const authDB = require('../models/auth_schema');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendVerificationEmail } = require('../utils/emailService');
const { generateVerificationToken } = require('../utils/emailService');
const cloudinary = require('../config/cloudinary');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const register = async (req, res) => {
  try {
    const {
      username, password, name, email, phone,
      passportNumber, alternateContact, dob,
      country, street, unit, city, state, postalCode
    } = req.body;

    // Validate required fields
    if (!username || !password || !name || !email) {
      return res.status(400).json({ Success: false, Message: 'Missing required fields' });
    }

    // Check for existing user
    const query = { $or: [{ username }, { email }] };
    if (phone) query.$or.push({ phone });

    const existingUser = await authDB.findOne(query);
    if (existingUser) {
      return res.status(400).json({
        Success: false,
        Message: existingUser.email === email ? 'Email already in use' :
                existingUser.username === username ? 'Username already taken' :
                'Phone number already in use'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Upload passport to Cloudinary (if present)
    let passportCopy = null;
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'primebond/passports',
        type: 'private',
        resource_type: 'auto'
      });
      passportCopy = result.public_id;
    }

    // Generate verification token
    const verificationToken = generateVerificationToken();

    // Create and save user
    const newUser = new authDB({
      username,
      password: hashedPassword,
      name,
      email: email.trim().toLowerCase(),
      phone: phone || null,
      passportNumber: passportNumber || null,
      alternateContact: alternateContact || null,
      dob: dob ? new Date(dob) : null,
      country: country || null,
      street: street || null,
      unit: unit || null,
      city: city || null,
      state: state || null,
      postalCode: postalCode || null,
      verificationToken,
      verified: false,
      paymentStatus: 'unpaid',
      passportCopy
    });

    await newUser.save();

    // Send verification email
    await sendVerificationEmail(email.trim().toLowerCase(), verificationToken);

    return res.json({
      Success: true,
      Message: 'Registration successful. Please verify your email.'
    });
  } catch (error) {
    console.error(`❌ Registration Error: ${error.stack}`);
    return res.status(500).json({
      Success: false,
      Message: 'Internal Server Error',
      Error: error.message
    });
  }
};

const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    // Find user by verification token
    const user = await authDB.findOne({ verificationToken: token });

    if (!user) {
      console.log('Email verification failed: Invalid or expired token');
      return res.status(400).json({
        Success: false,
        Message: 'Invalid or expired token'
      });
    }

    // Update user as verified
    user.verified = true;
    user.verificationToken = '';
    await user.save();

    // Generate JWT token
    const authToken = jwt.sign(
      { _id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    console.log('✅ Email verified successfully for user:', user.username);

    // Redirect to front-end with token
    return res.redirect(`${process.env.BASE_URL}/verify-email.html?token=${authToken}`);
  } catch (error) {
    console.error('❌ Error in verify-email route:', error.message);
    return res.status(500).json({
      Success: false,
      Message: 'Internal Server Error',
      ErrorMessage: error.message
    });
  }
};

module.exports = { register, verifyEmail };
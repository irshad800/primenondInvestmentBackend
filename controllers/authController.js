const authDB = require('../models/auth_schema');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendVerificationEmail, generateVerificationToken, sendPasswordResetEmail } = require('../utils/emailService');
const cloudinary = require('../config/cloudinary');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const { bankingConfig } = require('../utils/bankingConfig');

const register = async (req, res) => {
  try {
    const {
      username, password, name, email, phone,
      passportNumber, alternateContact, dob,
      country, street, unit, city, state, postalCode
    } = req.body;

    // Step 1: Validate required fields
    if (!username || !password || !name || !email) {
      return res.status(400).json({ Success: false, Message: 'Missing required fields' });
    }

    // Step 2: Check if username, email, or phone already exists
    const query = { $or: [{ username }, { email: email.toLowerCase().trim() }] };
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

    // Step 3: Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Step 4: Handle passport file upload (if exists)
    let passportCopy = null;
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path, {
        folder: 'primebond/passports',
        type: 'authenticated',
        resource_type: 'auto'
      });
      passportCopy = result.public_id;
    }

    // Step 5: Generate verification token
    const verificationToken = generateVerificationToken();
    const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    console.log('🛠 Generated Token:', verificationToken);
    console.log('🛠 Generated Expiry:', verificationTokenExpiry);

    // Step 6: Determine if registration is complete
    const isCompleteRegistration = passportNumber && dob && phone && country && street;

    // Step 7: Create user object
    const newUser = new authDB({
      username,
      password: hashedPassword,
      name,
      email: email.toLowerCase().trim(),
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
      verificationTokenExpiry,
      verified: false,
      paymentStatus: 'unpaid',
      passportCopy,
      isPartiallyRegistered: !isCompleteRegistration, // Set to false if all required fields are provided
      kycApproved: false
    });

    // Step 8: Save user and verify save
    await newUser.save();
    console.log('✅ User saved to DB');

    // Step 9: Double-check token and expiry saved in DB
    const savedUser = await authDB.findOne({ email: email.toLowerCase().trim() });
    if (!savedUser) {
      console.error('❌ Failed to find user after save');
      return res.status(500).json({ Success: false, Message: 'Failed to save user' });
    }
    console.log('📦 Token in DB:', savedUser.verificationToken);
    console.log('📦 Expiry in DB:', savedUser.verificationTokenExpiry);
    console.log('📦 isPartiallyRegistered in DB:', savedUser.isPartiallyRegistered);

    if (savedUser.verificationToken !== verificationToken || !savedUser.verificationTokenExpiry) {
      console.error('❌ Token or expiry not saved correctly:', {
        savedToken: savedUser.verificationToken,
        savedExpiry: savedUser.verificationTokenExpiry
      });
      return res.status(500).json({ Success: false, Message: 'Failed to save verification details' });
    }

    // Step 10: Send verification email
    await sendVerificationEmail(email.toLowerCase().trim(), verificationToken);
    console.log('📨 Email sent with token:', verificationToken);

    // Step 11: Respond
    return res.json({
      Success: true,
      Message: 'Registration successful. Please verify your email.',
      User: {
        isPartiallyRegistered: savedUser.isPartiallyRegistered,
        kycApproved: savedUser.kycApproved,
        paymentStatus: savedUser.paymentStatus
      }
    });

  } catch (error) {
    console.error('❌ FULL ERROR:', error);
    return res.status(500).json({
      Success: false,
      Message: 'Internal Server Error',
      Error: error?.message || 'Unknown error occurred'
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ Success: false, Message: 'Email/Username/UserID and password are required' });
    }

    const loginId = email.trim();

    const user = await authDB.findOne({
      $or: [
        { email: loginId.toLowerCase() },
        { username: loginId },
        { userId: loginId }
      ]
    });

    if (!user) {
      return res.status(404).json({ Success: false, Message: 'User not found' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ Success: false, Message: 'Invalid credentials' });
    }

    if (!user.verified) {
      return res.status(403).json({ Success: false, Message: 'Please verify your email first' });
    }

    const token = jwt.sign(
      { _id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      Success: true,
      Message: 'Login successful',
      Token: token,
      User: {
        isPartiallyRegistered: user.isPartiallyRegistered,
        kycApproved: user.kycApproved,
        paymentStatus: user.paymentStatus || 'unpaid'
      }
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ Success: false, Message: 'Internal Server Error', Error: error.message });
  }
};

const googleLogin = async (req, res) => {
  try {
    console.log('Received Google login request:', req.body);
    const { token } = req.body;
    if (!token) return res.status(400).json({ Success: false, Message: 'Google token missing' });

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    console.log('Google token verified, payload:', ticket.getPayload());

    const payload = ticket.getPayload();
    const { email, name, sub } = payload;

    let user = await authDB.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = new authDB({
        username: email.split('@')[0],
        password: await bcrypt.hash(sub, 12),
        name,
        email: email.toLowerCase(),
        verified: true,
        paymentStatus: 'unpaid',
        isPartiallyRegistered: true,
        kycApproved: false
      });
      await user.save();
      console.log('New user created:', user._id);
    }

    const jwtToken = jwt.sign(
      { _id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      Success: true,
      Message: 'Google login successful',
      Token: jwtToken,
      User: {
        isPartiallyRegistered: user.isPartiallyRegistered,
        kycApproved: user.kycApproved,
        paymentStatus: user.paymentStatus || 'unpaid'
      }
    });
  } catch (error) {
    console.error('❌ Google Login error:', error.message);
    res.status(500).json({ Success: false, Message: 'Google login failed', Error: error.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const updates = req.body;
    delete updates.password;

    // Ensure isPartiallyRegistered is set to false if all required fields are provided
    if (updates.passportNumber && updates.dob && updates.phone && updates.country && updates.street) {
      updates.isPartiallyRegistered = false;
    }

    const updatedUser = await authDB.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true
    }).select('-password -verificationToken -resetToken -resetTokenExpiry');

    return res.json({
      Success: true,
      Message: 'Profile updated successfully',
      User: {
        ...updatedUser.toObject(),
        isPartiallyRegistered: updatedUser.isPartiallyRegistered,
        kycApproved: updatedUser.kycApproved,
        paymentStatus: updatedUser.paymentStatus
      }
    });
  } catch (error) {
    console.error('❌ Update profile error:', error);
    return res.status(500).json({ Success: false, Message: 'Profile update failed', Error: error.message });
  }
};

const googleRegister = async (req, res) => {
  try {
    const {
      username, name, email, phone,
      passportNumber, alternateContact, dob,
      country, street, unit, city, state, postalCode
    } = req.body;

    if (!username || !name || !email) {
      return res.status(400).json({ Success: false, Message: 'Missing required fields' });
    }

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

    const user = new authDB({
      username,
      password: await bcrypt.hash(crypto.randomBytes(10).toString('hex'), 12),
      name,
      email: email.toLowerCase(),
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
      verified: true,
      paymentStatus: 'unpaid',
      isPartiallyRegistered: true,
      kycApproved: false
    });

    await user.save();

    const jwtToken = jwt.sign(
      { _id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      Success: true,
      Message: 'Registration via Google successful',
      Token: jwtToken,
      User: {
        isPartiallyRegistered: user.isPartiallyRegistered,
        kycApproved: user.kycApproved,
        paymentStatus: user.paymentStatus
      }
    });
  } catch (error) {
    console.error('❌ Google registration error:', error.message);
    return res.status(500).json({ Success: false, Message: 'Internal Server Error', Error: error.message });
  }
};

const verifyEmail = async (req, res) => {
  try {
    let token = req.params.token;
    if (!token) return res.status(400).json({ Success: false, Message: 'Token missing' });

    token = decodeURIComponent(token.trim());

    console.log('🔍 Verifying token:', token);

    const user = await authDB.findOne({
      verificationToken: token,
      verificationTokenExpiry: { $gt: Date.now() }
    });

    if (!user) {
      const debug = await authDB.findOne({ verificationToken: token });
      if (debug) {
        console.log('⚠️ Token found but expired or invalid. Details:', {
          expiry: debug.verificationTokenExpiry,
          currentTime: new Date(),
          verifiedStatus: debug.verified
        });
      } else {
        console.log('❌ Token not found in database');
      }

      return res.status(400).json({ Success: false, Message: 'Invalid or expired token' });
    }

    user.verified = true;
    user.verificationToken = '';
    user.verificationTokenExpiry = null;
    await user.save();

    const authToken = jwt.sign(
      { _id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    return res.json({ Success: true, Message: 'Email verified', Token: authToken });
  } catch (error) {
    console.error('❌ Error in verify-email route:', error.message);
    return res.status(500).json({
      Success: false,
      Message: 'Internal Server Error',
      ErrorMessage: error.message
    });
  }
};


const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ Success: false, Message: 'Email is required' });

    const user = await authDB.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(404).json({ Success: false, Message: 'User not found' });

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 1000 * 60 * 15;

    user.resetToken = resetToken;
    user.resetTokenExpiry = expiry;
    await user.save();

    await sendPasswordResetEmail(user.email, resetToken);

    return res.json({ Success: true, Message: 'Reset link sent to email' });
  } catch (error) {
    console.error('❌ Forgot password error:', error);
    return res.status(500).json({ Success: false, Message: 'Internal Server Error' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const user = await authDB.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() }
    });

    if (!user) return res.status(400).json({ Success: false, Message: 'Invalid or expired token' });

    user.password = await bcrypt.hash(newPassword, 12);
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();

    return res.json({ Success: true, Message: 'Password reset successful' });
  } catch (error) {
    console.error('❌ Reset password error:', error);
    return res.status(500).json({ Success: false, Message: 'Internal Server Error' });
  }
};

const getProfile = async (req, res) => {
  try {
    const user = await authDB.findById(req.user._id).select('-password -verificationToken -resetToken -resetTokenExpiry');
    if (!user) {
      return res.status(404).json({ Success: false, Message: 'User not found' });
    }

    return res.json({
      Success: true,
      User: {
        ...user.toObject(),
        isPartiallyRegistered: user.isPartiallyRegistered,
        kycApproved: user.kycApproved,
        paymentStatus: user.paymentStatus
      }
    });
  } catch (error) {
    console.error('❌ Get profile error:', error);
    return res.status(500).json({ Success: false, Message: 'Failed to fetch user profile' });
  }
};

const setRoiPayoutMethod = async (req, res) => {
  try {
    const { roiPayoutMethod, bankDetails, cryptoDetails, country } = req.body;

    if (!roiPayoutMethod || !['bank', 'crypto', 'cash'].includes(roiPayoutMethod)) {
      return res.status(400).json({ Success: false, Message: 'Invalid or missing ROI payout method' });
    }

    const user = await authDB.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ Success: false, Message: 'User not found' });
    }

    user.roiPayoutMethod = roiPayoutMethod;

    if (roiPayoutMethod === 'bank') {
      if (!bankDetails || !country) {
        return res.status(400).json({ Success: false, Message: 'Bank details and country are required' });
      }

      const countryConfig = bankingConfig[country.toLowerCase()] || bankingConfig['default'];
      const bankDetailsKeys = Object.keys(bankDetails);

      const missingFields = countryConfig.required.filter(field => !bankDetailsKeys.includes(field) || !bankDetails[field]);
      if (missingFields.length > 0) {
        return res.status(400).json({
          Success: false,
          Message: `Missing required bank details for ${country}: ${missingFields.join(', ')}`
        });
      }

      user.bankDetails = {
        accountHolderName: bankDetails.accountHolderName || null,
        accountNumber: bankDetails.accountNumber || null,
        bankName: bankDetails.bankName || null,
        iban: bankDetails.iban || null,
        swiftCode: bankDetails.swiftCode || null,
        ifscCode: bankDetails.ifscCode || null,
        sortCode: bankDetails.sortCode || null,
        routingNumber: bankDetails.routingNumber || null
      };

      user.cryptoDetails = { walletAddress: null, coinType: null };
    } else if (roiPayoutMethod === 'crypto') {
      if (!cryptoDetails || !cryptoDetails.walletAddress || !cryptoDetails.coinType) {
        return res.status(400).json({ Success: false, Message: 'Missing required crypto details' });
      }
      user.cryptoDetails = {
        walletAddress: cryptoDetails.walletAddress,
        coinType: cryptoDetails.coinType
      };
      user.bankDetails = {
        accountHolderName: null,
        accountNumber: null,
        bankName: null,
        iban: null,
        swiftCode: null,
        ifscCode: null,
        sortCode: null,
        routingNumber: null
      };
    } else if (roiPayoutMethod === 'cash') {
      user.bankDetails = {
        accountHolderName: null,
        accountNumber: null,
        bankName: null,
        iban: null,
        swiftCode: null,
        ifscCode: null,
        sortCode: null,
        routingNumber: null
      };
      user.cryptoDetails = { walletAddress: null, coinType: null };
    }

    // Initialize payoutHistory if not exists
    if (!user.payoutHistory) {
      user.payoutHistory = [];
    }
    user.payoutHistory.push({
      method: user.roiPayoutMethod,
      bankDetails: { ...user.bankDetails },
      cryptoDetails: { ...user.cryptoDetails },
      updatedAt: new Date()
    });

    await user.save();

    return res.json({
      Success: true,
      Message: 'ROI payout method set successfully',
      Data: {
        roiPayoutMethod: user.roiPayoutMethod,
        bankDetails: user.bankDetails,
        cryptoDetails: user.cryptoDetails,
        payoutHistory: user.payoutHistory
      }
    });
  } catch (error) {
    console.error('❌ Set ROI Payout Method Error:', error.message);
    return res.status(500).json({ Success: false, Message: 'Internal Server Error', Error: error.message });
  }
};

const updateRoiPayoutMethod = async (req, res) => {
  try {
    const { roiPayoutMethod, bankDetails, cryptoDetails, country, updateReason } = req.body;

    if (!roiPayoutMethod || !['bank', 'crypto', 'cash'].includes(roiPayoutMethod)) {
      return res.status(400).json({ Success: false, Message: 'Invalid or missing ROI payout method' });
    }
    if (!updateReason || typeof updateReason !== 'string' || updateReason.trim() === '') {
      return res.status(400).json({ Success: false, Message: 'Update reason is required' });
    }

    const user = await authDB.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ Success: false, Message: 'User not found' });
    }

    // Store previous details in payoutHistory
    if (!user.payoutHistory) {
      user.payoutHistory = [];
    }
    user.payoutHistory.push({
      method: user.roiPayoutMethod,
      bankDetails: { ...user.bankDetails },
      cryptoDetails: { ...user.cryptoDetails },
      updatedAt: new Date(),
      reason: updateReason
    });

    // Update the current payout method
    user.roiPayoutMethod = roiPayoutMethod;

    if (roiPayoutMethod === 'bank') {
      if (!bankDetails || !country) {
        return res.status(400).json({ Success: false, Message: 'Bank details and country are required' });
      }

      const countryConfig = bankingConfig[country.toLowerCase()] || bankingConfig['default'];
      const bankDetailsKeys = Object.keys(bankDetails);

      const missingFields = countryConfig.required.filter(field => !bankDetailsKeys.includes(field) || !bankDetails[field]);
      if (missingFields.length > 0) {
        return res.status(400).json({
          Success: false,
          Message: `Missing required bank details for ${country}: ${missingFields.join(', ')}`
        });
      }

      user.bankDetails = {
        ...user.bankDetails, // Retain previous details
        accountHolderName: bankDetails.accountHolderName || user.bankDetails.accountHolderName,
        accountNumber: bankDetails.accountNumber || user.bankDetails.accountNumber,
        bankName: bankDetails.bankName || user.bankDetails.bankName,
        iban: bankDetails.iban || user.bankDetails.iban,
        swiftCode: bankDetails.swiftCode || user.bankDetails.swiftCode,
        ifscCode: bankDetails.ifscCode || user.bankDetails.ifscCode,
        sortCode: bankDetails.sortCode || user.bankDetails.sortCode,
        routingNumber: bankDetails.routingNumber || user.bankDetails.routingNumber
      };

      user.cryptoDetails = { walletAddress: null, coinType: null };
    } else if (roiPayoutMethod === 'crypto') {
      if (!cryptoDetails || !cryptoDetails.walletAddress || !cryptoDetails.coinType) {
        return res.status(400).json({ Success: false, Message: 'Missing required crypto details' });
      }
      user.cryptoDetails = {
        ...user.cryptoDetails, // Retain previous details
        walletAddress: cryptoDetails.walletAddress || user.cryptoDetails.walletAddress,
        coinType: cryptoDetails.coinType || user.cryptoDetails.coinType
      };
      user.bankDetails = {
        accountHolderName: null,
        accountNumber: null,
        bankName: null,
        iban: null,
        swiftCode: null,
        ifscCode: null,
        sortCode: null,
        routingNumber: null
      };
    } else if (roiPayoutMethod === 'cash') {
      user.bankDetails = {
        accountHolderName: null,
        accountNumber: null,
        bankName: null,
        iban: null,
        swiftCode: null,
        ifscCode: null,
        sortCode: null,
        routingNumber: null
      };
      user.cryptoDetails = { walletAddress: null, coinType: null };
    }

    await user.save();

    return res.json({
      Success: true,
      Message: 'ROI payout method updated successfully',
      Data: {
        roiPayoutMethod: user.roiPayoutMethod,
        bankDetails: user.bankDetails,
        cryptoDetails: user.cryptoDetails,
        payoutHistory: user.payoutHistory
      }
    });
  } catch (error) {
    console.error('❌ Update ROI Payout Method Error:', error.message);
    return res.status(500).json({ Success: false, Message: 'Internal Server Error', Error: error.message });
  }
};

module.exports = {
  register,
  verifyEmail,
  login,
  googleLogin,
  googleRegister,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
  setRoiPayoutMethod,
  updateRoiPayoutMethod
};
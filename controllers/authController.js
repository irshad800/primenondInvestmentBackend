const authDB = require('../models/auth_schema');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendVerificationEmail, generateVerificationToken, sendPasswordResetEmail } = require('../utils/emailService');
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

    if (!username || !password || !name || !email) {
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

    const hashedPassword = await bcrypt.hash(password, 12);
    let passportCopy = null;

    if (req.file) {
    const result = await cloudinary.uploader.upload(req.file.path, {
  folder: 'primebond/passports',
  type: 'authenticated', // ✅ makes file private
  resource_type: 'auto'
});

      passportCopy = result.public_id;
    }

    const verificationToken = generateVerificationToken();

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
    await sendVerificationEmail(email.trim().toLowerCase(), verificationToken);

    return res.json({
      Success: true,
      Message: 'Registration successful. Please verify your email.'
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
      return res.status(400).json({ Success: false, Message: 'Email and password are required' });
    }

    const user = await authDB.findOne({ email: email.trim().toLowerCase() });
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
      paymentStatus: user.paymentStatus || 'unpaid'
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ Success: false, Message: 'Internal Server Error', Error: error.message });
  }
};

const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const googleLogin = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) return res.status(400).json({ Success: false, Message: 'Google token missing' });

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

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
        paymentStatus: 'unpaid'
      });
      await user.save();
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
      paymentStatus: user.paymentStatus || 'unpaid'
    });
  } catch (error) {
    console.error('❌ Google Login error:', error.message);
    res.status(500).json({ Success: false, Message: 'Google login failed', Error: error.message });
  }
};

//google - register


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
      password: await bcrypt.hash(crypto.randomBytes(10).toString('hex'), 12), // random
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
      verified: true, // ✅ skip verification
      paymentStatus: 'unpaid'
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
      paymentStatus: user.paymentStatus
    });
  } catch (error) {
    console.error('❌ Google registration error:', error.message);
    return res.status(500).json({ Success: false, Message: 'Internal Server Error', Error: error.message });
  }
};


const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    console.log('Received verification token:', token);

    const user = await authDB.findOne({ verificationToken: token });
    console.log('User found:', user ? user.email : 'No user found');

    if (!user) {
      return res.status(400).json({ Success: false, Message: 'Invalid or expired token' });
    }

    user.verified = true;
    user.verificationToken = '';
    console.log('Updating user:', { email: user.email, verified: true });
    await user.save();
    console.log('User saved successfully');

    const authToken = jwt.sign(
      { _id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const redirectUrl = `http://127.0.0.1:5500/reset-password.html?token=${authToken}`;
    console.log('Redirecting to:', redirectUrl);
    return res.redirect(redirectUrl);
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

    return res.json({ Success: true, User: user });
  } catch (error) {
    console.error('❌ Get profile error:', error);
    return res.status(500).json({ Success: false, Message: 'Failed to fetch user profile' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const updates = req.body;
    delete updates.password; // Don't allow password update here

    const updatedUser = await authDB.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true
    });

    return res.json({ Success: true, Message: 'Profile updated successfully', User: updatedUser });
  } catch (error) {
    console.error('❌ Update profile error:', error);
    return res.status(500).json({ Success: false, Message: 'Profile update failed', Error: error.message });
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
  updateProfile
};

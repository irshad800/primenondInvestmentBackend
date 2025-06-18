const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    unique: true,
    sparse: true
  },
  passportNumber: {
    type: String,
    unique: true,
    sparse: true
  },
  alternateContact: {
    type: String
  },
  dob: {
    type: Date
  },
  country: {
    type: String
  },
  street: {
    type: String
  },
  resetToken: {
  type: String,
  default: null
},
resetTokenExpiry: {
  type: Date,
  default: null
},

  unit: {
    type: String
  },
  city: {
    type: String
  },
  state: {
    type: String
  },
  postalCode: {
    type: String
  },
  verificationToken: {
    type: String,
    default: ''
  },
  verified: {
    type: Boolean,
    default: false
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'pending', 'success'],
    default: 'unpaid'
  },
  paymentMethod: {
    type: String,
    enum: ['bank', 'card', 'walletcrypto', null],
    default: null
  },
  transactionId: {
    type: String,
    default: null
  },
  lastPaymentLink: {
    type: String,
    default: null
  },
  cryptoCoin: {
    type: String,
    default: null
  },
  userId: {
    type: String,
    unique: true,
    sparse: true
  },
  passportCopy: {
    type: String,
    default: null
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('auth', UserSchema);
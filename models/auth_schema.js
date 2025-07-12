  // auth_schema.js
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
      type: String // Added to store country during registration
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
    verificationTokenExpiry: {
  type: Date,
  default: null
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
      enum: ['bank', 'cash', 'card', 'walletcrypto', null],
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
    selectedPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InvestmentPlan',
      default: null
    },
    selectedInvestmentAmount: {
      type: Number,
      default: 0
    },
    selectedPlanName: {
      type: String,
      default: null
    },
    roiPayoutMethod: {
      type: String,
      enum: ['bank', 'crypto', 'cash', null],
      default: null
    },
    bankDetails: {
      accountHolderName: { type: String, default: null },
      accountNumber: { type: String, default: null },
      bankName: { type: String, default: null },
      iban: { type: String, default: null },
      swiftCode: { type: String, default: null },
      ifscCode: { type: String, default: null }, // For India
      sortCode: { type: String, default: null }, // For UK
      routingNumber: { type: String, default: null } // For US
    },
    cryptoDetails: {
      walletAddress: { type: String, default: null },
      coinType: { type: String, default: null }
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    isPartiallyRegistered: {
      type: Boolean,
      default: true // Default to true for new users (e.g., Google login)
    },
    kycApproved: {
      type: Boolean,
      default: false // Default to false until KYC is approved
    }
  });

  module.exports = mongoose.model('auth', UserSchema);
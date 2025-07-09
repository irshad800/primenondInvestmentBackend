const mongoose = require('mongoose');

const kycSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'auth', required: true },
  idType: String,
  idNumber: String,
  issuingCountry: String,
  dateOfIssue: Date,
  dateOfExpiry: Date,
  idDocumentUrl: String,
  selfieUrl: String,
  declarationConfirmed: Boolean,
  amlConsent: Boolean,
  termsAccepted: Boolean,
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  adminMessage: { type: String, default: '' }, // Ensure default is set
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Kyc', kycSchema);
const express = require('express');
const router = express.Router();
const Kyc = require('../models/Kyc');
const upload = require('../middleware/upload');
const auth = require('../middleware/authMiddleware');
const path = require('path');
const fs = require('fs'); // ✅ You missed this line earlier

// 📝 Submit KYC
router.post('/kyc', auth.ensureAuth, upload.fields([
  { name: 'idDocument', maxCount: 1 },
  { name: 'selfie', maxCount: 1 }
]), async (req, res) => {
  try {
    const { idType, idNumber, issuingCountry, dateOfIssue, dateOfExpiry, declarationConfirmed, amlConsent, termsAccepted } = req.body;
    const userId = req.user._id;

    const existingKyc = await Kyc.findOne({ userId });
    if (existingKyc && existingKyc.status === 'pending') {
      return res.status(400).json({
        success: false,
        error: 'You already have a pending KYC submission. Please wait for admin approval.'
      });
    }

    if (!idType || !idNumber || !issuingCountry || !dateOfIssue || !dateOfExpiry || !declarationConfirmed || !amlConsent || !termsAccepted) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }

    const idDocument = req.files['idDocument']?.[0];
    const selfie = req.files['selfie']?.[0];
    if (!idDocument || !selfie) {
      return res.status(400).json({ success: false, error: 'Both ID document and selfie are required.' });
    }

    const validIdTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    const validSelfieTypes = ['image/jpeg', 'image/png'];
    if (!validIdTypes.includes(idDocument.mimetype) || !validSelfieTypes.includes(selfie.mimetype)) {
      return res.status(400).json({ success: false, error: 'Invalid file type. ID must be JPEG, PNG, or PDF; Selfie must be JPEG or PNG.' });
    }

    const kyc = new Kyc({
      userId,
      idType,
      idNumber,
      issuingCountry,
      dateOfIssue: new Date(dateOfIssue),
      dateOfExpiry: new Date(dateOfExpiry),
      idDocumentUrl: `uploads/kyc/${idDocument.filename}`,
      selfieUrl: `uploads/kyc/${selfie.filename}`,
      declarationConfirmed: declarationConfirmed === 'true',
      amlConsent: amlConsent === 'true',
      termsAccepted: termsAccepted === 'true',
      status: 'pending'
    });

    await kyc.save();
    res.status(201).json({ success: true, message: 'KYC submitted successfully. Awaiting admin approval.' });
  } catch (error) {
    console.error('❌ KYC Submission Error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// 📄 Get All KYC (Admin)
router.get('/admin/all', auth.ensureAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied. Admin role required.' });
    }

    const kycRecords = await Kyc.find().populate('userId', 'email name role');
    res.json({ success: true, data: kycRecords });
  } catch (error) {
    console.error('❌ Fetch KYC Records Error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// 📄 Get KYC by ID (Admin)
router.get('/admin/:kycId', auth.ensureAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied. Admin role required.' });
    }

    const kyc = await Kyc.findById(req.params.kycId).populate('userId', 'email name role');
    if (!kyc) {
      return res.status(404).json({ success: false, error: 'KYC record not found.' });
    }

    res.json({ success: true, data: kyc });
  } catch (error) {
    console.error('❌ Fetch KYC Detail Error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// 📁 Serve KYC File (Admin Only)
router.get('/uploads/:fileName', auth.ensureAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied. Admin role required.' });
    }

    const fileName = req.params.fileName;

    const kyc = await Kyc.findOne({
      $or: [
        { idDocumentUrl: { $regex: fileName } },
        { selfieUrl: { $regex: fileName } }
      ]
    });

    if (!kyc) {
      return res.status(403).json({ success: false, error: 'Access to this file is not authorized.' });
    }

    const filePath = path.join(__dirname, '..', 'uploads', 'kyc', fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    return res.sendFile(filePath);
  } catch (error) {
    console.error('❌ File Serve Error:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});


module.exports = router;
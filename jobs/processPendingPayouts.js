const mongoose = require('mongoose');
const Return = require('../models/Return');
const Investment = require('../models/Investment');
const Roi = require('../models/Roi');
const authDB = require('../models/auth_schema');

const processPendingPayouts = async () => {
  try {
    console.log('⏰ Starting ROI payout processing...');
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0); // Normalize time

    // Find all Return records that are still pending but the payout date has arrived
    const pendingReturns = await Return.find({
      status: 'pending',
      payoutDate: { $lte: currentDate }
    });

    for (const returnRecord of pendingReturns) {
      const { userId, investmentId, _id: returnId } = returnRecord;

      const user = await authDB.findById(userId);
      if (!user || !user.roiPayoutMethod) {
        console.error(`❌ Skipping returnId=${returnId}: Missing user or ROI payout method`);
        continue;
      }

      const investment = await Investment.findById(investmentId);
      if (!investment) {
        console.error(`❌ Skipping returnId=${returnId}: Investment not found`);
        continue;
      }

      const roi = await Roi.findOne({ userId, investmentId });
      if (!roi) {
        console.error(`❌ Skipping returnId=${returnId}: ROI record not found`);
        continue;
      }

      // ✅ Instead of marking as 'paid', mark as 'due'
      returnRecord.status = 'due';
      await returnRecord.save();

      console.log(`🕓 Marked return as due: returnId=${returnId}, userId=${userId}, investmentId=${investmentId}`);
    }

    console.log('✅ ROI payout due marking completed.');
  } catch (error) {
    console.error(`❌ Error in processPendingPayouts: ${error.message}`, error);
  }
};

module.exports = processPendingPayouts;

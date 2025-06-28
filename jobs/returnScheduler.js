const cron = require('node-cron');
const Investment = require('../models/Investment');
const Return = require('../models/Return');
const { calculateReturnAmount, calculateNextPayoutDate } = require('../utils/calculateReturn');
const InvestmentPlan = require('../models/InvestmentPlan');

// Schedule daily at 00:00
cron.schedule('0 0 * * *', async () => {
  console.log('📅 Running monthly return scheduler...');

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const investments = await Investment.find({
      status: 'active',
      nextPayoutDate: { $lte: today }
    }).populate('planId');

    for (const investment of investments) {
      const plan = investment.planId;
      const returnAmount = calculateReturnAmount(investment.amount, plan.returnRate);

      // Create return record
      const returnRecord = new Return({
        userId: investment.userId,
        investmentId: investment._id,
        amount: returnAmount,
        payoutDate: today
      });
      await returnRecord.save();

      // Update investment
      investment.payoutsMade += 1;
      if (investment.payoutsMade >= investment.totalPayouts) {
        investment.status = 'completed';
      } else {
        investment.nextPayoutDate = calculateNextPayoutDate(today);
      }
      investment.updatedAt = new Date();
      await investment.save();

      console.log(`✅ Processed monthly return for investment ${investment._id}: $${returnAmount}`);
    }

    console.log('✅ Monthly return scheduler completed.');
  } catch (error) {
    console.error('❌ Return Scheduler Error:', error);
  }
});
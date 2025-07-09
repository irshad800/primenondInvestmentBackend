const calculateReturnAmount = (amount, returnRate) => {
  if (typeof amount !== 'number' || typeof returnRate !== 'number' || amount < 0 || returnRate < 0) {
    console.warn(`⚠️ Invalid inputs for calculateReturnAmount: amount=${amount}, returnRate=${returnRate}`);
    return 0;
  }
  return (amount * returnRate) / 100;
};

const calculateNextPayoutDate = (payoutOption = 'monthly', currentDate = new Date()) => {
  const validOptions = ['monthly', 'annually'];
  if (!validOptions.includes(payoutOption)) {
    console.warn(`⚠️ Invalid payoutOption: ${payoutOption}, defaulting to monthly`);
    payoutOption = 'monthly';
  }

  const nextDate = new Date(currentDate);
  if (payoutOption === 'annually') {
    nextDate.setFullYear(nextDate.getFullYear() + 1);
  } else {
    nextDate.setMonth(nextDate.getMonth() + 1);
  }
  console.log(`✅ Calculated next payout date: ${nextDate}, for payoutOption=${payoutOption}`);
  return nextDate;
};

module.exports = { calculateReturnAmount, calculateNextPayoutDate };
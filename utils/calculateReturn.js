const calculateReturnAmount = (amount, rate, payoutOption = 'monthly') => {
  console.log(`Calculating return: amount=${amount}, rate=${rate}, payoutOption=${payoutOption}`);
  if (typeof amount !== 'number' || typeof rate !== 'number' || amount < 0 || rate < 0) {
    console.warn(`⚠️ Invalid inputs for calculateReturnAmount: amount=${amount}, rate=${rate}, payoutOption=${payoutOption}`);
    return 0;
  }
  const result = (amount * rate) / 100;
  console.log(`Calculated return: ${result}`);
  return result;
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
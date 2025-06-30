const calculateReturnAmount = (amount, returnRate) => {
  return (amount * returnRate) / 100;
};

const calculateNextPayoutDate = (payoutOption = 'monthly', currentDate = new Date()) => {
  const nextDate = new Date(currentDate);
  if (payoutOption === 'annually') {
    nextDate.setFullYear(nextDate.getFullYear() + 1);
  } else {
    nextDate.setMonth(nextDate.getMonth() + 1);
  }
  return nextDate;
};

module.exports = { calculateReturnAmount, calculateNextPayoutDate };

const calculateReturnAmount = (amount, returnRate) => {
  return (amount * returnRate) / 100;
};

const calculateNextPayoutDate = (currentDate = new Date()) => {
  const nextDate = new Date(currentDate);
  nextDate.setMonth(nextDate.getMonth() + 1);
  return nextDate;
};

module.exports = { calculateReturnAmount, calculateNextPayoutDate };
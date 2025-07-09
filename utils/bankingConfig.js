// utils/bankingConfig.js
const bankingConfig = {
  'india': {
    required: ['accountHolderName', 'accountNumber', 'bankName', 'ifscCode'],
    optional: ['swiftCode']
  },
  'united kingdom': {
    required: ['accountHolderName', 'accountNumber', 'bankName', 'sortCode'],
    optional: ['iban', 'swiftCode']
  },
  'united states': {
    required: ['accountHolderName', 'accountNumber', 'bankName', 'routingNumber'],
    optional: ['swiftCode']
  },
  'germany': {
    required: ['accountHolderName', 'accountNumber', 'bankName', 'iban'],
    optional: ['swiftCode']
  },
  'default': {
    required: ['accountHolderName', 'accountNumber', 'bankName', 'iban'],
    optional: ['swiftCode']
  }
};

module.exports = { bankingConfig };
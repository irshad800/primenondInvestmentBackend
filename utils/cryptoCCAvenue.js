<<<<<<< HEAD
const crypto = require('crypto');
const iv = '0123456789abcdef';

exports.encrypt = (plainText, workingKey) => {
  const cipher = crypto.createCipheriv('aes-128-cbc', workingKey, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

exports.decrypt = (encText, workingKey) => {
  const decipher = crypto.createDecipheriv('aes-128-cbc', workingKey, iv);
  let decrypted = decipher.update(encText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};
=======
const crypto = require('crypto');
const iv = '0123456789abcdef';

exports.encrypt = (plainText, workingKey) => {
  const cipher = crypto.createCipheriv('aes-128-cbc', workingKey, iv);
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

exports.decrypt = (encText, workingKey) => {
  const decipher = crypto.createDecipheriv('aes-128-cbc', workingKey, iv);
  let decrypted = decipher.update(encText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};
>>>>>>> 45d1eeeec13fa94e11488e703d8349afb96a9770

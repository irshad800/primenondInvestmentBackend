const crypto = require('crypto');

exports.encrypt = function (plainText, workingKey) {
    const m = crypto.createHash('md5');
    m.update(workingKey);
    const key = Buffer.from(m.digest('latin1'), 'latin1');
    const iv = Buffer.from('\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f', 'binary');
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    let encoded = cipher.update(plainText, 'utf8', 'hex');
    encoded += cipher.final('hex');
    return encoded;
};

exports.decrypt = function (encText, workingKey) {
    const m = crypto.createHash('md5');
    m.update(workingKey);
    const key = Buffer.from(m.digest('latin1'), 'latin1');
    const iv = Buffer.from('\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f', 'binary');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    let decoded = decipher.update(encText, 'hex', 'utf8');
    decoded += decipher.final('utf8');
    return decoded;
};

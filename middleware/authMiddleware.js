const jwt = require('jsonwebtoken');

const ensureAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        Success: false,
        Message: 'Authentication token required'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded; // Attach user data to request
    next();
  } catch (error) {
    console.error('❌ Authentication Error:', error.message);
    return res.status(401).json({
      Success: false,
      Message: 'Invalid or expired token'
    });
  }
};

module.exports = { ensureAuth };
const jwt = require('jsonwebtoken');

const ensureAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication token required'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Allow either a user (_id required) or an admin (role === 'admin')
    if (!decoded || (!decoded._id && decoded.role !== 'admin')) {
      return res.status(403).json({
        success: false,
        error: 'Invalid token payload'
      });
    }

    req.user = decoded; // Attach user/admin info to request
    next();
  } catch (error) {
    console.error('❌ Authentication Error:', error.message);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token'
    });
  }
};

module.exports = { ensureAuth };
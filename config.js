// Load .env for local dev
// In production, env vars are set directly in the platform
require('dotenv').config();

module.exports = {
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',
  PORT: process.env.PORT || 3001
};

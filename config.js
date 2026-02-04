const path = require('path');

// Load .env from parent directory (for local dev)
// In production, env vars are set directly in the platform
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
  MONGODB_URI: process.env.MONGODB_URI,
  MASTER_DB_NAME: process.env.MASTER_DB_NAME || 'shalset-master',
  DEFAULT_COMPANY_SLUG: process.env.DEFAULT_COMPANY_SLUG || 'barcode',
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',
  PORT: process.env.PORT || 3001
};

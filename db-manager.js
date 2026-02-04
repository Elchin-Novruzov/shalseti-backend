const mongoose = require('mongoose');
const config = require('./config');

// Cache for database connections
const connectionCache = new Map();

// Get base MongoDB URI (without database name)
function getBaseUri() {
  const uri = config.MONGODB_URI;
  // Remove database name from URI if present
  // Format: mongodb://user:pass@host:port/database?options
  const match = uri.match(/^(mongodb(?:\+srv)?:\/\/[^\/]+)\/?([^?]*)?(\?.*)?$/);
  if (match) {
    return {
      base: match[1],
      options: match[3] || ''
    };
  }
  return { base: uri, options: '' };
}

// Get or create a connection to a specific company database
async function getCompanyConnection(companySlug) {
  // Check cache first
  if (connectionCache.has(companySlug)) {
    const cachedConn = connectionCache.get(companySlug);
    if (cachedConn.readyState === 1) { // Connected
      return cachedConn;
    }
    // Remove stale connection
    connectionCache.delete(companySlug);
  }

  const { base, options } = getBaseUri();
  const dbUri = `${base}/${companySlug}${options}`;
  
  console.log(`[DB Manager] Creating connection for company: ${companySlug}`);
  
  const connection = await mongoose.createConnection(dbUri);
  
  // Register models on this connection
  registerModels(connection);
  
  // Cache the connection
  connectionCache.set(companySlug, connection);
  
  console.log(`[DB Manager] Connected to database: ${companySlug}`);
  
  return connection;
}

// Register all company-specific models on a connection
function registerModels(connection) {
  // Product schema
  const stockHistorySchema = new mongoose.Schema({
    quantity: { type: Number, required: true },
    type: { type: String, enum: ['add', 'remove'], required: true },
    note: { type: String, default: '' },
    supplier: { type: String, default: '' },
    location: { type: String, default: '' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    addedByName: { type: String },
    createdAt: { type: Date, default: Date.now }
  });

  const productSchema = new mongoose.Schema({
    barcode: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    currentStock: { type: Number, default: 0, min: 0 },
    note: { type: String, default: '' },
    buyingPrice: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, default: 0, min: 0 },
    boughtFrom: { type: String, default: '', trim: true },
    sellLocation: { type: String, default: '', trim: true },
    imageUrl: { type: String, default: '' },
    unit: { type: String, default: 'pcs', trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    categoryName: { type: String, default: '' },
    stockHistory: [stockHistorySchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }, {
    toJSON: {
      transform: function(doc, ret) {
        if (!ret.unit) ret.unit = 'pcs';
        return ret;
      }
    },
    toObject: {
      transform: function(doc, ret) {
        if (!ret.unit) ret.unit = 'pcs';
        return ret;
      }
    }
  });

  productSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    if (!this.unit) this.unit = 'pcs';
    next();
  });

  // Category schema
  const categorySchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '', trim: true },
    color: { type: String, default: '#3b82f6' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String }
  }, { timestamps: true });

  // Scan schema
  const scanSchema = new mongoose.Schema({
    barcode: { type: String, required: true, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    userFullName: { type: String, required: true },
    scannedAt: { type: Date, default: Date.now },
    scanMode: { type: String, enum: ['keyboard', 'camera'], default: 'keyboard' },
    deviceInfo: { type: String, default: null },
    location: { type: String, default: null }
  });

  scanSchema.index({ user: 1, scannedAt: -1 });
  scanSchema.index({ barcode: 1 });
  scanSchema.index({ scannedAt: -1 });

  // Register models on the connection
  if (!connection.models.Product) {
    connection.model('Product', productSchema);
  }
  if (!connection.models.Category) {
    connection.model('Category', categorySchema);
  }
  if (!connection.models.Scan) {
    connection.model('Scan', scanSchema);
  }
}

// Get the master database connection (for users and companies)
async function getMasterConnection() {
  const masterDbName = config.MASTER_DB_NAME || 'shalset-master';
  return getCompanyConnection(masterDbName);
}

// Close all connections (for graceful shutdown)
async function closeAllConnections() {
  console.log('[DB Manager] Closing all connections...');
  for (const [slug, connection] of connectionCache) {
    await connection.close();
    console.log(`[DB Manager] Closed connection: ${slug}`);
  }
  connectionCache.clear();
}

// Get connection status
function getConnectionStatus() {
  const status = {};
  for (const [slug, connection] of connectionCache) {
    status[slug] = {
      readyState: connection.readyState,
      status: ['disconnected', 'connected', 'connecting', 'disconnecting'][connection.readyState]
    };
  }
  return status;
}

module.exports = {
  getCompanyConnection,
  getMasterConnection,
  closeAllConnections,
  getConnectionStatus,
  connectionCache
};

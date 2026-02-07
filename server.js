const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const config = require('./config');
const User = require('./models/User');
const Company = require('./models/Company');
const { getCompanyConnection, getConnectionStatus } = require('./db-manager');

// Legacy model imports (for backward compatibility during migration)
const Scan = require('./models/Scan');
const Product = require('./models/Product');
const Category = require('./models/Category');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Connect to MongoDB (master database for users and companies)
function getMasterDbUri() {
  let uri = config.MONGODB_URI;
  const masterDb = config.MASTER_DB_NAME || 'shalset-master';
  if (uri.includes('?')) {
    uri = uri.replace('/?', '/' + masterDb + '?');
  } else {
    uri = uri.replace(/\/$/, '') + '/' + masterDb;
  }
  return uri;
}

mongoose.connect(getMasterDbUri())
  .then(() => console.log('Connected to MongoDB (master database)'))
  .catch(err => console.error('MongoDB connection error:', err));

// ============ AUTO CLEANUP SCHEDULER ============
// Production: Delete scans older than 3 days, runs once daily at midnight
const CLEANUP_INTERVAL_DAYS = 3;

cron.schedule('0 0 * * *', async () => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_INTERVAL_DAYS);
    
    const result = await Scan.deleteMany({
      scannedAt: { $lt: cutoffDate }
    });
    
    if (result.deletedCount > 0) {
      console.log(`[CLEANUP] Deleted ${result.deletedCount} scans older than ${CLEANUP_INTERVAL_DAYS} day(s)`);
    }
  } catch (error) {
    console.error('[CLEANUP] Error:', error);
  }
});

console.log(`[CLEANUP] Auto-cleanup scheduled: daily at midnight, deleting scans older than ${CLEANUP_INTERVAL_DAYS} days`);

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN
  });
};

// Auth middleware
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Admin middleware - requires admin role
const adminMiddleware = async (req, res, next) => {
  if (req.user.role !== 'admin' && !req.user.isSuperAdmin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Super admin middleware - requires super admin role
const superAdminMiddleware = async (req, res, next) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ message: 'Super admin access required' });
  }
  next();
};

// Company middleware - validates and sets up company database connection
const companyMiddleware = async (req, res, next) => {
  try {
    const companySlug = req.headers['x-company-slug'];
    
    // If no company header, use default (backward compatibility)
    if (!companySlug) {
      req.companySlug = config.DEFAULT_COMPANY_SLUG;
    } else {
      req.companySlug = companySlug;
    }
    
    // Check if user has access to this company (unless super admin)
    if (!req.user.isSuperAdmin) {
      const hasAccess = req.user.companyAccess?.some(ca => ca.companySlug === req.companySlug);
      // Also check legacy access (if user has no companyAccess set, allow default)
      const legacyAccess = !req.user.companyAccess || req.user.companyAccess.length === 0;
      
      if (!hasAccess && !legacyAccess) {
        return res.status(403).json({ message: 'No access to this company' });
      }
    }
    
    // Get company database connection
    const companyDb = await getCompanyConnection(req.companySlug);
    req.companyDb = companyDb;
    
    // Get models from company database
    req.Product = companyDb.model('Product');
    req.Category = companyDb.model('Category');
    req.Scan = companyDb.model('Scan');
    
    next();
  } catch (error) {
    console.error('Company middleware error:', error);
    res.status(500).json({ message: 'Failed to connect to company database' });
  }
};

// Routes

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }
    
    // Find user
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    
    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }
    
    // Update last login
    user.lastLogin = new Date();
    await user.save();
    
    // Generate token
    const token = generateToken(user._id);
    
    // Get companies user can access
    let companies = [];
    if (user.isSuperAdmin) {
      // Super admin can access all companies
      companies = await Company.find({ isActive: true }).select('name slug logo color');
    } else if (user.companyAccess && user.companyAccess.length > 0) {
      // Get companies from user's access list
      const companyIds = user.companyAccess.map(ca => ca.company);
      companies = await Company.find({ _id: { $in: companyIds }, isActive: true }).select('name slug logo color');
    } else {
      // Legacy user without companyAccess - give access to default company
      const defaultCompany = await Company.findOne({ slug: config.DEFAULT_COMPANY_SLUG });
      if (defaultCompany) {
        companies = [defaultCompany];
      }
    }
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin || false,
        companyAccess: user.companyAccess || [],
        companies: companies.map(c => ({
          id: c._id,
          name: c.name,
          slug: c.slug,
          logo: c.logo,
          color: c.color
        }))
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get current user (verify token)
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    // Get companies user can access
    let companies = [];
    if (req.user.isSuperAdmin) {
      companies = await Company.find({ isActive: true }).select('name slug logo color');
    } else if (req.user.companyAccess && req.user.companyAccess.length > 0) {
      const companyIds = req.user.companyAccess.map(ca => ca.company);
      companies = await Company.find({ _id: { $in: companyIds }, isActive: true }).select('name slug logo color');
    } else {
      const defaultCompany = await Company.findOne({ slug: config.DEFAULT_COMPANY_SLUG });
      if (defaultCompany) {
        companies = [defaultCompany];
      }
    }
    
    res.json({
      success: true,
      user: {
        id: req.user._id,
        username: req.user.username,
        fullName: req.user.fullName,
        role: req.user.role,
        profileImage: req.user.profileImage,
        isSuperAdmin: req.user.isSuperAdmin || false,
        companyAccess: req.user.companyAccess || [],
        companies: companies.map(c => ({
          id: c._id,
          name: c.name,
          slug: c.slug,
          logo: c.logo,
          color: c.color
        }))
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update current user's profile
app.put('/api/auth/profile', authMiddleware, async (req, res) => {
  try {
    const { fullName, currentPassword, newPassword, profileImage } = req.body;
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Update full name if provided
    if (fullName && fullName.trim()) {
      user.fullName = fullName.trim();
    }
    
    // Update profile image if provided
    if (profileImage !== undefined) {
      user.profileImage = profileImage;
    }
    
    // Update password if provided
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ message: 'Current password is required to change password' });
      }
      
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }
      
      user.password = newPassword; // Will be hashed by pre-save hook
    }
    
    await user.save();
    
    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        profileImage: user.profileImage
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// Logout (optional - mainly for tracking)
app.post('/api/auth/logout', authMiddleware, async (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    connections: getConnectionStatus()
  });
});

// ============ COMPANY MANAGEMENT ROUTES ============

// Get all companies (user sees only their companies, super admin sees all)
app.get('/api/companies', authMiddleware, async (req, res) => {
  try {
    let companies;
    
    if (req.user.isSuperAdmin) {
      // Super admin sees all companies
      companies = await Company.find().sort({ name: 1 });
    } else if (req.user.companyAccess && req.user.companyAccess.length > 0) {
      // User sees only their assigned companies
      const companyIds = req.user.companyAccess.map(ca => ca.company);
      companies = await Company.find({ _id: { $in: companyIds }, isActive: true }).sort({ name: 1 });
    } else {
      // Legacy user - show default company
      const defaultCompany = await Company.findOne({ slug: config.DEFAULT_COMPANY_SLUG });
      companies = defaultCompany ? [defaultCompany] : [];
    }
    
    res.json({
      success: true,
      companies
    });
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({ message: 'Failed to get companies' });
  }
});

// Get single company
app.get('/api/companies/:id', authMiddleware, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    res.json({
      success: true,
      company
    });
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({ message: 'Failed to get company' });
  }
});

// Create new company (Super admin only)
app.post('/api/companies', authMiddleware, superAdminMiddleware, async (req, res) => {
  try {
    const { name, logo, color, description } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Company name is required' });
    }
    
    // Auto-generate slug: shalset-{name}-{random5digits}
    const namePart = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const randomPart = Math.floor(10000 + Math.random() * 90000); // 5 random digits
    const companySlug = `shalset-${namePart}-${randomPart}`;
    
    // Check if slug already exists (very unlikely with random)
    const existingCompany = await Company.findOne({ slug: companySlug });
    if (existingCompany) {
      return res.status(400).json({ message: 'Please try again - slug collision occurred' });
    }
    
    const company = new Company({
      name: name.trim(),
      slug: companySlug,
      logo: logo || '',
      color: color || '#E53935',
      description: description || '',
      createdBy: req.user._id
    });
    
    await company.save();
    
    // Initialize the company database by getting a connection
    await getCompanyConnection(companySlug);
    
    res.status(201).json({
      success: true,
      message: 'Company created successfully',
      company
    });
  } catch (error) {
    console.error('Create company error:', error);
    res.status(500).json({ message: 'Failed to create company' });
  }
});

// Update company (Super admin only)
app.put('/api/companies/:id', authMiddleware, superAdminMiddleware, async (req, res) => {
  try {
    const { name, logo, color, description, isActive } = req.body;
    
    const company = await Company.findById(req.params.id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    // Update fields
    if (name !== undefined) company.name = name.trim();
    if (logo !== undefined) company.logo = logo;
    if (color !== undefined) company.color = color;
    if (description !== undefined) company.description = description;
    if (isActive !== undefined) company.isActive = isActive;
    // Note: slug cannot be changed as it's used as database name
    
    await company.save();
    
    res.json({
      success: true,
      message: 'Company updated successfully',
      company
    });
  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({ message: 'Failed to update company' });
  }
});

// Delete company (Super admin only) - just deactivates, doesn't delete data
app.delete('/api/companies/:id', authMiddleware, superAdminMiddleware, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    // Don't actually delete - just deactivate
    company.isActive = false;
    await company.save();
    
    res.json({
      success: true,
      message: 'Company deactivated successfully'
    });
  } catch (error) {
    console.error('Delete company error:', error);
    res.status(500).json({ message: 'Failed to delete company' });
  }
});

// Assign company access to user (Admin only)
app.put('/api/users/:id/company-access', authMiddleware, superAdminMiddleware, async (req, res) => {
  try {
    const { companyAccess } = req.body;
    
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Validate and format company access
    const formattedAccess = [];
    for (const access of companyAccess) {
      const company = await Company.findById(access.companyId || access.company);
      if (company) {
        formattedAccess.push({
          company: company._id,
          companySlug: company.slug,
          companyName: company.name,
          role: access.role || 'user'
        });
      }
    }
    
    user.companyAccess = formattedAccess;
    await user.save();
    
    res.json({
      success: true,
      message: 'Company access updated successfully',
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        companyAccess: user.companyAccess
      }
    });
  } catch (error) {
    console.error('Update company access error:', error);
    res.status(500).json({ message: 'Failed to update company access' });
  }
});

// Seed endpoint - creates initial admin user (only if no users exist)
app.post('/api/seed', async (req, res) => {
  try {
    // Check if any users exist
    const userCount = await User.countDocuments();
    if (userCount > 0) {
      return res.status(400).json({ message: 'Database already seeded. Users exist.' });
    }
    
    // Create default users
    const defaultUsers = [
      { username: 'admin', password: 'admin123', fullName: 'Administrator', role: 'admin' },
      { username: 'user1', password: 'user123', fullName: 'John Doe', role: 'user' },
      { username: 'user2', password: 'user123', fullName: 'Jane Smith', role: 'user' }
    ];
    
    for (const userData of defaultUsers) {
      const user = new User(userData);
      await user.save();
    }
    
    res.json({ 
      success: true, 
      message: 'Database seeded successfully',
      users: ['admin/admin123', 'user1/user123', 'user2/user123']
    });
  } catch (error) {
    console.error('Seed error:', error);
    res.status(500).json({ message: 'Failed to seed database' });
  }
});

// Migration endpoint - migrates data from old Render backend
app.post('/api/migrate', async (req, res) => {
  try {
    const OLD_API = 'https://barcode-backend-shalset.onrender.com';
    
    // Login to old backend
    const loginRes = await fetch(`${OLD_API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const loginData = await loginRes.json();
    if (!loginData.token) {
      return res.status(400).json({ message: 'Failed to login to old backend' });
    }
    
    // Fetch all products from old backend
    const productsRes = await fetch(`${OLD_API}/api/products?limit=10000`, {
      headers: { 'Authorization': `Bearer ${loginData.token}` }
    });
    const productsData = await productsRes.json();
    const oldProducts = productsData.products || [];
    
    let migrated = 0;
    let skipped = 0;
    
    for (const oldProduct of oldProducts) {
      try {
        const existing = await Product.findOne({ barcode: oldProduct.barcode });
        if (existing) {
          skipped++;
          continue;
        }
        
        const newProduct = new Product({
          barcode: oldProduct.barcode,
          name: oldProduct.name,
          currentStock: oldProduct.currentStock,
          note: oldProduct.note,
          buyingPrice: oldProduct.buyingPrice,
          sellingPrice: oldProduct.sellingPrice,
          boughtFrom: oldProduct.boughtFrom,
          sellLocation: oldProduct.sellLocation,
          imageUrl: oldProduct.imageUrl,
          category: oldProduct.category,
          lowStockThreshold: oldProduct.lowStockThreshold || 10,
          stockHistory: oldProduct.stockHistory || [],
          createdAt: oldProduct.createdAt,
          updatedAt: oldProduct.updatedAt
        });
        
        await newProduct.save();
        migrated++;
      } catch (err) {
        console.error(`Failed to migrate ${oldProduct.name}:`, err.message);
      }
    }
    
    res.json({
      success: true,
      message: 'Migration complete',
      migrated,
      skipped,
      total: oldProducts.length
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ message: 'Failed to migrate data' });
  }
});

// ============ USER MANAGEMENT ROUTES (Admin only) ============

// Get all users
app.get('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Failed to get users' });
  }
});

// Create new user (Admin only)
app.post('/api/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { username, password, fullName, role, companyAccess, isSuperAdmin } = req.body;
    
    if (!username || !password || !fullName) {
      return res.status(400).json({ message: 'Username, password, and full name are required' });
    }
    
    // Check if username exists
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }
    
    // Build company access array from company IDs
    let companyAccessArray = [];
    if (companyAccess && companyAccess.length > 0) {
      const companies = await Company.find({ _id: { $in: companyAccess } });
      companyAccessArray = companies.map(c => ({
        company: c._id,
        companySlug: c.slug,
        companyName: c.name,
        role: role || 'user'
      }));
    }
    
    const user = new User({
      username: username.toLowerCase(),
      password,
      fullName,
      role: role || 'user',
      isSuperAdmin: req.user.isSuperAdmin ? (isSuperAdmin || false) : false,
      companyAccess: companyAccessArray
    });
    
    await user.save();
    
    res.status(201).json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin,
        companyAccess: user.companyAccess,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Failed to create user' });
  }
});

// Update user (Admin only)
app.put('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, fullName, role, companyAccess, isSuperAdmin } = req.body;
    
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if new username is taken by another user
    if (username && username.toLowerCase() !== user.username) {
      const existingUser = await User.findOne({ username: username.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists' });
      }
      user.username = username.toLowerCase();
    }
    
    if (fullName) user.fullName = fullName;
    if (role) user.role = role;
    if (password) user.password = password; // Will be hashed by pre-save hook
    
    // Update company access if provided
    if (companyAccess !== undefined) {
      if (companyAccess.length > 0) {
        const companies = await Company.find({ _id: { $in: companyAccess } });
        user.companyAccess = companies.map(c => ({
          company: c._id,
          companySlug: c.slug,
          companyName: c.name,
          role: role || user.role
        }));
      } else {
        user.companyAccess = [];
      }
    }
    
    // Only super admins can grant super admin status
    if (req.user.isSuperAdmin && isSuperAdmin !== undefined) {
      user.isSuperAdmin = isSuperAdmin;
    }
    
    await user.save();
    
    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin,
        companyAccess: user.companyAccess,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

// Delete user (Admin only)
app.delete('/api/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Prevent self-deletion
    if (id === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot delete your own account' });
    }
    
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    await User.findByIdAndDelete(id);
    
    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Failed to delete user' });
  }
});

// ============ SCAN ROUTES ============

// Save a new scan
app.post('/api/scans', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { barcode, scanMode, deviceInfo, location } = req.body;
    
    if (!barcode) {
      return res.status(400).json({ message: 'Barcode data is required' });
    }
    
    const scan = new req.Scan({
      barcode: barcode.trim(),
      user: req.user._id,
      username: req.user.username,
      userFullName: req.user.fullName,
      scanMode: scanMode || 'keyboard',
      deviceInfo: deviceInfo || null,
      location: location || null,
      scannedAt: new Date()
    });
    
    await scan.save();
    
    res.status(201).json({
      success: true,
      scan: {
        id: scan._id,
        barcode: scan.barcode,
        scannedAt: scan.scannedAt,
        scanMode: scan.scanMode
      }
    });
  } catch (error) {
    console.error('Save scan error:', error);
    res.status(500).json({ message: 'Failed to save scan' });
  }
});

// Get scans for current user
app.get('/api/scans/my', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;
    
    const scans = await req.Scan.find({ user: req.user._id })
      .sort({ scannedAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await req.Scan.countDocuments({ user: req.user._id });
    
    res.json({
      success: true,
      scans,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get scans error:', error);
    res.status(500).json({ message: 'Failed to get scans' });
  }
});

// Get all scans (admin view)
app.get('/api/scans/all', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;
    
    const scans = await req.Scan.find()
      .sort({ scannedAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await req.Scan.countDocuments();
    
    res.json({
      success: true,
      scans,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get all scans error:', error);
    res.status(500).json({ message: 'Failed to get scans' });
  }
});

// Get scan statistics
app.get('/api/scans/stats', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const userId = req.query.userId || req.user._id;
    
    const totalScans = await req.Scan.countDocuments({ user: userId });
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayScans = await req.Scan.countDocuments({ 
      user: userId, 
      scannedAt: { $gte: todayStart } 
    });
    
    const recentScans = await req.Scan.find({ user: userId })
      .sort({ scannedAt: -1 })
      .limit(5);
    
    res.json({
      success: true,
      stats: {
        totalScans,
        todayScans,
        recentScans
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ message: 'Failed to get stats' });
  }
});

// Delete scans older than X days
app.delete('/api/scans/cleanup', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 3;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const result = await req.Scan.deleteMany({
      scannedAt: { $lt: cutoffDate }
    });
    
    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} scans older than ${days} days`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ message: 'Failed to cleanup old scans' });
  }
});

// ============ PRODUCT/INVENTORY ROUTES ============

// Check if product exists by barcode
app.get('/api/products/check/:barcode', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { barcode } = req.params;
    const product = await req.Product.findOne({ barcode: barcode.trim() });
    
    if (product) {
      res.json({
        success: true,
        exists: true,
        product: {
          id: product._id,
          barcode: product.barcode,
          name: product.name,
          currentStock: product.currentStock,
          note: product.note,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt
        }
      });
    } else {
      res.json({
        success: true,
        exists: false,
        barcode: barcode.trim()
      });
    }
  } catch (error) {
    console.error('Check product error:', error);
    res.status(500).json({ message: 'Failed to check product' });
  }
});

// Create new product
app.post('/api/products', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { barcode, name, quantity, note, buyingPrice, sellingPrice, boughtFrom, sellLocation, category, unit } = req.body;
    
    if (!barcode || !name) {
      return res.status(400).json({ message: 'Barcode and name are required' });
    }
    
    // Check if product already exists
    const existingProduct = await req.Product.findOne({ barcode: barcode.trim() });
    if (existingProduct) {
      return res.status(409).json({ message: 'Product with this barcode already exists' });
    }
    
    const initialQuantity = parseInt(quantity) || 0;
    
    // Get category info if provided
    let categoryDoc = null;
    if (category) {
      categoryDoc = await req.Category.findById(category);
    }
    
    const product = new req.Product({
      barcode: barcode.trim(),
      name: name.trim(),
      currentStock: initialQuantity,
      note: note || '',
      buyingPrice: parseFloat(buyingPrice) || 0,
      sellingPrice: parseFloat(sellingPrice) || 0,
      boughtFrom: boughtFrom?.trim() || '',
      sellLocation: sellLocation?.trim() || '',
      unit: unit?.trim() || 'ədəd',
      category: categoryDoc ? categoryDoc._id : null,
      categoryName: categoryDoc ? categoryDoc.name : '',
      stockHistory: initialQuantity > 0 ? [{
        quantity: initialQuantity,
        type: 'add',
        note: note || 'Initial stock',
        supplier: boughtFrom?.trim() || '',
        addedBy: req.user._id,
        addedByName: req.user.fullName
      }] : [],
      createdBy: req.user._id,
      createdByName: req.user.fullName
    });
    
    await product.save();
    
    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product: {
        id: product._id,
        barcode: product.barcode,
        name: product.name,
        currentStock: product.currentStock,
        note: product.note,
        buyingPrice: product.buyingPrice,
        sellingPrice: product.sellingPrice,
        boughtFrom: product.boughtFrom,
        sellLocation: product.sellLocation,
        unit: product.unit,
        category: product.category,
        categoryName: product.categoryName
      }
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ message: 'Failed to create product' });
  }
});

// Duplicate product
app.post('/api/products/:barcode/duplicate', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { barcode } = req.params;
    
    // Find original product
    const originalProduct = await req.Product.findOne({ barcode: barcode.trim() });
    if (!originalProduct) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    // Generate new barcode with (1), (2), etc. suffix
    let newBarcode = `${barcode}(1)`;
    let counter = 1;
    
    // Check if barcode with suffix already exists, increment counter until we find a free one
    while (await req.Product.findOne({ barcode: newBarcode })) {
      counter++;
      newBarcode = `${barcode}(${counter})`;
    }
    
    // Create duplicated product
    const duplicatedProduct = new req.Product({
      barcode: newBarcode,
      name: originalProduct.name,
      currentStock: originalProduct.currentStock,
      note: originalProduct.note,
      buyingPrice: originalProduct.buyingPrice,
      sellingPrice: originalProduct.sellingPrice,
      boughtFrom: originalProduct.boughtFrom,
      sellLocation: originalProduct.sellLocation,
      imageUrl: originalProduct.imageUrl,
      unit: originalProduct.unit,
      category: originalProduct.category,
      categoryName: originalProduct.categoryName,
      // Don't copy stockHistory, just add a "Duplicated" entry
      stockHistory: originalProduct.currentStock > 0 ? [{
        quantity: originalProduct.currentStock,
        type: 'add',
        note: `Duplicated from ${barcode}`,
        supplier: '',
        addedBy: req.user._id,
        addedByName: req.user.fullName
      }] : [],
      createdBy: req.user._id,
      createdByName: req.user.fullName
    });
    
    await duplicatedProduct.save();
    
    res.status(201).json({
      success: true,
      message: 'Product duplicated successfully',
      product: {
        id: duplicatedProduct._id,
        barcode: duplicatedProduct.barcode,
        name: duplicatedProduct.name,
        currentStock: duplicatedProduct.currentStock,
        note: duplicatedProduct.note,
        buyingPrice: duplicatedProduct.buyingPrice,
        sellingPrice: duplicatedProduct.sellingPrice,
        boughtFrom: duplicatedProduct.boughtFrom,
        sellLocation: duplicatedProduct.sellLocation,
        imageUrl: duplicatedProduct.imageUrl,
        unit: duplicatedProduct.unit,
        category: duplicatedProduct.category,
        categoryName: duplicatedProduct.categoryName
      }
    });
  } catch (error) {
    console.error('Duplicate product error:', error);
    res.status(500).json({ message: 'Failed to duplicate product' });
  }
});

// Transfer product to another company
app.post('/api/products/:barcode/transfer', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { barcode } = req.params;
    const { targetCompanySlug, keepOriginal } = req.body;
    
    if (!targetCompanySlug) {
      return res.status(400).json({ message: 'Target company slug is required' });
    }
    
    if (targetCompanySlug === req.companySlug) {
      return res.status(400).json({ message: 'Cannot transfer to the same company' });
    }
    
    // Check if user has access to target company (unless super admin)
    if (!req.user.isSuperAdmin) {
      const hasAccess = req.user.companyAccess?.some(ca => ca.companySlug === targetCompanySlug);
      if (!hasAccess) {
        return res.status(403).json({ message: 'No access to target company' });
      }
    }
    
    // Verify target company exists
    const targetCompany = await Company.findOne({ slug: targetCompanySlug, isActive: true });
    if (!targetCompany) {
      return res.status(404).json({ message: 'Target company not found' });
    }
    
    // Find source product
    const sourceProduct = await req.Product.findOne({ barcode: barcode.trim() });
    if (!sourceProduct) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    // Get target company database connection
    const targetDb = await getCompanyConnection(targetCompanySlug);
    const TargetProduct = targetDb.model('Product');
    
    // Check if barcode exists in target company
    let targetBarcode = sourceProduct.barcode;
    const existingInTarget = await TargetProduct.findOne({ barcode: targetBarcode });
    if (existingInTarget) {
      // Generate new barcode with suffix
      let counter = 1;
      targetBarcode = `${sourceProduct.barcode}(${counter})`;
      while (await TargetProduct.findOne({ barcode: targetBarcode })) {
        counter++;
        targetBarcode = `${sourceProduct.barcode}(${counter})`;
      }
    }
    
    // Create product in target company
    const transferredProduct = new TargetProduct({
      barcode: targetBarcode,
      name: sourceProduct.name,
      currentStock: sourceProduct.currentStock,
      note: sourceProduct.note,
      buyingPrice: sourceProduct.buyingPrice,
      sellingPrice: sourceProduct.sellingPrice,
      boughtFrom: sourceProduct.boughtFrom,
      sellLocation: sourceProduct.sellLocation,
      imageUrl: sourceProduct.imageUrl,
      unit: sourceProduct.unit,
      category: null, // Categories are company-specific, don't transfer
      categoryName: '',
      stockHistory: [{
        quantity: sourceProduct.currentStock,
        type: 'add',
        note: `Transferred from ${req.companySlug}`,
        addedBy: req.user._id,
        addedByName: req.user.fullName || req.user.username,
        createdAt: new Date()
      }]
    });
    
    await transferredProduct.save();
    
    // Delete from source company if not keeping original
    if (!keepOriginal) {
      await req.Product.deleteOne({ barcode: barcode.trim() });
    }
    
    res.json({
      success: true,
      message: keepOriginal ? 'Product copied to target company' : 'Product transferred to target company',
      product: {
        barcode: transferredProduct.barcode,
        name: transferredProduct.name,
        targetCompany: targetCompanySlug
      }
    });
  } catch (error) {
    console.error('Transfer product error:', error);
    res.status(500).json({ message: 'Failed to transfer product' });
  }
});

// Add stock to existing product
app.post('/api/products/:barcode/add-stock', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { barcode } = req.params;
    const { quantity, note, supplier } = req.body;
    
    console.log('Add stock request - supplier:', supplier, 'quantity:', quantity);
    
    const addQuantity = parseInt(quantity);
    if (!addQuantity || addQuantity <= 0) {
      return res.status(400).json({ message: 'Valid quantity is required' });
    }
    
    const product = await req.Product.findOne({ barcode: barcode.trim() });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    product.currentStock += addQuantity;
    product.stockHistory.push({
      quantity: addQuantity,
      type: 'add',
      note: note || '',
      supplier: supplier?.trim() || '',
      addedBy: req.user._id,
      addedByName: req.user.fullName
    });
    
    await product.save();
    
    res.json({
      success: true,
      message: `Added ${addQuantity} to stock`,
      product: {
        id: product._id,
        barcode: product.barcode,
        name: product.name,
        currentStock: product.currentStock
      }
    });
  } catch (error) {
    console.error('Add stock error:', error);
    res.status(500).json({ message: 'Failed to add stock' });
  }
});

// Remove stock from product
app.post('/api/products/:barcode/remove-stock', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { barcode } = req.params;
    const { quantity, note, location } = req.body;
    
    console.log('Remove stock request - location:', location, 'quantity:', quantity);
    
    const removeQuantity = parseInt(quantity);
    if (!removeQuantity || removeQuantity <= 0) {
      return res.status(400).json({ message: 'Valid quantity is required' });
    }
    
    const product = await req.Product.findOne({ barcode: barcode.trim() });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    if (product.currentStock < removeQuantity) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }
    
    product.currentStock -= removeQuantity;
    product.stockHistory.push({
      quantity: removeQuantity,
      type: 'remove',
      note: note || '',
      location: location?.trim() || '',
      addedBy: req.user._id,
      addedByName: req.user.fullName
    });
    
    await product.save();
    
    res.json({
      success: true,
      message: `Removed ${removeQuantity} from stock`,
      product: {
        id: product._id,
        barcode: product.barcode,
        name: product.name,
        currentStock: product.currentStock
      }
    });
  } catch (error) {
    console.error('Remove stock error:', error);
    res.status(500).json({ message: 'Failed to remove stock' });
  }
});

// Get all products
app.get('/api/products', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const categoryFilter = req.query.category || '';
    
    let query = {};
    
    // Search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { barcode: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Category filter
    if (categoryFilter) {
      if (categoryFilter === 'uncategorized') {
        query.category = null;
      } else {
        query.category = categoryFilter;
      }
    }
    
    const products = await req.Product.find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-stockHistory');
    
    const total = await req.Product.countDocuments(query);
    
    res.json({
      success: true,
      products,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ message: 'Failed to get products' });
  }
});

// Get single product with history
app.get('/api/products/:barcode', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { barcode } = req.params;
    const product = await req.Product.findOne({ barcode: barcode.trim() });
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    res.json({
      success: true,
      product
    });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ message: 'Failed to get product' });
  }
});

// Update product info
app.put('/api/products/:barcode', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { barcode } = req.params;
    const { name, note, buyingPrice, sellingPrice, boughtFrom, sellLocation, imageUrl, category, newBarcode, unit } = req.body;
    
    const product = await req.Product.findOne({ barcode: barcode.trim() });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    // Update barcode if provided and different
    if (newBarcode !== undefined && newBarcode.trim() !== barcode.trim()) {
      const existingProduct = await req.Product.findOne({ barcode: newBarcode.trim() });
      if (existingProduct) {
        return res.status(400).json({ message: 'A product with this barcode already exists' });
      }
      product.barcode = newBarcode.trim();
    }
    
    // Update fields if provided
    if (name !== undefined) product.name = name.trim();
    if (note !== undefined) product.note = note.trim();
    if (buyingPrice !== undefined) product.buyingPrice = parseFloat(buyingPrice) || 0;
    if (sellingPrice !== undefined) product.sellingPrice = parseFloat(sellingPrice) || 0;
    if (boughtFrom !== undefined) product.boughtFrom = boughtFrom.trim();
    if (sellLocation !== undefined) product.sellLocation = sellLocation.trim();
    if (imageUrl !== undefined) product.imageUrl = imageUrl;
    if (unit !== undefined) product.unit = unit.trim() || 'ədəd';
    
    // Update category
    if (category !== undefined) {
      if (category === null || category === '') {
        product.category = null;
        product.categoryName = '';
      } else {
        const categoryDoc = await req.Category.findById(category);
        if (categoryDoc) {
          product.category = categoryDoc._id;
          product.categoryName = categoryDoc.name;
        }
      }
    }
    
    await product.save();
    
    res.json({
      success: true,
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ message: 'Failed to update product' });
  }
});

// Delete product
app.delete('/api/products/:barcode', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { barcode } = req.params;
    
    const product = await req.Product.findOne({ barcode: barcode.trim() });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    await req.Product.findByIdAndDelete(product._id);
    
    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ message: 'Failed to delete product' });
  }
});

// ============ CATEGORY ROUTES ============

// Get all categories
app.get('/api/categories', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const categories = await req.Category.find().sort({ name: 1 });
    res.json({
      success: true,
      categories
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ message: 'Failed to get categories' });
  }
});

// Create new category
app.post('/api/categories', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { name, description, color } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Category name is required' });
    }
    
    // Check if category already exists
    const existingCategory = await req.Category.findOne({ name: name.trim() });
    if (existingCategory) {
      return res.status(400).json({ message: 'Category already exists' });
    }
    
    const category = new req.Category({
      name: name.trim(),
      description: description?.trim() || '',
      color: color || '#3b82f6',
      createdBy: req.user._id,
      createdByName: req.user.fullName
    });
    
    await category.save();
    
    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      category
    });
  } catch (error) {
    console.error('Create category error:', error);
    res.status(500).json({ message: 'Failed to create category' });
  }
});

// Update category
app.put('/api/categories/:id', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color } = req.body;
    
    const category = await req.Category.findById(id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    if (name !== undefined) {
      // Check if new name conflicts with existing category
      const existingCategory = await req.Category.findOne({ name: name.trim(), _id: { $ne: id } });
      if (existingCategory) {
        return res.status(400).json({ message: 'Category name already exists' });
      }
      category.name = name.trim();
      
      // Update categoryName in all products with this category
      await req.Product.updateMany({ category: id }, { categoryName: name.trim() });
    }
    if (description !== undefined) category.description = description.trim();
    if (color !== undefined) category.color = color;
    
    await category.save();
    
    res.json({
      success: true,
      message: 'Category updated successfully',
      category
    });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ message: 'Failed to update category' });
  }
});

// Delete category
app.delete('/api/categories/:id', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    
    const category = await req.Category.findById(id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }
    
    // Remove category reference from all products
    await req.Product.updateMany({ category: id }, { category: null, categoryName: '' });
    
    await req.Category.findByIdAndDelete(id);
    
    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({ message: 'Failed to delete category' });
  }
});

// Get products count by category
app.get('/api/categories/:id/products-count', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const count = await req.Product.countDocuments({ category: id });
    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error('Get products count error:', error);
    res.status(500).json({ message: 'Failed to get products count' });
  }
});

// Copy categories to another company
app.post('/api/categories/copy-to-company', authMiddleware, async (req, res) => {
  try {
    const { sourceCompanySlug, targetCompanySlug } = req.body;
    
    if (!sourceCompanySlug || !targetCompanySlug) {
      return res.status(400).json({ message: 'Source and target company slugs are required' });
    }
    
    if (sourceCompanySlug === targetCompanySlug) {
      return res.status(400).json({ message: 'Source and target companies must be different' });
    }
    
    // Get source company database connection
    const sourceDb = await getCompanyConnection(sourceCompanySlug);
    const SourceCategory = sourceDb.model('Category');
    
    // Get target company database connection
    const targetDb = await getCompanyConnection(targetCompanySlug);
    const TargetCategory = targetDb.model('Category');
    
    // Get all categories from source company
    const sourceCategories = await SourceCategory.find();
    
    if (sourceCategories.length === 0) {
      return res.status(404).json({ message: 'No categories found in source company' });
    }
    
    let copiedCount = 0;
    let skippedCount = 0;
    
    // Copy each category
    for (const sourceCat of sourceCategories) {
      // Check if category with same name already exists in target
      const existingCategory = await TargetCategory.findOne({ name: sourceCat.name });
      
      if (!existingCategory) {
        // Create new category in target company
        await TargetCategory.create({
          name: sourceCat.name,
          description: sourceCat.description,
          color: sourceCat.color,
          createdBy: req.user._id,
          createdByName: req.user.fullName
        });
        copiedCount++;
      } else {
        skippedCount++;
      }
    }
    
    res.json({
      success: true,
      message: `Copied ${copiedCount} categories, skipped ${skippedCount} (already exists)`,
      copiedCount,
      skippedCount
    });
    
  } catch (error) {
    console.error('Copy categories error:', error);
    res.status(500).json({ message: 'Failed to copy categories' });
  }
});

// ============ STATISTICS ROUTES ============

// Get category distribution for pie chart
app.get('/api/stats/category-distribution', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const categories = await req.Category.find();
    const distribution = [];
    
    // Get count for each category
    for (const category of categories) {
      const count = await req.Product.countDocuments({ category: category._id });
      if (count > 0) {
        distribution.push({
          name: category.name,
          color: category.color,
          count
        });
      }
    }
    
    // Get uncategorized count
    const uncategorizedCount = await req.Product.countDocuments({ category: null });
    if (uncategorizedCount > 0) {
      distribution.push({
        name: 'Uncategorized',
        color: '#6b7280',
        count: uncategorizedCount
      });
    }
    
    res.json({
      success: true,
      distribution
    });
  } catch (error) {
    console.error('Get category distribution error:', error);
    res.status(500).json({ message: 'Failed to get category distribution' });
  }
});

// Get dashboard stats
app.get('/api/stats/dashboard', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    const products = await req.Product.find();
    
    // Calculate totals
    let totalProducts = products.length;
    let totalBuyValue = 0;
    let totalSellValue = 0;
    let totalStock = 0;
    
    for (const product of products) {
      totalStock += (product.currentStock || 0);
      totalBuyValue += (product.currentStock || 0) * (product.buyingPrice || 0);
      totalSellValue += (product.currentStock || 0) * (product.sellingPrice || 0);
    }
    
    res.json({
      success: true,
      stats: {
        totalProducts,
        totalBuyValue: Math.round(totalBuyValue * 100) / 100,
        totalSellValue: Math.round(totalSellValue * 100) / 100,
        totalStock
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ message: 'Failed to get dashboard stats' });
  }
});

// Get inventory value over time for line chart
app.get('/api/stats/inventory-value', authMiddleware, companyMiddleware, async (req, res) => {
  try {
    // Get days parameter (default 30)
    const days = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    
    // Get all products with stock history
    const products = await req.Product.find();
    
    // Create a map of daily values
    const dailyData = new Map();
    
    // Process each product's stock history
    for (const product of products) {
      for (const history of product.stockHistory) {
        const historyDate = new Date(history.createdAt);
        if (historyDate < startDate) continue;
        
        const date = historyDate.toISOString().split('T')[0];
        
        if (!dailyData.has(date)) {
          dailyData.set(date, { bought: 0, sold: 0 });
        }
        
        const dayData = dailyData.get(date);
        
        if (history.type === 'add') {
          // Bought items: quantity × buying price
          dayData.bought += history.quantity * (product.buyingPrice || 0);
        } else if (history.type === 'remove') {
          // Sold items: quantity × selling price
          dayData.sold += history.quantity * (product.sellingPrice || 0);
        }
      }
    }
    
    // Convert to array and sort by date
    const sortedDates = Array.from(dailyData.keys()).sort();
    
    // Calculate cumulative values
    let cumulativeBought = 0;
    let cumulativeSold = 0;
    const chartData = sortedDates.map(date => {
      const dayData = dailyData.get(date);
      cumulativeBought += dayData.bought;
      cumulativeSold += dayData.sold;
      return {
        date,
        bought: Math.round(cumulativeBought * 100) / 100,
        sold: Math.round(cumulativeSold * 100) / 100,
        profit: Math.round((cumulativeSold - cumulativeBought) * 100) / 100
      };
    });
    
    res.json({
      success: true,
      data: chartData
    });
  } catch (error) {
    console.error('Get inventory value error:', error);
    res.status(500).json({ message: 'Failed to get inventory value' });
  }
});

// Export inventory transactions (stock history)
app.get('/api/export/inventory-transactions', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, allCompanies } = req.query;
    
    // Parse dates
    const start = startDate ? new Date(startDate) : new Date(0); // From beginning
    const end = endDate ? new Date(endDate) : new Date(); // Until now
    
    // Set time to cover full days
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    
    // If allCompanies is requested, only super admins can use it
    if (allCompanies === 'true') {
      if (!req.user.isSuperAdmin) {
        return res.status(403).json({ message: 'Super admin access required for all companies export' });
      }
      
      // Get all active companies
      const companies = await Company.find({ isActive: true });
      const allTransactions = [];
      
      for (const company of companies) {
        try {
          const companyDb = await getCompanyConnection(company.slug);
          const ProductModel = companyDb.model('Product');
          
          const products = await ProductModel.find().select('barcode name category categoryName buyingPrice sellingPrice stockHistory');
          
          for (const product of products) {
            if (!product.stockHistory || product.stockHistory.length === 0) continue;
            
            for (const history of product.stockHistory) {
              const transactionDate = new Date(history.createdAt);
              
              if (transactionDate >= start && transactionDate <= end) {
                allTransactions.push({
                  date: transactionDate,
                  barcode: product.barcode,
                  productName: product.name,
                  category: product.categoryName || 'Uncategorized',
                  type: history.type,
                  quantity: history.quantity,
                  buyingPrice: product.buyingPrice || 0,
                  sellingPrice: product.sellingPrice || 0,
                  totalCost: history.type === 'add' ? (history.quantity * (product.buyingPrice || 0)) : 0,
                  totalRevenue: history.type === 'remove' ? (history.quantity * (product.sellingPrice || 0)) : 0,
                  supplier: history.supplier || '',
                  location: history.location || '',
                  note: history.note || '',
                  addedBy: history.addedByName || 'Unknown',
                  createdAt: history.createdAt,
                  companyName: company.name,
                  companySlug: company.slug
                });
              }
            }
          }
        } catch (companyErr) {
          console.error(`Error fetching from company ${company.slug}:`, companyErr);
        }
      }
      
      // Sort by date (newest first)
      allTransactions.sort((a, b) => b.date - a.date);
      
      return res.json({
        success: true,
        data: allTransactions,
        count: allTransactions.length,
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString()
        }
      });
    }
    
    // Regular single-company export - apply company middleware manually
    const companySlug = req.headers['x-company-slug'] || config.DEFAULT_COMPANY_SLUG;
    
    // Check user access
    if (!req.user.isSuperAdmin) {
      const hasAccess = req.user.companyAccess?.some(ca => ca.companySlug === companySlug);
      const legacyAccess = !req.user.companyAccess || req.user.companyAccess.length === 0;
      
      if (!hasAccess && !legacyAccess) {
        return res.status(403).json({ message: 'No access to this company' });
      }
    }
    
    const companyDb = await getCompanyConnection(companySlug);
    const ProductModel = companyDb.model('Product');
    
    // Get all products
    const products = await ProductModel.find().select('barcode name category categoryName buyingPrice sellingPrice stockHistory');
    
    // Collect all transactions
    const transactions = [];
    
    for (const product of products) {
      if (!product.stockHistory || product.stockHistory.length === 0) continue;
      
      for (const history of product.stockHistory) {
        const transactionDate = new Date(history.createdAt);
        
        // Filter by date range
        if (transactionDate >= start && transactionDate <= end) {
          transactions.push({
            date: transactionDate,
            barcode: product.barcode,
            productName: product.name,
            category: product.categoryName || 'Uncategorized',
            type: history.type,
            quantity: history.quantity,
            buyingPrice: product.buyingPrice || 0,
            sellingPrice: product.sellingPrice || 0,
            totalCost: history.type === 'add' ? (history.quantity * (product.buyingPrice || 0)) : 0,
            totalRevenue: history.type === 'remove' ? (history.quantity * (product.sellingPrice || 0)) : 0,
            supplier: history.supplier || '',
            location: history.location || '',
            note: history.note || '',
            addedBy: history.addedByName || 'Unknown',
            createdAt: history.createdAt
          });
        }
      }
    }
    
    // Sort by date (newest first)
    transactions.sort((a, b) => b.date - a.date);
    
    res.json({
      success: true,
      data: transactions,
      count: transactions.length,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString()
      }
    });
  } catch (error) {
    console.error('Export inventory transactions error:', error);
    res.status(500).json({ message: 'Failed to export inventory transactions' });
  }
});

// Start server
app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${config.PORT}`);
});

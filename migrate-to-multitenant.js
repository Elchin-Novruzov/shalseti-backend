/**
 * Multi-Tenant Migration Script
 * 
 * This script migrates the existing single-tenant system to multi-tenant:
 * 1. Creates the Company document for Shalset in the master database
 * 2. Updates all existing users with companyAccess for Shalset
 * 3. Makes the existing admin user a super admin
 * 
 * NOTE: The existing 'barcode' database keeps its products/categories/scans data.
 * We're just adding the multi-tenant structure on top.
 * 
 * Usage: node migrate-to-multitenant.js
 */

const mongoose = require('mongoose');
const config = require('./config');

// Define schemas inline for migration
const companySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true },
  logo: { type: String, default: '' },
  color: { type: String, default: '#E53935' },
  description: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const companyAccessSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  companySlug: { type: String, required: true },
  companyName: { type: String, required: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' }
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  fullName: { type: String, required: true, trim: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  profileImage: { type: String, default: '' },
  lastLogin: { type: Date },
  createdAt: { type: Date, default: Date.now },
  isSuperAdmin: { type: Boolean, default: false },
  companyAccess: [companyAccessSchema]
});

async function migrate() {
  console.log('========================================');
  console.log('Multi-Tenant Migration Script');
  console.log('========================================\n');

  try {
    // Connect to the master database
    console.log('1. Connecting to master database...');
    let masterUri = config.MONGODB_URI;
    if (masterUri.includes('?')) {
      masterUri = masterUri.replace('/?', '/' + config.MASTER_DB_NAME + '?');
    } else {
      masterUri = masterUri.replace(/\/$/, '') + '/' + config.MASTER_DB_NAME;
    }
    await mongoose.connect(masterUri);
    console.log('   Connected to:', masterUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));

    // Get existing models
    const Company = mongoose.models.Company || mongoose.model('Company', companySchema);
    const User = mongoose.models.User || mongoose.model('User', userSchema);

    // Check if Shalset company already exists
    console.log('\n2. Checking for existing Shalset company...');
    let shalsetCompany = await Company.findOne({ slug: 'barcode' });
    
    if (shalsetCompany) {
      console.log('   Shalset company already exists, skipping creation.');
    } else {
      console.log('   Creating Shalset company...');
      shalsetCompany = new Company({
        name: 'Shalset',
        slug: 'barcode', // Using 'barcode' as slug to match existing database
        color: '#E53935',
        description: 'Shalset - Main Company (Umbrella)',
        isActive: true
      });
      await shalsetCompany.save();
      console.log('   Created company: Shalset (slug: barcode)');
    }

    // Get all users
    console.log('\n3. Updating users with company access...');
    const users = await User.find();
    console.log(`   Found ${users.length} users to update.`);

    let updatedCount = 0;
    let superAdminSet = false;

    for (const user of users) {
      const updates = {};
      let needsUpdate = false;

      // Check if user needs companyAccess
      if (!user.companyAccess || user.companyAccess.length === 0) {
        updates.companyAccess = [{
          company: shalsetCompany._id,
          companySlug: shalsetCompany.slug,
          companyName: shalsetCompany.name,
          role: user.role || 'user'
        }];
        needsUpdate = true;
      }

      // Make first admin a super admin
      if (user.role === 'admin' && !superAdminSet) {
        updates.isSuperAdmin = true;
        superAdminSet = true;
        needsUpdate = true;
        console.log(`   Setting ${user.username} as Super Admin`);
      }

      if (needsUpdate) {
        await User.updateOne({ _id: user._id }, { $set: updates });
        updatedCount++;
      }
    }

    console.log(`   Updated ${updatedCount} users.`);

    // Summary
    console.log('\n========================================');
    console.log('Migration Complete!');
    console.log('========================================');
    console.log('\nSummary:');
    console.log(`- Company created: Shalset (slug: barcode)`);
    console.log(`- Users updated: ${updatedCount}`);
    console.log(`- Super admin set: ${superAdminSet ? 'Yes' : 'No'}`);
    console.log('\nNext steps:');
    console.log('1. Update MONGODB_URI in production environment if needed');
    console.log('2. Deploy updated backend');
    console.log('3. Deploy updated web app');
    console.log('4. Test login and company selection');

    await mongoose.disconnect();
    console.log('\nDisconnected from database.');
    
  } catch (error) {
    console.error('\nMigration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrate();

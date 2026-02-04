/**
 * Migrate Users Script
 * Migrates users from barcode database to master database
 */

const mongoose = require('mongoose');
const config = require('./config');

const companyAccessSchema = new mongoose.Schema({
  company: mongoose.Schema.Types.ObjectId,
  companySlug: String,
  companyName: String,
  role: String
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  fullName: String,
  role: String,
  profileImage: String,
  lastLogin: Date,
  createdAt: Date,
  isSuperAdmin: Boolean,
  companyAccess: [companyAccessSchema]
});

const companySchema = new mongoose.Schema({
  name: String,
  slug: String
});

async function migrateUsers() {
  console.log('Migrating users to master database...\n');
  
  // Connect to barcode database
  const barcodeUri = config.MONGODB_URI.replace('/?', '/barcode?');
  const barcodeConn = await mongoose.createConnection(barcodeUri);
  const OldUser = barcodeConn.model('User', userSchema);
  console.log('Connected to barcode database');
  
  // Connect to master database
  const masterUri = config.MONGODB_URI.replace('/?', '/' + config.MASTER_DB_NAME + '?');
  const masterConn = await mongoose.createConnection(masterUri);
  const NewUser = masterConn.model('User', userSchema);
  const Company = masterConn.model('Company', companySchema);
  console.log('Connected to master database');
  
  // Get company
  const company = await Company.findOne({ slug: 'barcode' });
  if (!company) {
    console.log('Company not found! Run migrate-to-multitenant.js first.');
    process.exit(1);
  }
  console.log('Found company:', company.name);
  
  // Get all users from barcode db
  const users = await OldUser.find();
  console.log('Found ' + users.length + ' users in barcode db\n');
  
  let migratedCount = 0;
  for (const user of users) {
    // Check if already in master
    const exists = await NewUser.findOne({ username: user.username });
    if (exists) {
      console.log('  Skipping ' + user.username + ' (already exists)');
      continue;
    }
    
    // Create in master with company access
    const newUser = new NewUser({
      username: user.username,
      password: user.password,
      fullName: user.fullName,
      role: user.role,
      profileImage: user.profileImage,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      isSuperAdmin: user.role === 'admin',
      companyAccess: [{
        company: company._id,
        companySlug: company.slug,
        companyName: company.name,
        role: user.role || 'user'
      }]
    });
    await newUser.save();
    console.log('  Migrated: ' + user.username + (newUser.isSuperAdmin ? ' (Super Admin)' : ''));
    migratedCount++;
  }
  
  await barcodeConn.close();
  await masterConn.close();
  console.log('\nMigration complete! Migrated ' + migratedCount + ' users.');
}

migrateUsers().catch(console.error);

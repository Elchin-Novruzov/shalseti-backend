/**
 * Assign Company to User Script
 * 
 * Usage: node assign-company.js <username> [company-slug]
 * Default company-slug is 'barcode' (Shalset)
 */

const mongoose = require('mongoose');
const config = require('./config');

// Define schemas inline
const companyAccessSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  companySlug: { type: String, required: true },
  companyName: { type: String, required: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' }
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  companyAccess: [companyAccessSchema],
  role: String,
  isSuperAdmin: Boolean
});

const companySchema = new mongoose.Schema({
  name: String,
  slug: String
});

async function assignCompany(username, companySlug = 'barcode') {
  console.log(`Assigning company '${companySlug}' to user '${username}'...`);

  try {
    // Connect to master database where users and companies are stored
    // Handle URI with query params properly
    let masterUri = config.MONGODB_URI;
    if (masterUri.includes('?')) {
      // Insert database name before query params
      masterUri = masterUri.replace('/?', '/' + config.MASTER_DB_NAME + '?');
    } else {
      masterUri = masterUri.replace(/\/$/, '') + '/' + config.MASTER_DB_NAME;
    }
    console.log('Connecting to master database...');
    await mongoose.connect(masterUri);
    console.log('Connected to database.');

    const User = mongoose.models.User || mongoose.model('User', userSchema);
    const Company = mongoose.models.Company || mongoose.model('Company', companySchema);

    // Find the company
    const company = await Company.findOne({ slug: companySlug });
    if (!company) {
      console.error(`Company with slug '${companySlug}' not found.`);
      process.exit(1);
    }
    console.log(`Found company: ${company.name}`);

    // Find the user
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      console.error(`User '${username}' not found.`);
      process.exit(1);
    }
    console.log(`Found user: ${user.username}`);

    // Check if already has access
    const hasAccess = user.companyAccess?.some(ca => ca.companySlug === companySlug);
    if (hasAccess) {
      console.log(`User already has access to ${company.name}.`);
    } else {
      // Add company access
      const newAccess = {
        company: company._id,
        companySlug: company.slug,
        companyName: company.name,
        role: user.role || 'user'
      };

      await User.updateOne(
        { _id: user._id },
        { $push: { companyAccess: newAccess } }
      );
      console.log(`✓ Successfully assigned ${company.name} to ${user.username}`);
    }

    await mongoose.disconnect();
    console.log('Done.');
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Get username from command line
const username = process.argv[2];
const companySlug = process.argv[3] || 'barcode';

if (!username) {
  console.log('Usage: node assign-company.js <username> [company-slug]');
  console.log('Example: node assign-company.js iree barcode');
  process.exit(1);
}

assignCompany(username, companySlug);

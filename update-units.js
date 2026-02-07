require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const config = require('./config');

// Import Product model
const Product = require('./models/Product');

async function updateUnits() {
  try {
    console.log('Connecting to MongoDB...');
    
    // Get base URI and master database name
    const masterDbName = config.MASTER_DB_NAME || 'shalset-master';
    const baseUri = config.MONGODB_URI;
    
    // Build master database URI
    const masterUri = baseUri.includes('?') 
      ? baseUri.replace('?', `${masterDbName}?`)
      : `${baseUri}${masterDbName}`;
    
    console.log(`Master URI: ${masterUri.replace(/:[^:@]+@/, ':****@')}`);
    
    const masterConnection = await mongoose.createConnection(masterUri);
    
    console.log('Connected to master database');
    
    // Get all companies from master database
    const Company = masterConnection.model('Company', new mongoose.Schema({
      name: String,
      slug: String,
      logo: String,
      color: String,
      address: String,
      createdAt: Date,
      updatedAt: Date
    }));
    
    const companies = await Company.find({ deletedAt: { $exists: false } });
    
    console.log(`Found ${companies.length} active companies`);
    
    let totalUpdated = 0;
    
    // Update each company database
    for (const company of companies) {
      console.log(`\nProcessing company: ${company.name} (${company.slug})`);
      
      // Connect to company database
      const companyUri = baseUri.includes('?')
        ? baseUri.replace('?', `${company.slug}?`)
        : `${baseUri}${company.slug}`;
        
      const companyConnection = await mongoose.createConnection(companyUri);
      
      // Get Product model for this database
      const ProductModel = companyConnection.model('Product', Product.schema);
      
      // Update all products with unit = "pcs" to "ədəd"
      const result = await ProductModel.updateMany(
        { unit: 'pcs' },
        { $set: { unit: 'ədəd' } }
      );
      
      console.log(`  Updated ${result.modifiedCount} products from 'pcs' to 'ədəd'`);
      totalUpdated += result.modifiedCount;
      
      // Close company connection
      await companyConnection.close();
    }
    
    console.log(`\n✅ Migration complete! Total products updated: ${totalUpdated}`);
    
    // Close master connection
    await masterConnection.close();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
updateUnits();

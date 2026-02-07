require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const config = require('./config');

// Import Product model
const Product = require('./models/Product');

async function updateAllDatabases() {
  try {
    console.log('Connecting to MongoDB...');
    
    const baseUri = config.MONGODB_URI;
    const masterDbName = config.MASTER_DB_NAME || 'shalset-master';
    
    // Connect to master to get admin access
    const masterUri = baseUri.includes('?') 
      ? baseUri.replace('?', `${masterDbName}?`)
      : `${baseUri}${masterDbName}`;
    
    const masterConnection = await mongoose.createConnection(masterUri);
    console.log('Connected to master database');
    
    // Wait for connection to be ready
    await new Promise((resolve) => {
      if (masterConnection.readyState === 1) resolve();
      else masterConnection.once('open', resolve);
    });
    
    // Get list of ALL databases
    const admin = masterConnection.db.admin();
    const { databases } = await admin.listDatabases();
    
    console.log(`\nFound ${databases.length} total databases on server`);
    
    // Filter for company databases (exclude system databases)
    const companyDbs = databases.filter(db => 
      !['admin', 'local', 'config', 'shalset-master'].includes(db.name)
    );
    
    console.log(`Found ${companyDbs.length} company databases:\n`);
    companyDbs.forEach(db => console.log(`  - ${db.name}`));
    
    let totalUpdated = 0;
    let totalChecked = 0;
    
    // Update each database
    for (const db of companyDbs) {
      console.log(`\nProcessing database: ${db.name}`);
      
      try {
        // Connect to this database
        const dbUri = baseUri.includes('?')
          ? baseUri.replace('?', `${db.name}?`)
          : `${baseUri}${db.name}`;
          
        const dbConnection = await mongoose.createConnection(dbUri);
        
        // Get Product model for this database
        const ProductModel = dbConnection.model('Product', Product.schema);
        
        // Count products with "pcs"
        const pcsCount = await ProductModel.countDocuments({ unit: 'pcs' });
        console.log(`  Found ${pcsCount} products with unit='pcs'`);
        totalChecked += pcsCount;
        
        // Update all products with unit = "pcs" to "ədəd"
        if (pcsCount > 0) {
          const result = await ProductModel.updateMany(
            { unit: 'pcs' },
            { $set: { unit: 'ədəd' } }
          );
          
          console.log(`  ✅ Updated ${result.modifiedCount} products from 'pcs' to 'ədəd'`);
          totalUpdated += result.modifiedCount;
        } else {
          console.log(`  ⏭️  No products to update`);
        }
        
        // Close database connection
        await dbConnection.close();
        
      } catch (err) {
        console.error(`  ❌ Error processing ${db.name}:`, err.message);
      }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Migration complete!`);
    console.log(`   Total products with 'pcs': ${totalChecked}`);
    console.log(`   Total products updated: ${totalUpdated}`);
    console.log(`${'='.repeat(60)}\n`);
    
    // Close master connection
    await masterConnection.close();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
updateAllDatabases();

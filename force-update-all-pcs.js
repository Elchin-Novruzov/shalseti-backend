require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const config = require('./config');

// Import Product model
const Product = require('./models/Product');

async function checkAllCompaniesForPcs() {
  try {
    console.log('Checking ALL company databases for products with "pcs"...\n');
    
    const baseUri = config.MONGODB_URI;
    const masterDbName = config.MASTER_DB_NAME || 'shalset-master';
    
    // Connect to master database
    const masterUri = baseUri.includes('?') 
      ? baseUri.replace('?', `${masterDbName}?`)
      : `${baseUri}${masterDbName}`;
    
    const masterConnection = await mongoose.createConnection(masterUri);
    
    // Wait for connection
    await new Promise((resolve) => {
      if (masterConnection.readyState === 1) resolve();
      else masterConnection.once('open', resolve);
    });
    
    // Get list of ALL databases
    const admin = masterConnection.db.admin();
    const { databases } = await admin.listDatabases();
    
    // Filter for company databases
    const companyDbs = databases.filter(db => 
      !['admin', 'local', 'config', 'shalset-master'].includes(db.name)
    );
    
    console.log(`Checking ${companyDbs.length} databases...\n`);
    
    let totalPcsFound = 0;
    
    for (const db of companyDbs) {
      try {
        const dbUri = baseUri.includes('?')
          ? baseUri.replace('?', `${db.name}?`)
          : `${baseUri}${db.name}`;
          
        const dbConnection = await mongoose.createConnection(dbUri);
        const ProductModel = dbConnection.model('Product', Product.schema);
        
        // Count products with "pcs" or "PCS" or any variation
        const pcsCount = await ProductModel.countDocuments({ 
          unit: { $regex: /^pcs$/i } 
        });
        
        if (pcsCount > 0) {
          console.log(`❌ Database "${db.name}": ${pcsCount} products with "pcs"`);
          totalPcsFound += pcsCount;
          
          // Update them
          const result = await ProductModel.updateMany(
            { unit: { $regex: /^pcs$/i } },
            { $set: { unit: 'ədəd' } }
          );
          
          console.log(`   ✅ Updated ${result.modifiedCount} products to "ədəd"\n`);
        } else {
          console.log(`✓ Database "${db.name}": No "pcs" found`);
        }
        
        await dbConnection.close();
        
      } catch (err) {
        console.error(`  ❌ Error processing ${db.name}:`, err.message);
      }
    }
    
    await masterConnection.close();
    
    if (totalPcsFound > 0) {
      console.log(`\n✅ Found and updated ${totalPcsFound} total products with "pcs"`);
    } else {
      console.log(`\n✅ No products with "pcs" found in any database!`);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

checkAllCompaniesForPcs();

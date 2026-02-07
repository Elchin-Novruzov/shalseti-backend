require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const config = require('./config');

// Import Product model
const Product = require('./models/Product');

async function fixAllUnits() {
  try {
    console.log('Fixing units in ALL company databases...\n');
    
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
    
    console.log(`Processing ${companyDbs.length} databases...\n`);
    
    let totalPcsUpdated = 0;
    let totalNullUpdated = 0;
    
    for (const db of companyDbs) {
      try {
        const dbUri = baseUri.includes('?')
          ? baseUri.replace('?', `${db.name}?`)
          : `${baseUri}${db.name}`;
          
        const dbConnection = await mongoose.createConnection(dbUri);
        const ProductModel = dbConnection.model('Product', Product.schema);
        
        // 1. Change all "pcs" to "ədəd"
        const pcsResult = await ProductModel.updateMany(
          { unit: { $regex: /^pcs$/i } },
          { $set: { unit: 'ədəd' } }
        );
        
        // 2. Add "ədəd" to products without unit (null, undefined, or empty string)
        const nullResult = await ProductModel.updateMany(
          { $or: [
            { unit: null },
            { unit: { $exists: false } },
            { unit: '' }
          ]},
          { $set: { unit: 'ədəd' } }
        );
        
        if (pcsResult.modifiedCount > 0 || nullResult.modifiedCount > 0) {
          console.log(`Database "${db.name}":`);
          if (pcsResult.modifiedCount > 0) {
            console.log(`  ✅ Changed ${pcsResult.modifiedCount} products from "pcs" to "ədəd"`);
            totalPcsUpdated += pcsResult.modifiedCount;
          }
          if (nullResult.modifiedCount > 0) {
            console.log(`  ✅ Added "ədəd" to ${nullResult.modifiedCount} products without unit`);
            totalNullUpdated += nullResult.modifiedCount;
          }
          console.log('');
        } else {
          console.log(`✓ Database "${db.name}": No updates needed`);
        }
        
        await dbConnection.close();
        
      } catch (err) {
        console.error(`  ❌ Error processing ${db.name}:`, err.message);
      }
    }
    
    await masterConnection.close();
    
    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY:');
    console.log(`✅ Changed ${totalPcsUpdated} products from "pcs" to "ədəd"`);
    console.log(`✅ Added "ədəd" to ${totalNullUpdated} products without unit`);
    console.log(`✅ Total: ${totalPcsUpdated + totalNullUpdated} products updated`);
    console.log('='.repeat(50));
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

fixAllUnits();

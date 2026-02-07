require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const config = require('./config');

// Import Product model
const Product = require('./models/Product');

async function checkAndUpdateBarcodeDatabase() {
  try {
    console.log('Connecting to barcode database...');
    
    const baseUri = config.MONGODB_URI;
    
    // Connect to barcode database
    const barcodeUri = baseUri.includes('?')
      ? baseUri.replace('?', 'barcode?')
      : `${baseUri}barcode`;
    
    console.log(`Connecting to: ${barcodeUri.replace(/:[^:@]+@/, ':****@')}`);
    
    const barcodeConnection = await mongoose.createConnection(barcodeUri);
    
    console.log('Connected to barcode database\n');
    
    // Get Product model
    const ProductModel = barcodeConnection.model('Product', Product.schema);
    
    // Count all products
    const totalProducts = await ProductModel.countDocuments();
    console.log(`Total products in database: ${totalProducts}`);
    
    // Count products with "pcs"
    const pcsCount = await ProductModel.countDocuments({ unit: 'pcs' });
    console.log(`Products with unit='pcs': ${pcsCount}`);
    
    // Count products with "ədəd"
    const ededCount = await ProductModel.countDocuments({ unit: 'ədəd' });
    console.log(`Products with unit='ədəd': ${ededCount}`);
    
    // Count products with other units
    const otherCount = await ProductModel.countDocuments({ 
      unit: { $nin: ['pcs', 'ədəd'] } 
    });
    console.log(`Products with other units: ${otherCount}\n`);
    
    if (pcsCount > 0) {
      console.log(`Updating ${pcsCount} products from 'pcs' to 'ədəd'...\n`);
      
      // Update all products with unit = "pcs" to "ədəd"
      const result = await ProductModel.updateMany(
        { unit: 'pcs' },
        { $set: { unit: 'ədəd' } }
      );
      
      console.log(`✅ Updated ${result.modifiedCount} products successfully!\n`);
      
      // Verify the update
      const remainingPcs = await ProductModel.countDocuments({ unit: 'pcs' });
      const newEdedCount = await ProductModel.countDocuments({ unit: 'ədəd' });
      
      console.log('After update:');
      console.log(`  Products with unit='pcs': ${remainingPcs}`);
      console.log(`  Products with unit='ədəd': ${newEdedCount}`);
    } else {
      console.log('✅ No products with unit="pcs" found. All products already updated!');
    }
    
    // Close connection
    await barcodeConnection.close();
    console.log('\n✅ Complete!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
checkAndUpdateBarcodeDatabase();

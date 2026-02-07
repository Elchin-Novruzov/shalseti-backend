require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const config = require('./config');

// Import Product model
const Product = require('./models/Product');

async function checkSpecificProducts() {
  try {
    console.log('Connecting to barcode database...\n');
    
    const baseUri = config.MONGODB_URI;
    
    // Connect to barcode database
    const barcodeUri = baseUri.includes('?')
      ? baseUri.replace('?', 'barcode?')
      : `${baseUri}barcode`;
    
    const barcodeConnection = await mongoose.createConnection(barcodeUri);
    
    console.log('Connected to barcode database\n');
    
    // Get Product model
    const ProductModel = barcodeConnection.model('Product', Product.schema);
    
    // Check specific products from the screenshot
    const barcodes = ['381', '380', '379', '378', '377', '376', '375', '374'];
    
    console.log('Checking specific products from screenshot:\n');
    
    for (const barcode of barcodes) {
      const product = await ProductModel.findOne({ barcode });
      if (product) {
        console.log(`Barcode ${barcode} (${product.name}):`);
        console.log(`  Unit: "${product.unit}"`);
        console.log(`  Stock: ${product.currentStock}`);
        console.log('');
      }
    }
    
    // Check if there are ANY products with unit containing "pcs" (case-insensitive)
    console.log('\nSearching for any products with "pcs" in unit field...\n');
    
    const pcsProducts = await ProductModel.find({ 
      unit: { $regex: /pcs/i } 
    }).limit(10);
    
    if (pcsProducts.length > 0) {
      console.log(`Found ${pcsProducts.length} products with "pcs":\n`);
      pcsProducts.forEach(p => {
        console.log(`  Barcode: ${p.barcode}, Name: ${p.name}, Unit: "${p.unit}"`);
      });
      
      console.log('\n❌ Products with "pcs" still exist! Updating them...\n');
      
      const result = await ProductModel.updateMany(
        { unit: { $regex: /pcs/i } },
        { $set: { unit: 'ədəd' } }
      );
      
      console.log(`✅ Updated ${result.modifiedCount} products from "pcs" to "ədəd"`);
    } else {
      console.log('✅ No products with "pcs" found in database!');
      console.log('   The "pcs" you see is likely from the frontend display fallback.');
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
checkSpecificProducts();

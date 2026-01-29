const mongoose = require('mongoose');
const config = require('./config');
const Product = require('./models/Product');

// Old backend data - will be fetched
const OLD_API = 'https://barcode-backend-shalset.onrender.com';

async function migrate() {
  try {
    // Login to old backend
    console.log('Logging into old backend...');
    const loginRes = await fetch(`${OLD_API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const loginData = await loginRes.json();
    const oldToken = loginData.token;
    console.log('Logged in to old backend');

    // Fetch all products from old backend
    console.log('Fetching products from old backend...');
    const productsRes = await fetch(`${OLD_API}/api/products?limit=10000`, {
      headers: { 'Authorization': `Bearer ${oldToken}` }
    });
    const productsData = await productsRes.json();
    const oldProducts = productsData.products;
    console.log(`Found ${oldProducts.length} products to migrate`);

    // Connect to new MongoDB
    console.log('Connecting to new MongoDB...');
    await mongoose.connect(config.MONGODB_URI);
    console.log('Connected to new MongoDB');

    // Migrate each product
    let migrated = 0;
    let skipped = 0;
    
    for (const oldProduct of oldProducts) {
      try {
        // Check if product already exists
        const existing = await Product.findOne({ barcode: oldProduct.barcode });
        if (existing) {
          console.log(`Skipping ${oldProduct.name} - already exists`);
          skipped++;
          continue;
        }

        // Create new product with old data
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
        console.log(`Migrated: ${oldProduct.name}`);
        migrated++;
      } catch (err) {
        console.error(`Failed to migrate ${oldProduct.name}:`, err.message);
      }
    }

    console.log('\n--- Migration Complete ---');
    console.log(`Migrated: ${migrated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Total: ${oldProducts.length}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

migrate();

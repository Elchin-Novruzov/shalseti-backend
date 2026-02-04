const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('./models/User');
const Product = require('./models/Product');
const config = require('./config');

async function listData() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log('Connected to MongoDB:', config.MONGODB_URI.replace(/\/\/.*@/, '//***@'));
    
    console.log('\n=== USERS ===');
    const users = await User.find().select('-password');
    console.log(`Total users: ${users.length}`);
    users.forEach(u => {
      console.log(`- ${u.username} (${u.fullName}) - ${u.role} - created: ${u.createdAt}`);
    });
    
    console.log('\n=== PRODUCTS ===');
    const productCount = await Product.countDocuments();
    console.log(`Total products: ${productCount}`);
    
    const recentProducts = await Product.find().sort({ createdAt: -1 }).limit(5).select('barcode name createdAt');
    console.log('Recent products:');
    recentProducts.forEach(p => {
      console.log(`- ${p.barcode}: ${p.name} (${p.createdAt})`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

listData();

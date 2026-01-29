const mongoose = require('mongoose');
const config = require('./config');
const User = require('./models/User');

// Usage: node make-admin.js <username>
// Example: node make-admin.js elchin

async function makeAdmin() {
  const username = process.argv[2];
  
  if (!username) {
    console.log('Usage: node make-admin.js <username>');
    console.log('Example: node make-admin.js admin');
    process.exit(1);
  }
  
  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    const user = await User.findOne({ username: username.toLowerCase() });
    
    if (!user) {
      console.log(`User "${username}" not found`);
      process.exit(1);
    }
    
    user.role = 'admin';
    await user.save();
    
    console.log(`User "${username}" is now an admin!`);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

makeAdmin();

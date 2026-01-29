const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('./models/User');
const config = require('./config');

async function createUser() {
  try {
    await mongoose.connect(config.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check if user already exists
    const existing = await User.findOne({ username: 'elchin' });
    if (existing) {
      console.log('User "elchin" already exists!');
      console.log('Role:', existing.role);
      process.exit(0);
    }

    // Create new admin user
    const user = new User({
      username: 'elchin',
      password: 'Elchin2024!',
      fullName: 'Elchin',
      role: 'admin'
    });

    await user.save();
    
    console.log('\n✅ User created successfully!');
    console.log('================================');
    console.log('Username: elchin');
    console.log('Password: Elchin2024!');
    console.log('Role: admin');
    console.log('================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

createUser();

const mongoose = require('mongoose');
const config = require('./config');
const User = require('./models/User');

// Mock users to create
const mockUsers = [
  {
    username: 'admin',
    password: 'admin123',
    fullName: 'Administrator',
    role: 'admin'
  },
  {
    username: 'user1',
    password: 'user123',
    fullName: 'John Doe',
    role: 'user'
  },
  {
    username: 'user2',
    password: 'user123',
    fullName: 'Jane Smith',
    role: 'user'
  }
];

async function seedDatabase() {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    // SAFETY CHECK: Only seed if no users exist (prevents accidental data loss)
    const existingUserCount = await User.countDocuments();
    if (existingUserCount > 0) {
      console.log(`\n⚠️  Database already has ${existingUserCount} user(s). Seeding skipped to protect existing data.`);
      console.log('If you need to reset users, manually delete them first.\n');
      process.exit(0);
    }
    
    console.log('No existing users found. Proceeding with seeding...');
    
    // Create mock users
    for (const userData of mockUsers) {
      const existingUser = await User.findOne({ username: userData.username });
      if (existingUser) {
        console.log(`User "${userData.username}" already exists, skipping...`);
        continue;
      }
      
      const user = new User(userData);
      await user.save();
      console.log(`Created user: ${userData.username} (password: ${userData.password})`);
    }
    
    console.log('\n--- Mock Accounts Created ---');
    console.log('1. Username: admin, Password: admin123');
    console.log('2. Username: user1, Password: user123');
    console.log('3. Username: user2, Password: user123');
    console.log('-----------------------------\n');
    
    console.log('Database seeding completed!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
}

seedDatabase();

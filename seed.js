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
    
    // Clear existing users (optional - comment out if you want to keep existing users)
    await User.deleteMany({});
    console.log('Cleared existing users');
    
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

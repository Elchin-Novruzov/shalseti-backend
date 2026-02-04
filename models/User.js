const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Company access sub-schema
const companyAccessSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  companySlug: {
    type: String,
    required: true
  },
  companyName: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'user'],
    default: 'user'
  }
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [4, 'Password must be at least 4 characters']
  },
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true
  },
  profileImage: {
    type: String,
    default: null
  },
  // Legacy role field - kept for backward compatibility
  role: {
    type: String,
    enum: ['admin', 'user'],
    default: 'user'
  },
  // Super admin can access all companies and create new ones
  isSuperAdmin: {
    type: Boolean,
    default: false
  },
  // Array of companies user can access with role per company
  companyAccess: [companyAccessSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: null
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

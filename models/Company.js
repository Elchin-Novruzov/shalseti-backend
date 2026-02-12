const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true
  },
  slug: {
    type: String,
    required: [true, 'Company slug is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens']
  },
  logo: {
    type: String,
    default: ''
  },
  color: {
    type: String,
    default: '#E53935' // Default red color
  },
  description: {
    type: String,
    default: ''
  },
  documentName: {
    type: String,
    default: 'Forma 013',
    trim: true
  },
  documentNo: {
    type: String,
    default: 'SHAL-ANB-F-038-13',
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
companySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Generate slug from name if not provided
companySchema.pre('validate', function(next) {
  if (!this.slug && this.name) {
    this.slug = this.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
  next();
});

module.exports = mongoose.model('Company', companySchema);

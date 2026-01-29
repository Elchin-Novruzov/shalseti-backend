const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  description: {
    type: String,
    default: '',
    trim: true
  },
  color: {
    type: String,
    default: '#3b82f6' // Default blue color
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdByName: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Category', categorySchema);

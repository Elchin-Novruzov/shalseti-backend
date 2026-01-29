const mongoose = require('mongoose');

const stockHistorySchema = new mongoose.Schema({
  quantity: { type: Number, required: true },
  type: { type: String, enum: ['add', 'remove'], required: true },
  note: { type: String, default: '' },
  supplier: { type: String, default: '' },  // Where items were bought from (for 'add')
  location: { type: String, default: '' },  // Where items were sold/moved to (for 'remove')
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  addedByName: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const productSchema = new mongoose.Schema({
  barcode: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true,
    index: true 
  },
  name: { 
    type: String, 
    required: true, 
    trim: true 
  },
  currentStock: { 
    type: Number, 
    default: 0,
    min: 0
  },
  note: { 
    type: String, 
    default: '' 
  },
  buyingPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  sellingPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  boughtFrom: {
    type: String,
    default: '',
    trim: true
  },
  sellLocation: {
    type: String,
    default: '',
    trim: true
  },
  imageUrl: {
    type: String,
    default: ''
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  categoryName: {
    type: String,
    default: ''
  },
  stockHistory: [stockHistorySchema],
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  },
  createdByName: { 
    type: String 
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
productSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Product', productSchema);

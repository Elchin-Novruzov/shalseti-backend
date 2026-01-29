const mongoose = require('mongoose');

const scanSchema = new mongoose.Schema({
  barcode: {
    type: String,
    required: [true, 'Barcode data is required'],
    trim: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User is required']
  },
  username: {
    type: String,
    required: true
  },
  userFullName: {
    type: String,
    required: true
  },
  scannedAt: {
    type: Date,
    default: Date.now
  },
  scanMode: {
    type: String,
    enum: ['keyboard', 'camera'],
    default: 'keyboard'
  },
  deviceInfo: {
    type: String,
    default: null
  },
  location: {
    type: String,
    default: null
  }
});

// Index for efficient queries
scanSchema.index({ user: 1, scannedAt: -1 });
scanSchema.index({ barcode: 1 });
scanSchema.index({ scannedAt: -1 });

module.exports = mongoose.model('Scan', scanSchema);

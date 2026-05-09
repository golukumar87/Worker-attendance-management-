const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  employeeId: {
    type: String
  },
  type: {
    type: String,
    enum: ['late', 'absent', 'leave', 'geofence', 'system', 'payroll'],
    default: 'system'
  },
  level: {
    type: String,
    enum: ['info', 'warning', 'critical'],
    default: 'info'
  },
  title: {
    type: String,
    default: ''
  },
  message: {
    type: String,
    default: ''
  },
  meta: {
    type: Object,
    default: {}
  },
  readAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Alert', alertSchema);

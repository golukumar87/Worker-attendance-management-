const mongoose = require('mongoose');

const biometricEventSchema = new mongoose.Schema({
  employeeId: {
    type: String,
    required: true
  },
  deviceId: {
    type: String,
    default: ''
  },
  eventType: {
    type: String,
    enum: ['checkin', 'checkout'],
    default: 'checkin'
  },
  eventTime: {
    type: Date,
    default: Date.now
  },
  rawPayload: {
    type: Object,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('BiometricEvent', biometricEventSchema);

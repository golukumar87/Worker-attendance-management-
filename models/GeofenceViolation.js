const mongoose = require('mongoose');

const geofenceViolationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  employeeId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    default: ''
  },
  location: {
    type: String,
    default: ''
  },
  locationLat: {
    type: Number
  },
  locationLng: {
    type: Number
  },
  locationAccuracy: {
    type: Number
  },
  reason: {
    type: String,
    default: 'Outside geo-fence'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('GeofenceViolation', geofenceViolationSchema);

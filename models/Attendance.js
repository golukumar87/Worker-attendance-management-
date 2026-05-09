const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  employeeId: {
    type: String,
    required: true
  },
  department: {
    type: String,
    enum: ['HR', 'IT', 'Finance', 'Marketing', 'Operations', 'Sales'],
    default: 'IT'
  },
  checkInTime: {
    type: Date,
    default: Date.now
  },
  checkOutTime: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['Present', 'Late', 'Absent', 'Half-Day', 'Holiday'],
    default: 'Present'
  },
  overtime: {
    type: Number,
    default: 0
  },
  notes: {
    type: String,
    maxlength: 500
  },
  shift: {
    type: String,
    enum: ['Day', 'Night', 'Extra Work'],
    default: 'Day'
  },
  location: {
    type: String,
    maxlength: 200
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
  source: {
    type: String,
    enum: ['manual', 'qr'],
    default: 'manual'
  },
  checkInPhotoUrl: {
    type: String,
    default: ''
  },
  checkOutPhotoUrl: {
    type: String,
    default: ''
  },
  faceCaptureUrl: {
    type: String,
    default: ''
  },
  livenessPassed: {
    type: Boolean,
    default: false
  },
  livenessScore: {
    type: Number
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

// Update timestamp on save
attendanceSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Calculate work hours
attendanceSchema.methods.calculateWorkHours = function() {
  if (this.checkInTime && this.checkOutTime) {
    const diff = this.checkOutTime - this.checkInTime;
    return diff / (1000 * 60 * 60); // Convert to hours
  }
  return 0;
};

module.exports = mongoose.model('Attendance', attendanceSchema);

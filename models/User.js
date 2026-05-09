const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'vice_admin', 'employee', 'manager'],
    default: 'employee'
  },
  department: {
    type: String,
    enum: ['HR', 'IT', 'Finance', 'Marketing', 'Operations', 'Sales'],
    default: 'IT'
  },
  employeeId: {
    type: String,
    unique: true,
    required: true
  },
  phone: {
    type: String
  },
  profilePicture: {
    type: String
  },
  faceDescriptor: {
    type: [Number],
    default: []
  },
  faceEnrolled: {
    type: Boolean,
    default: false
  },
  attendancePinHash: {
    type: String
  },
  attendancePinUpdatedAt: {
    type: Date
  },
  faceUpdatedAt: {
    type: Date
  },
  deviceId: {
    type: String
  },
  deviceName: {
    type: String
  },
  deviceBoundAt: {
    type: Date
  },
  deviceLastSeenAt: {
    type: Date
  },
  defaultShift: {
    type: String,
    enum: ['Day', 'Night', 'Extra Work'],
    default: 'Day'
  },
  notifyEmail: {
    type: Boolean,
    default: true
  },
  notifySms: {
    type: Boolean,
    default: false
  },
  notifyWhatsapp: {
    type: Boolean,
    default: false
  },
  deviceOtpHash: {
    type: String
  },
  deviceOtpExpiresAt: {
    type: Date
  },
  pendingDeviceId: {
    type: String
  },
  pendingDeviceName: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

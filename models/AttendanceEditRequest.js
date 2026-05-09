const mongoose = require('mongoose');

const attendanceEditRequestSchema = new mongoose.Schema({
  attendanceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Attendance',
    required: true
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  requestedByName: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  changes: {
    type: Object,
    default: {}
  },
  reason: {
    type: String,
    default: ''
  },
  reviewedBy: {
    type: String,
    default: ''
  },
  reviewedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('AttendanceEditRequest', attendanceEditRequestSchema);

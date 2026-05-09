const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
  employeeId: { type: String, required: true },
  name: { type: String, required: true },
  shift: { type: String, enum: ['Day', 'Night', 'Extra Work'], default: 'Day' }
}, { _id: false });

const shiftRosterSchema = new mongoose.Schema({
  weekStart: {
    type: Date,
    required: true
  },
  department: {
    type: String,
    required: true
  },
  assignments: [assignmentSchema],
  updatedBy: {
    type: String,
    default: ''
  }
}, { timestamps: true });

shiftRosterSchema.index({ weekStart: 1, department: 1 }, { unique: true });

module.exports = mongoose.model('ShiftRoster', shiftRosterSchema);

const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema({
  employeeId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  department: {
    type: String,
    default: 'IT'
  },
  shift: {
    type: String,
    enum: ['Day', 'Night', 'Extra Work'],
    default: 'Day'
  },
  salary: {
    type: Number,
    min: 0,
    default: 0
  },
  halfDay: {
    type: Number,
    min: 0,
    default: 0
  },
  advancePaid: {
    type: Number,
    min: 0,
    default: 0
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

payrollSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('EmployeePayroll', payrollSchema);

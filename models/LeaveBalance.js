const mongoose = require('mongoose');

const leaveBalanceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  employeeId: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  department: {
    type: String
  },
  year: {
    type: Number,
    required: true
  },
  total: {
    type: Number,
    default: 24
  },
  used: {
    type: Number,
    default: 0
  },
  remaining: {
    type: Number,
    default: 24
  }
}, { timestamps: true });

leaveBalanceSchema.pre('save', function(next) {
  this.remaining = Math.max(0, (this.total || 0) - (this.used || 0));
  next();
});

module.exports = mongoose.model('LeaveBalance', leaveBalanceSchema);

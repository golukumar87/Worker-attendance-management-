const mongoose = require('mongoose');

const autoReportSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['weekly', 'monthly'],
    required: true
  },
  periodStart: {
    type: Date,
    required: true
  },
  periodEnd: {
    type: Date,
    required: true
  },
  generatedBy: {
    type: String,
    default: ''
  },
  payload: {
    type: Object,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('AutoReport', autoReportSchema);

const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const BiometricEvent = require('../models/BiometricEvent');
const moment = require('moment');

router.post('/punch', async (req, res) => {
  try {
    const apiKey = req.headers['x-biometric-key'];
    if (process.env.BIOMETRIC_API_KEY && apiKey !== process.env.BIOMETRIC_API_KEY) {
      return res.status(403).json({ success: false, message: 'Invalid biometric key.' });
    }
    const { employeeId, eventType, eventTime, deviceId } = req.body;
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'employeeId required.' });
    }
    const user = await User.findOne({ employeeId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }
    const event = await BiometricEvent.create({
      employeeId,
      eventType: eventType || 'checkin',
      eventTime: eventTime ? new Date(eventTime) : new Date(),
      deviceId: deviceId || '',
      rawPayload: req.body || {}
    });

    const startOfDay = moment(event.eventTime).startOf('day').toDate();
    const endOfDay = moment(event.eventTime).endOf('day').toDate();
    let attendance = await Attendance.findOne({
      employeeId,
      checkInTime: { $gte: startOfDay, $lte: endOfDay }
    });

    if (event.eventType === 'checkout') {
      if (attendance && !attendance.checkOutTime) {
        attendance.checkOutTime = event.eventTime;
        await attendance.save();
      }
    } else {
      if (!attendance) {
        attendance = await Attendance.create({
          name: user.username,
          employeeId,
          department: user.department,
          status: 'Present',
          shift: user.defaultShift || 'Day',
          checkInTime: event.eventTime,
          source: 'manual'
        });
      }
    }

    res.json({ success: true, data: event });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

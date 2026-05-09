const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Alert = require('../models/Alert');
const AuditLog = require('../models/AuditLog');
const GeofenceViolation = require('../models/GeofenceViolation');
const AutoReport = require('../models/AutoReport');
const AttendanceEditRequest = require('../models/AttendanceEditRequest');
const { verifyToken, isAdmin, isManagerOrAdmin } = require('../middleware/auth');
const ipWhitelist = require('../middleware/ipWhitelist');
const { body, validationResult } = require('express-validator');
const moment = require('moment');
const fs = require('fs').promises;
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sendEmail, sendSms, sendWhatsapp } = require('../utils/notify');
const { sendWebhooks } = require('../utils/webhook');

const logAudit = async (req, action, entityType, entityId, meta = {}) => {
  try {
    await AuditLog.create({
      actorId: req.user?._id,
      actorName: req.user?.username || req.user?.employeeId || '',
      action,
      entityType,
      entityId: entityId ? String(entityId) : '',
      meta,
      ip: req.ip || '',
      userAgent: req.get('user-agent') || ''
    });
  } catch (_) {}
};

const createAlert = async ({ userId, employeeId, type, level, title, message, meta }) => {
  try {
    const alert = await Alert.create({
      userId,
      employeeId,
      type,
      level,
      title,
      message,
      meta
    });
    if (userId) {
      const user = await User.findById(userId).select('email phone notifyEmail notifySms notifyWhatsapp');
      if (user?.notifyEmail && user.email) {
        await sendEmail({ to: user.email, subject: title || 'Alert', text: message || '' });
      }
      if (user?.notifySms && user.phone) {
        await sendSms({ to: user.phone, text: message || '' });
      }
      if (user?.notifyWhatsapp && user.phone) {
        await sendWhatsapp({ to: user.phone, text: message || '' });
      }
    }
    return alert;
  } catch (_) {}
};

const saveBase64Image = async (dataUrl) => {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  if (!match) return '';
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
  await fs.mkdir(uploadsDir, { recursive: true });
  const filename = `face-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  const filePath = path.join(uploadsDir, filename);
  await fs.writeFile(filePath, buffer);
  return `/uploads/${filename}`;
};

// Get all attendance records with filters
router.get('/', async (req, res) => {
  try {
    const { date, department, status, employeeId } = req.query;
    let query = {};

    // Filter by date
    if (date) {
      const startDate = moment(date).startOf('day').toDate();
      const endDate = moment(date).endOf('day').toDate();
      query.checkInTime = { $gte: startDate, $lte: endDate };
    } else {
      // Default to today
      const startOfDay = moment().startOf('day').toDate();
      const endOfDay = moment().endOf('day').toDate();
      query.checkInTime = { $gte: startOfDay, $lte: endOfDay };
    }

    // Filter by department
    if (department) {
      query.department = department;
    }

    // Filter by status
    if (status) {
      query.status = status;
    }

    if (employeeId) {
      query.employeeId = employeeId;
    }

    const records = await Attendance.find(query).sort({ checkInTime: -1 });
    
    // Calculate statistics
    const stats = {
      total: records.length,
      present: records.filter(r => r.status === 'Present').length,
      late: records.filter(r => r.status === 'Late').length,
      absent: records.filter(r => r.status === 'Absent').length,
      halfDay: records.filter(r => r.status === 'Half-Day').length
    };

    res.json({
      success: true,
      data: records,
      stats: stats
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Mark attendance (Check-in)
router.post('/checkin',
  ipWhitelist,
  [
    body('name').notEmpty().trim(),
    body('employeeId').notEmpty(),
    body('department').optional(),
    body('shift').optional().isIn(['Day', 'Night', 'Extra Work'])
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { name, employeeId, department, notes, shift, location, locationLat, locationLng, locationAccuracy, checkInPhoto, livenessPassed, livenessScore } = req.body;

      // Check if already checked in today
      const startOfDay = moment().startOf('day').toDate();
      const endOfDay = moment().endOf('day').toDate();
      
      const existingAttendance = await Attendance.findOne({
        employeeId,
        checkInTime: { $gte: startOfDay, $lte: endOfDay }
      });

      if (existingAttendance) {
        return res.status(400).json({ 
          success: false, 
          message: 'You have already marked attendance today' 
        });
      }

      // Determine status based on time
      const checkInTime = new Date();
      const hour = checkInTime.getHours();
      const minute = checkInTime.getMinutes();
      
      let status = 'Present';
      // Consider 9:30 AM as late threshold
      if (hour > 9 || (hour === 9 && minute > 30)) {
        status = 'Late';
      }

      const checkInPhotoUrl = await saveBase64Image(checkInPhoto);
      const attendance = await Attendance.create({
        name,
        employeeId,
        department,
        status,
        notes,
        shift,
        location,
        locationLat,
        locationLng,
        locationAccuracy,
        checkInPhotoUrl,
        livenessPassed: Boolean(livenessPassed),
        livenessScore,
        checkInTime
      });
      await logAudit(req, 'attendance_checkin', 'Attendance', attendance._id, { employeeId, status });
      if (status === 'Late') {
        await createAlert({
          userId: req.user?._id,
          employeeId,
          type: 'late',
          level: 'warning',
          title: 'Late Check-in',
          message: `${name} checked in late.`,
          meta: { checkInTime }
        });
      }
      await sendWebhooks('attendance.checkin', { employeeId, status, attendanceId: attendance._id });

      // Emit real-time update
      const io = req.app.get('io');
      io.emit('attendance-update', { 
        type: 'checkin', 
        data: attendance 
      });

    res.json({ 
      success: true, 
      message: 'Attendance marked successfully',
      data: attendance 
    });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
});

// Check-out
router.post('/checkout/:employeeId', ipWhitelist, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { location, locationLat, locationLng, locationAccuracy, checkOutPhoto } = req.body || {};
    
    // Find today's attendance
    const startOfDay = moment().startOf('day').toDate();
    const endOfDay = moment().endOf('day').toDate();
    
    const attendance = await Attendance.findOne({
      employeeId,
      checkInTime: { $gte: startOfDay, $lte: endOfDay }
    });

    if (!attendance) {
      return res.status(404).json({ 
        success: false, 
        message: 'No check-in record found for today' 
      });
    }

    if (attendance.checkOutTime) {
      return res.status(400).json({ 
        success: false, 
        message: 'You have already checked out today' 
      });
    }

    attendance.checkOutTime = new Date();
    if (location) attendance.location = location;
    if (typeof locationLat !== 'undefined') attendance.locationLat = locationLat;
    if (typeof locationLng !== 'undefined') attendance.locationLng = locationLng;
    if (typeof locationAccuracy !== 'undefined') attendance.locationAccuracy = locationAccuracy;
    const checkOutPhotoUrl = await saveBase64Image(checkOutPhoto);
    if (checkOutPhotoUrl) attendance.checkOutPhotoUrl = checkOutPhotoUrl;
    
    // Calculate overtime (if working beyond 6 PM)
    const checkOutHour = attendance.checkOutTime.getHours();
    if (checkOutHour >= 18) {
      attendance.overtime = checkOutHour - 18;
    }

    await attendance.save();
    await logAudit(req, 'attendance_checkout', 'Attendance', attendance._id, { employeeId });
    await sendWebhooks('attendance.checkout', { employeeId, attendanceId: attendance._id });

    // Emit real-time update
    const io = req.app.get('io');
    io.emit('attendance-update', { 
      type: 'checkout', 
      data: attendance 
    });

    res.json({ 
      success: true, 
      message: 'Check-out successful',
      data: attendance 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Generate signed QR token (short-lived)
router.post('/qr-token', verifyToken, async (req, res) => {
  try {
    const payload = { employeeId: req.user.employeeId, userId: req.userId };
    const token = jwt.sign(payload, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '5m' });
    res.json({ success: true, token, expiresIn: 300 });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Unable to generate QR token' });
  }
});

// QR scan check-in/check-out (Manager/Admin)
router.post('/qr-scan', ipWhitelist, verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const { token: qrToken, location, faceImage, faceVerified, pin, livenessPassed, livenessScore, locationLat, locationLng, locationAccuracy } = req.body;
    if (!qrToken) {
      return res.status(400).json({ success: false, message: 'QR token is required.' });
    }
    if (!faceImage || faceVerified !== true) {
      return res.status(400).json({ success: false, message: 'Face verification required.' });
    }
    if (livenessPassed !== true) {
      return res.status(400).json({ success: false, message: 'Liveness check failed.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(qrToken, process.env.JWT_SECRET || 'your-secret-key');
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired QR token.' });
    }

    const employeeId = decoded.employeeId;

    const user = await User.findOne({ employeeId });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }
    if (!user.attendancePinHash) {
      return res.status(400).json({ success: false, message: 'Employee PIN not set. Please set PIN in profile.' });
    }
    const pinValid = await bcrypt.compare(String(pin || ''), user.attendancePinHash);
    if (!pinValid) {
      return res.status(401).json({ success: false, message: 'Invalid PIN.' });
    }

    const startOfDay = moment().startOf('day').toDate();
    const endOfDay = moment().endOf('day').toDate();
    let attendance = await Attendance.findOne({
      employeeId,
      checkInTime: { $gte: startOfDay, $lte: endOfDay }
    });

    const faceCaptureUrl = await saveBase64Image(faceImage);

    if (attendance && !attendance.checkOutTime) {
      attendance.checkOutTime = new Date();
      attendance.source = 'qr';
      if (location) attendance.location = location;
      if (typeof locationLat !== 'undefined') attendance.locationLat = locationLat;
      if (typeof locationLng !== 'undefined') attendance.locationLng = locationLng;
      if (typeof locationAccuracy !== 'undefined') attendance.locationAccuracy = locationAccuracy;
      if (faceCaptureUrl) attendance.faceCaptureUrl = faceCaptureUrl;
      attendance.livenessPassed = true;
      attendance.livenessScore = livenessScore;
      await attendance.save();
      await logAudit(req, 'attendance_checkout_qr', 'Attendance', attendance._id, { employeeId });
      await sendWebhooks('attendance.checkout.qr', { employeeId, attendanceId: attendance._id });

      const io = req.app.get('io');
      io.emit('attendance-update', { type: 'checkout', data: attendance });

      return res.json({
        success: true,
        action: 'checkout',
        message: 'Check-out successful',
        data: attendance
      });
    }

    const checkInTime = new Date();
    const hour = checkInTime.getHours();
    const minute = checkInTime.getMinutes();
    let status = 'Present';
    if (hour > 9 || (hour === 9 && minute > 30)) {
      status = 'Late';
    }

    attendance = await Attendance.create({
      name: user.username,
      employeeId: user.employeeId,
      department: user.department,
      status,
      shift: 'Day',
      location: location || '',
      locationLat,
      locationLng,
      locationAccuracy,
      checkInTime,
      source: 'qr',
      faceCaptureUrl: faceCaptureUrl || '',
      livenessPassed: true,
      livenessScore,
      createdBy: req.user?._id
    });
    await logAudit(req, 'attendance_checkin_qr', 'Attendance', attendance._id, { employeeId, status });
    await sendWebhooks('attendance.checkin.qr', { employeeId, attendanceId: attendance._id, status });

    const io = req.app.get('io');
    io.emit('attendance-update', { type: 'checkin', data: attendance });

    res.json({
      success: true,
      action: 'checkin',
      message: 'Check-in successful',
      data: attendance
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get attendance report
router.get('/report', async (req, res) => {
  try {
    const { startDate, endDate, department } = req.query;
    
    const query = {};
    
    if (startDate && endDate) {
      query.checkInTime = {
        $gte: moment(startDate).startOf('day').toDate(),
        $lte: moment(endDate).endOf('day').toDate()
      };
    }
    
    if (department) {
      query.department = department;
    }

    const records = await Attendance.find(query).sort({ checkInTime: 1 });

    // Group by date for report
    const report = {};
    records.forEach(record => {
      const date = moment(record.checkInTime).format('YYYY-MM-DD');
      if (!report[date]) {
        report[date] = {
          date,
          total: 0,
          present: 0,
          late: 0,
          absent: 0,
          employees: []
        };
      }
      
      report[date].total++;
      report[date][record.status.toLowerCase()]++;
      report[date].employees.push({
        name: record.name,
        status: record.status,
        checkIn: record.checkInTime,
        checkOut: record.checkOutTime
      });
    });

    res.json({
      success: true,
      data: Object.values(report)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update attendance record (Admin only)
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    updates.updatedAt = Date.now();
    
    const attendance = await Attendance.findByIdAndUpdate(id, updates, { 
      new: true,
      runValidators: true 
    });

    if (!attendance) {
      return res.status(404).json({ 
        success: false, 
        message: 'Attendance record not found' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Record updated successfully',
      data: attendance 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Request attendance edit (Manager/Admin)
router.post('/:id/edit-request', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);
    if (!attendance) {
      return res.status(404).json({ success: false, message: 'Attendance record not found' });
    }
    const request = await AttendanceEditRequest.create({
      attendanceId: attendance._id,
      requestedBy: req.userId,
      requestedByName: req.user?.username || req.user?.employeeId || '',
      changes: req.body?.changes || {},
      reason: req.body?.reason || ''
    });
    await logAudit(req, 'attendance_edit_request', 'AttendanceEditRequest', request._id, { attendanceId: attendance._id });
    await createAlert({
      userId: req.userId,
      employeeId: req.user?.employeeId,
      type: 'system',
      level: 'info',
      title: 'Edit Request Submitted',
      message: 'Attendance edit request submitted for approval.'
    });
    res.json({ success: true, data: request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/edit-requests', verifyToken, isAdmin, async (req, res) => {
  try {
    const list = await AttendanceEditRequest.find({ status: 'Pending' }).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/edit-requests/:id/approve', verifyToken, isAdmin, async (req, res) => {
  try {
    const request = await AttendanceEditRequest.findById(req.params.id);
    if (!request || request.status !== 'Pending') {
      return res.status(404).json({ success: false, message: 'Edit request not found' });
    }
    const attendance = await Attendance.findById(request.attendanceId);
    if (!attendance) {
      return res.status(404).json({ success: false, message: 'Attendance record not found' });
    }
    Object.assign(attendance, request.changes || {});
    await attendance.save();
    request.status = 'Approved';
    request.reviewedBy = req.user?.username || req.user?.employeeId || '';
    request.reviewedAt = new Date();
    await request.save();
    await logAudit(req, 'attendance_edit_approved', 'AttendanceEditRequest', request._id, { attendanceId: attendance._id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/edit-requests/:id/reject', verifyToken, isAdmin, async (req, res) => {
  try {
    const request = await AttendanceEditRequest.findById(req.params.id);
    if (!request || request.status !== 'Pending') {
      return res.status(404).json({ success: false, message: 'Edit request not found' });
    }
    request.status = 'Rejected';
    request.reviewedBy = req.user?.username || req.user?.employeeId || '';
    request.reviewedAt = new Date();
    await request.save();
    await logAudit(req, 'attendance_edit_rejected', 'AttendanceEditRequest', request._id, { attendanceId: request.attendanceId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete attendance record (Admin only)
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const attendance = await Attendance.findByIdAndDelete(id);

    if (!attendance) {
      return res.status(404).json({ 
        success: false, 
        message: 'Attendance record not found' 
      });
    }

    res.json({ 
      success: true, 
      message: 'Record deleted successfully' 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Analytics: monthly trends + department performance
router.get('/analytics', async (req, res) => {
  try {
    const { month, year } = req.query;
    const now = moment();
    const targetYear = year ? parseInt(year, 10) : now.year();
    const targetMonth = month ? parseInt(month, 10) - 1 : now.month();

    const start = moment({ year: targetYear, month: targetMonth, day: 1 }).startOf('day').toDate();
    const end = moment(start).endOf('month').endOf('day').toDate();

    const records = await Attendance.find({
      checkInTime: { $gte: start, $lte: end }
    });

    const totalEmployees = await User.countDocuments();
    const byDay = {};
    const presentStatuses = new Set(['Present', 'Late', 'Half-Day']);
    const uniquePresent = new Set();
    const deptStats = {};

    records.forEach(r => {
      const dayKey = moment(r.checkInTime).format('YYYY-MM-DD');
      byDay[dayKey] = (byDay[dayKey] || 0) + 1;
      if (presentStatuses.has(r.status)) {
        uniquePresent.add(r.employeeId);
      }
      if (!deptStats[r.department]) {
        deptStats[r.department] = { present: 0 };
      }
      if (presentStatuses.has(r.status)) {
        deptStats[r.department].present += 1;
      }
    });

    const usersByDept = await User.aggregate([
      { $group: { _id: '$department', total: { $sum: 1 } } }
    ]);
    const deptTotals = {};
    usersByDept.forEach(item => {
      deptTotals[item._id] = item.total;
    });

    const deptPerformance = Object.keys(deptTotals).map(dep => {
      const present = deptStats[dep]?.present || 0;
      const total = deptTotals[dep] || 0;
      const absenteeismRate = total > 0 ? Number(((1 - present / total) * 100).toFixed(1)) : 0;
      return { department: dep, present, total, absenteeismRate };
    });

    const dayLabels = [];
    const dayValues = [];
    const cursor = moment(start);
    while (cursor.isSameOrBefore(end, 'day')) {
      const key = cursor.format('YYYY-MM-DD');
      dayLabels.push(cursor.format('DD MMM'));
      dayValues.push(byDay[key] || 0);
      cursor.add(1, 'day');
    }

    const absenteeismRate = totalEmployees > 0
      ? Number(((1 - uniquePresent.size / totalEmployees) * 100).toFixed(1))
      : 0;

    res.json({
      success: true,
      data: {
        month: targetMonth + 1,
        year: targetYear,
        totalEmployees,
        absenteeismRate,
        trends: { labels: dayLabels, values: dayValues },
        departmentPerformance: deptPerformance
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Log geo-fence violation
router.post('/geofence-violation', verifyToken, async (req, res) => {
  try {
    const { location, locationLat, locationLng, locationAccuracy, reason } = req.body || {};
    const violation = await GeofenceViolation.create({
      userId: req.user?._id,
      employeeId: req.user?.employeeId || '',
      name: req.user?.username || '',
      location: location || '',
      locationLat,
      locationLng,
      locationAccuracy,
      reason: reason || 'Outside geo-fence'
    });
    await createAlert({
      userId: req.user?._id,
      employeeId: req.user?.employeeId,
      type: 'geofence',
      level: 'warning',
      title: 'Geo-fence Violation',
      message: `${req.user?.username || 'Employee'} attempted attendance outside geo-fence.`,
      meta: { locationLat, locationLng, locationAccuracy }
    });
    await logAudit(req, 'geofence_violation', 'GeofenceViolation', violation._id, { reason });
    res.json({ success: true, data: violation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get geo-fence violations (Admin/Manager)
router.get('/geofence-violations', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const list = await GeofenceViolation.find().sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, data: list });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Auto report generation
router.post('/auto-report', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const { type } = req.body || {};
    const now = moment();
    let start;
    let end;
    let reportType = type === 'weekly' ? 'weekly' : 'monthly';
    if (reportType === 'weekly') {
      start = moment().startOf('week').toDate();
      end = moment().endOf('week').toDate();
    } else {
      start = moment().startOf('month').toDate();
      end = moment().endOf('month').toDate();
    }

    const records = await Attendance.find({
      checkInTime: { $gte: start, $lte: end }
    });

    const summary = {
      total: records.length,
      present: records.filter(r => r.status === 'Present').length,
      late: records.filter(r => r.status === 'Late').length,
      absent: records.filter(r => r.status === 'Absent').length,
      halfDay: records.filter(r => r.status === 'Half-Day').length
    };

    const report = await AutoReport.create({
      type: reportType,
      periodStart: start,
      periodEnd: end,
      generatedBy: req.user?.username || req.user?.employeeId || '',
      payload: summary
    });
    await logAudit(req, 'auto_report_generate', 'AutoReport', report._id, { type: reportType });
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/auto-report', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const list = await AutoReport.find().sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, data: list });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Generate absent alerts for a date (admin/manager)
router.post('/absent-alerts', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const date = req.body?.date ? moment(req.body.date) : moment();
    const start = date.startOf('day').toDate();
    const end = date.endOf('day').toDate();
    const records = await Attendance.find({ checkInTime: { $gte: start, $lte: end } }).select('employeeId');
    const presentIds = new Set(records.map(r => r.employeeId));
    const users = await User.find().select('employeeId username');
    const dateKey = date.format('YYYY-MM-DD');
    let created = 0;
    for (const user of users) {
      if (presentIds.has(user.employeeId)) continue;
      const exists = await Alert.findOne({
        type: 'absent',
        employeeId: user.employeeId,
        'meta.date': dateKey
      });
      if (exists) continue;
      await createAlert({
        userId: user._id,
        employeeId: user.employeeId,
        type: 'absent',
        level: 'warning',
        title: 'Absent Alert',
        message: `${user.username || user.employeeId} is absent on ${dateKey}.`,
        meta: { date: dateKey }
      });
      created += 1;
    }
    res.json({ success: true, count: created });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Attendance anomaly detection
router.get('/anomalies', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const since = moment().subtract(30, 'days').toDate();
    const records = await Attendance.find({ checkInTime: { $gte: since } }).sort({ checkInTime: -1 });
    const anomalies = [];
    const byDay = {};
    records.forEach(record => {
      const dayKey = moment(record.checkInTime).format('YYYY-MM-DD');
      const key = `${record.employeeId}-${dayKey}`;
      byDay[key] = (byDay[key] || 0) + 1;
      const hour = new Date(record.checkInTime).getHours();
      if (hour < 5 || hour > 22) {
        anomalies.push({ type: 'odd_time', recordId: record._id, employeeId: record.employeeId, message: 'Check-in outside normal hours' });
      }
      if (record.checkOutTime && record.checkOutTime < record.checkInTime) {
        anomalies.push({ type: 'invalid_time', recordId: record._id, employeeId: record.employeeId, message: 'Check-out before check-in' });
      }
    });
    Object.keys(byDay).forEach(key => {
      if (byDay[key] > 1) {
        const [employeeId, day] = key.split('-');
        anomalies.push({ type: 'multiple_checkins', employeeId, message: `Multiple check-ins on ${day}` });
      }
    });
    res.json({ success: true, data: anomalies });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Shift auto-rules (based on lateness)
router.post('/shift-auto-rules', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const since = moment().subtract(30, 'days').toDate();
    const records = await Attendance.find({ checkInTime: { $gte: since } });
    const lateCounts = {};
    records.forEach(record => {
      if (!lateCounts[record.employeeId]) lateCounts[record.employeeId] = 0;
      if (record.status === 'Late') lateCounts[record.employeeId] += 1;
    });
    const users = await User.find();
    let updated = 0;
    for (const user of users) {
      const late = lateCounts[user.employeeId] || 0;
      let shift = 'Day';
      if (late >= 4) shift = 'Night';
      if (late >= 8) shift = 'Extra Work';
      if (user.defaultShift !== shift) {
        user.defaultShift = shift;
        await user.save();
        updated += 1;
      }
    }
    res.json({ success: true, updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

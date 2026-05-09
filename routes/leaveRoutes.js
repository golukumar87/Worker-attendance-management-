const express = require('express');
const router = express.Router();
const LeaveRequest = require('../models/LeaveRequest');
const LeaveBalance = require('../models/LeaveBalance');
const Holiday = require('../models/Holiday');
const Alert = require('../models/Alert');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { verifyToken, isManagerOrAdmin, isAdmin } = require('../middleware/auth');
const https = require('https');
const { sendWebhooks } = require('../utils/webhook');
const { sendEmail, sendSms, sendWhatsapp } = require('../utils/notify');

const notifyUser = async (userId, title, message) => {
  try {
    const user = await User.findById(userId).select('email phone notifyEmail notifySms notifyWhatsapp');
    if (user?.notifyEmail && user.email) {
      await sendEmail({ to: user.email, subject: title, text: message });
    }
    if (user?.notifySms && user.phone) {
      await sendSms({ to: user.phone, text: message });
    }
    if (user?.notifyWhatsapp && user.phone) {
      await sendWhatsapp({ to: user.phone, text: message });
    }
  } catch (_) {}
};

const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const calculateDaysInclusive = (start, end) => {
  const startDate = startOfDay(start);
  const endDate = endOfDay(end);
  const ms = endDate - startDate;
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
};

const getOrCreateBalance = async (user) => {
  const year = new Date().getFullYear();
  let balance = await LeaveBalance.findOne({ userId: user._id, year });
  if (!balance) {
    balance = new LeaveBalance({
      userId: user._id,
      employeeId: user.employeeId,
      name: user.username,
      department: user.department,
      year,
      total: 24,
      used: 0,
      remaining: 24
    });
    await balance.save();
  }
  return balance;
};

const getOrCreateBalanceForRequest = async (request) => {
  const year = new Date(request.startDate).getFullYear();
  let balance = await LeaveBalance.findOne({ employeeId: request.employeeId, year });
  if (!balance) {
    balance = new LeaveBalance({
      userId: request.userId,
      employeeId: request.employeeId,
      name: request.name,
      department: request.department,
      year,
      total: 24,
      used: 0,
      remaining: 24
    });
    await balance.save();
  }
  return balance;
};

router.post('/apply', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate, type, reason } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Start and end date are required.' });
    }

    const days = calculateDaysInclusive(startDate, endDate);
    const balance = await getOrCreateBalance(req.user);

    if (balance.remaining < days && type !== 'Unpaid') {
      return res.status(400).json({ success: false, message: 'Insufficient leave balance.' });
    }

    const request = await LeaveRequest.create({
      userId: req.user._id,
      employeeId: req.user.employeeId,
      name: req.user.username,
      department: req.user.department,
      type: type || 'Casual',
      startDate,
      endDate,
      days,
      reason: reason || ''
    });
    await AuditLog.create({
      actorId: req.user?._id,
      actorName: req.user?.username || req.user?.employeeId || '',
      action: 'leave_apply',
      entityType: 'LeaveRequest',
      entityId: request._id,
      ip: req.ip || '',
      userAgent: req.get('user-agent') || ''
    });

    res.json({ success: true, message: 'Leave request submitted.', data: request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/my', verifyToken, async (req, res) => {
  try {
    const requests = await LeaveRequest.find({ userId: req.user._id }).sort({ appliedAt: -1 });
    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/pending', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const { department } = req.query;
    const query = { status: 'Pending' };
    if (department) query.department = department;
    if (req.user?.role === 'manager') {
      query.managerStatus = 'Pending';
    }
    if (req.user?.role === 'admin' || req.user?.role === 'vice_admin') {
      query.adminStatus = 'Pending';
    }
    const requests = await LeaveRequest.find(query).sort({ appliedAt: -1 });
    res.json({ success: true, data: requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/:id/approve', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const request = await LeaveRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Leave request not found.' });
    }
    if (request.status !== 'Pending') {
      return res.status(400).json({ success: false, message: 'Request already processed.' });
    }

    if (req.user?.role === 'manager') {
      request.managerStatus = 'Approved';
      request.approvalStage = 'ManagerApproved';
      request.reviewedBy = req.user.username || req.user.employeeId;
      request.reviewedAt = new Date();
      await request.save();
    await Alert.create({
      userId: request.userId,
      employeeId: request.employeeId,
      type: 'leave',
      level: 'info',
      title: 'Leave Manager Approval',
      message: 'Manager approved your leave. Awaiting admin approval.'
    });
    await notifyUser(request.userId, 'Leave Manager Approval', 'Manager approved your leave. Awaiting admin approval.');
      await sendWebhooks('leave.manager_approved', { requestId: request._id, employeeId: request.employeeId });
      return res.json({ success: true, message: 'Manager approved. Sent for final approval.', data: request });
    }

    const balance = await getOrCreateBalanceForRequest(request);
    if (request.type !== 'Unpaid') {
      balance.used = (balance.used || 0) + request.days;
      await balance.save();
    }

    request.adminStatus = 'Approved';
    request.status = 'Approved';
    request.approvalStage = 'FinalApproved';
    request.reviewedBy = req.user.username || req.user.employeeId;
    request.reviewedAt = new Date();
    await request.save();

    await Alert.create({
      userId: request.userId,
      employeeId: request.employeeId,
      type: 'leave',
      level: 'info',
      title: 'Leave Approved',
      message: 'Your leave has been approved.'
    });
    await notifyUser(request.userId, 'Leave Approved', 'Your leave has been approved.');
    await sendWebhooks('leave.approved', { requestId: request._id, employeeId: request.employeeId });

    res.json({ success: true, message: 'Leave approved.', data: request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/:id/reject', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const request = await LeaveRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Leave request not found.' });
    }
    if (request.status !== 'Pending') {
      return res.status(400).json({ success: false, message: 'Request already processed.' });
    }

    request.status = 'Rejected';
    request.approvalStage = 'Rejected';
    if (req.user?.role === 'manager') {
      request.managerStatus = 'Rejected';
    } else {
      request.adminStatus = 'Rejected';
    }
    request.reviewedBy = req.user.username || req.user.employeeId;
    request.reviewedAt = new Date();
    request.rejectionReason = req.body.reason || '';
    await request.save();
    await Alert.create({
      userId: request.userId,
      employeeId: request.employeeId,
      type: 'leave',
      level: 'warning',
      title: 'Leave Rejected',
      message: req.body.reason ? `Leave rejected: ${req.body.reason}` : 'Leave rejected.'
    });
    await notifyUser(request.userId, 'Leave Rejected', req.body.reason ? `Leave rejected: ${req.body.reason}` : 'Leave rejected.');
    await sendWebhooks('leave.rejected', { requestId: request._id, employeeId: request.employeeId });

    res.json({ success: true, message: 'Leave rejected.', data: request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/balance', verifyToken, async (req, res) => {
  try {
    const balance = await getOrCreateBalance(req.user);
    res.json({ success: true, data: balance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/balances', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const { department } = req.query;
    const query = {};
    if (department) query.department = department;
    const balances = await LeaveBalance.find(query).sort({ name: 1 });
    res.json({ success: true, data: balances });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/holidays', async (req, res) => {
  try {
    const holidays = await Holiday.find().sort({ date: 1 });
    res.json({ success: true, data: holidays });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/holidays', verifyToken, isAdmin, async (req, res) => {
  try {
    const { name, date, description } = req.body;
    if (!name || !date) {
      return res.status(400).json({ success: false, message: 'Holiday name and date are required.' });
    }
    const holiday = await Holiday.create({
      name,
      date: startOfDay(date),
      description: description || ''
    });
    res.json({ success: true, message: 'Holiday added.', data: holiday });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/holidays/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const holiday = await Holiday.findByIdAndDelete(req.params.id);
    if (!holiday) {
      return res.status(404).json({ success: false, message: 'Holiday not found.' });
    }
    res.json({ success: true, message: 'Holiday deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

const fetchJson = (url) => new Promise((resolve, reject) => {
  https.get(url, (resp) => {
    let data = '';
    resp.on('data', chunk => (data += chunk));
    resp.on('end', () => {
      if (resp.statusCode && resp.statusCode >= 400) {
        return reject(new Error(`HTTP ${resp.statusCode}`));
      }
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
  }).on('error', reject);
});

router.post('/holidays/sync', verifyToken, isAdmin, async (req, res) => {
  try {
    const country = String(req.query.country || 'IN').toUpperCase();
    const year = Number(req.query.year || new Date().getFullYear());
    if (!country || !year) {
      return res.status(400).json({ success: false, message: 'Country and year are required.' });
    }
    const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`;
    const holidays = await fetchJson(url);
    if (!Array.isArray(holidays)) {
      return res.status(400).json({ success: false, message: 'Invalid holiday response.' });
    }
    let count = 0;
    for (const item of holidays) {
      const date = startOfDay(item.date);
      const name = item.localName || item.name || 'Holiday';
      const description = item.name || '';
      await Holiday.findOneAndUpdate(
        { date },
        { $set: { name, date, description } },
        { upsert: true, new: true }
      );
      count += 1;
    }
    res.json({ success: true, message: 'Holidays synced.', count });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Holiday sync failed.', error: error.message });
  }
});

module.exports = router;

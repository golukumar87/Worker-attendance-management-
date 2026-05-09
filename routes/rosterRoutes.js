const express = require('express');
const router = express.Router();
const ShiftRoster = require('../models/ShiftRoster');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const { verifyToken, isManagerOrAdmin } = require('../middleware/auth');

const startOfWeek = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
};

router.get('/', verifyToken, async (req, res) => {
  try {
    const { weekStart, department } = req.query;
    if (!weekStart || !department) {
      return res.status(400).json({ success: false, message: 'weekStart and department are required.' });
    }
    const week = startOfWeek(weekStart);
    const roster = await ShiftRoster.findOne({ weekStart: week, department });
    res.json({ success: true, data: roster || null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/auto-assign', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const { weekStart, department, shift } = req.body;
    if (!weekStart || !department) {
      return res.status(400).json({ success: false, message: 'weekStart and department are required.' });
    }
    const week = startOfWeek(weekStart);
    const employees = await User.find({ department }).select('employeeId username');
    const assignments = employees.map(emp => ({
      employeeId: emp.employeeId,
      name: emp.username,
      shift: shift || 'Day'
    }));

    const roster = await ShiftRoster.findOneAndUpdate(
      { weekStart: week, department },
      { $set: { assignments, updatedBy: req.user.username || req.user.employeeId } },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: 'Roster auto-assigned.', data: roster });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/auto-assign-smart', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const { weekStart, department } = req.body;
    if (!weekStart || !department) {
      return res.status(400).json({ success: false, message: 'weekStart and department are required.' });
    }
    const week = startOfWeek(weekStart);
    const employees = await User.find({ department }).select('employeeId username');
    const last30Start = new Date();
    last30Start.setDate(last30Start.getDate() - 30);
    const attendance = await Attendance.find({
      department,
      checkInTime: { $gte: last30Start }
    });
    const stats = {};
    attendance.forEach(record => {
      if (!stats[record.employeeId]) {
        stats[record.employeeId] = { late: 0, overtime: 0 };
      }
      if (record.status === 'Late') stats[record.employeeId].late += 1;
      stats[record.employeeId].overtime += Number(record.overtime || 0);
    });

    const assignments = employees.map(emp => {
      const empStats = stats[emp.employeeId] || { late: 0, overtime: 0 };
      let shift = 'Day';
      if (empStats.late >= 3) shift = 'Night';
      if (empStats.overtime >= 6) shift = 'Extra Work';
      return { employeeId: emp.employeeId, name: emp.username, shift };
    });

    const roster = await ShiftRoster.findOneAndUpdate(
      { weekStart: week, department },
      { $set: { assignments, updatedBy: req.user.username || req.user.employeeId } },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: 'Roster smart-assigned.', data: roster });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.put('/assignment', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const { weekStart, department, employeeId, name, shift } = req.body;
    if (!weekStart || !department || !employeeId) {
      return res.status(400).json({ success: false, message: 'weekStart, department, employeeId are required.' });
    }
    const week = startOfWeek(weekStart);

    const roster = await ShiftRoster.findOne({ weekStart: week, department });
    if (!roster) {
      const newRoster = await ShiftRoster.create({
        weekStart: week,
        department,
        assignments: [{ employeeId, name: name || employeeId, shift: shift || 'Day' }],
        updatedBy: req.user.username || req.user.employeeId
      });
      return res.json({ success: true, message: 'Roster created.', data: newRoster });
    }

    const idx = roster.assignments.findIndex(item => item.employeeId === employeeId);
    if (idx >= 0) {
      roster.assignments[idx].shift = shift || roster.assignments[idx].shift;
    } else {
      roster.assignments.push({ employeeId, name: name || employeeId, shift: shift || 'Day' });
    }
    roster.updatedBy = req.user.username || req.user.employeeId;
    await roster.save();

    res.json({ success: true, message: 'Assignment updated.', data: roster });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

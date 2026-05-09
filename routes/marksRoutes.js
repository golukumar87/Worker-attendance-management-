const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const EmployeePayroll = require('../models/StudentMarks');
const Attendance = require('../models/Attendance');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Get all payroll records with optional filters
router.get('/', async (req, res) => {
  try {
    const { search, department, employeeId } = req.query;
    const query = {};

    if (department) query.department = department;
    if (employeeId) query.employeeId = employeeId;
    if (search) {
      query.$or = [
        { name: new RegExp(search, 'i') },
        { employeeId: new RegExp(search, 'i') },
        { department: new RegExp(search, 'i') }
      ];
    }

    const records = await EmployeePayroll.find(query).sort({ updatedAt: -1 });
    res.json({ success: true, data: records });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Payroll summary based on attendance
router.get('/summary', verifyToken, isAdmin, async (req, res) => {
  try {
    const { month, year } = req.query;
    const now = new Date();
    const targetYear = year ? parseInt(year, 10) : now.getFullYear();
    const targetMonth = month ? parseInt(month, 10) - 1 : now.getMonth();
    const start = new Date(targetYear, targetMonth, 1, 0, 0, 0, 0);
    const end = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);

    const attendance = await Attendance.find({
      checkInTime: { $gte: start, $lte: end }
    });
    const payroll = await EmployeePayroll.find();
    const payrollMap = new Map(payroll.map(p => [p.employeeId, p]));

    const summary = {};
    attendance.forEach(record => {
      if (!summary[record.employeeId]) {
        summary[record.employeeId] = {
          employeeId: record.employeeId,
          name: record.name,
          department: record.department,
          present: 0,
          late: 0,
          halfDay: 0,
          absent: 0,
          overtime: 0
        };
      }
      const item = summary[record.employeeId];
      if (record.status === 'Present') item.present += 1;
      if (record.status === 'Late') item.late += 1;
      if (record.status === 'Half-Day') item.halfDay += 1;
      if (record.status === 'Absent') item.absent += 1;
      item.overtime += Number(record.overtime || 0);
    });

    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const output = Object.values(summary).map(item => {
      const payrollRecord = payrollMap.get(item.employeeId);
      const monthlySalary = Number(payrollRecord?.salary || 0);
      const dailyRate = daysInMonth ? monthlySalary / daysInMonth : 0;
      const payableDays = item.present + item.late + (item.halfDay * 0.5);
      const gross = payableDays * dailyRate;
      const advance = Number(payrollRecord?.advancePaid || 0);
      const netPay = Math.max(0, gross - advance);
      return {
        ...item,
        salary: monthlySalary,
        grossPay: Number(gross.toFixed(2)),
        advancePaid: advance,
        netPay: Number(netPay.toFixed(2))
      };
    });

    res.json({ success: true, data: output, month: targetMonth + 1, year: targetYear });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add payroll record
router.post(
  '/',
  verifyToken,
  isAdmin,
  [
    body('employeeId').notEmpty().trim(),
    body('name').notEmpty().trim(),
    body('department').optional().trim(),
    body('shift').optional().isIn(['Day', 'Night', 'Extra Work']),
    body('salary').optional().isNumeric(),
    body('halfDay').optional().isNumeric(),
    body('advancePaid').optional().isNumeric()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const payload = req.body;
      const existing = await EmployeePayroll.findOne({ employeeId: payload.employeeId });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Employee ID already exists' });
      }

      const record = await EmployeePayroll.create(payload);
      res.status(201).json({ success: true, data: record });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

// Update payroll record
router.put('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const updates = req.body;
    updates.updatedAt = Date.now();

    const record = await EmployeePayroll.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true
    });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Payroll record not found' });
    }

    res.json({ success: true, data: record });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete payroll record
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    const record = await EmployeePayroll.findByIdAndDelete(req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Payroll record not found' });
    }
    res.json({ success: true, message: 'Payroll record deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

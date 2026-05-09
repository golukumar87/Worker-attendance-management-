const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const { verifyToken, isManagerOrAdmin } = require('../middleware/auth');

router.get('/', verifyToken, isManagerOrAdmin, async (req, res) => {
  try {
    const list = await AuditLog.find().sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, data: list });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

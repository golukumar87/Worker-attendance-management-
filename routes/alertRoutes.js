const express = require('express');
const router = express.Router();
const Alert = require('../models/Alert');
const { verifyToken, isManagerOrAdmin } = require('../middleware/auth');

router.get('/', verifyToken, async (req, res) => {
  try {
    const query = (req.user?.role === 'admin' || req.user?.role === 'vice_admin')
      ? {}
      : { userId: req.userId };
    const list = await Alert.find(query).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, data: list });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/:id/read', verifyToken, async (req, res) => {
  try {
    const alert = await Alert.findById(req.params.id);
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alert not found' });
    }
    if (req.user?.role !== 'admin' && req.user?.role !== 'vice_admin' && String(alert.userId) !== String(req.userId)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    alert.readAt = new Date();
    await alert.save();
    res.json({ success: true, data: alert });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/read-all', verifyToken, async (req, res) => {
  try {
    const query = (req.user?.role === 'admin' || req.user?.role === 'vice_admin')
      ? {}
      : { userId: req.userId };
    await Alert.updateMany(query, { $set: { readAt: new Date() } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs').promises;
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance_db'
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Import models
const User = require('./models/User');
const Attendance = require('./models/Attendance');
const Alert = require('./models/Alert');
const moment = require('moment');
const UserDocument = require('./models/UserDocument');

const generateEmployeeId = async () => {
  const lastUser = await User.findOne().sort({ createdAt: -1 });
  let lastId = 1000;

  if (lastUser && lastUser.employeeId) {
    const numPart = parseInt(lastUser.employeeId.replace('EMP', ''));
    if (!isNaN(numPart)) {
      lastId = numPart + 1;
    }
  }

  return `EMP${lastId}`;
};

const ensureAdminUser = async () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminUsername = process.env.ADMIN_USERNAME || 'Admin';

  if (!adminEmail || !adminPassword) return;

  const existing = await User.findOne({ email: adminEmail });
  if (existing) {
    existing.role = 'admin';
    existing.username = existing.username || adminUsername;
    existing.password = adminPassword;
    await existing.save();
    return;
  }

  const employeeId = await generateEmployeeId();
  const user = new User({
    username: adminUsername,
    email: adminEmail,
    password: adminPassword,
    department: 'IT',
    role: 'admin',
    employeeId
  });
  await user.save();
};

// Database connection with retry logic
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance_db', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected successfully');
    await ensureAdminUser();
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    setTimeout(connectDB, 5000); // Retry after 5 seconds
  }
};
connectDB();

// Import routes
const attendanceRoutes = require('./routes/attendanceRoutes');
const authRoutes = require('./routes/authRoutes');
const marksRoutes = require('./routes/marksRoutes');
const leaveRoutes = require('./routes/leaveRoutes');
const rosterRoutes = require('./routes/rosterRoutes');
const alertRoutes = require('./routes/alertRoutes');
const auditRoutes = require('./routes/auditRoutes');
const biometricRoutes = require('./routes/biometricRoutes');

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/marks', marksRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/roster', rosterRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/biometric', biometricRoutes);

const runDailyAbsentCheck = async () => {
  try {
    const date = moment();
    const start = date.startOf('day').toDate();
    const end = date.endOf('day').toDate();
    const records = await Attendance.find({ checkInTime: { $gte: start, $lte: end } }).select('employeeId');
    const presentIds = new Set(records.map(r => r.employeeId));
    const users = await User.find().select('employeeId username');
    const dateKey = moment().format('YYYY-MM-DD');
    for (const user of users) {
      if (presentIds.has(user.employeeId)) continue;
      const exists = await Alert.findOne({
        type: 'absent',
        employeeId: user.employeeId,
        'meta.date': dateKey
      });
      if (exists) continue;
      await Alert.create({
        userId: user._id,
        employeeId: user.employeeId,
        type: 'absent',
        level: 'warning',
        title: 'Absent Alert',
        message: `${user.username || user.employeeId} is absent on ${dateKey}.`,
        meta: { date: dateKey }
      });
    }
  } catch (error) {
    console.error('Absent scheduler error:', error.message);
  }
};

const scheduleDailyJob = () => {
  const now = new Date();
  const next = new Date();
  next.setHours(0, 10, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const ms = next.getTime() - now.getTime();
  setTimeout(() => {
    runDailyAbsentCheck();
    setInterval(runDailyAbsentCheck, 24 * 60 * 60 * 1000);
  }, ms);
};
scheduleDailyJob();

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Profile picture upload endpoint
app.post('/api/upload/profile', upload.single('profile'), async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    user.profilePicture = '/uploads/' + req.file.filename;
    await user.save();
    
    res.json({ success: true, profileUrl: user.profilePicture });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Document upload endpoint
app.post('/api/upload/document', upload.single('document'), async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const doc = await UserDocument.create({
      userId: user._id,
      filename: '/uploads/' + req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size
    });
    res.json({ success: true, data: doc });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/documents', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const docs = await UserDocument.find({ userId: decoded.userId }).sort({ uploadedAt: -1 });
    res.json({ success: true, data: docs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Data storage endpoints (for saving form data)
app.post('/api/save-data', async (req, res) => {
  try {
    const dataPath = path.join(__dirname, 'data', 'data.json');
    await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    const existingData = await fs.readFile(dataPath, 'utf8').catch(() => '[]');
    const data = JSON.parse(existingData);
    
    const newEntry = {
      id: Date.now(),
      ...req.body,
      timestamp: new Date().toISOString()
    };
    
    data.push(newEntry);
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
    
    res.json({ success: true, message: 'Data saved successfully', data: newEntry });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/get-data', async (req, res) => {
  try {
    const dataPath = path.join(__dirname, 'data', 'data.json');
    const data = await fs.readFile(dataPath, 'utf8').catch(() => '[]');
    res.json({ success: true, data: JSON.parse(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/save-data', async (req, res) => {
  try {
    const dataPath = path.join(__dirname, 'data', 'data.json');
    await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    await fs.writeFile(dataPath, JSON.stringify([], null, 2));
    res.json({ success: true, message: 'Data cleared' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Socket.io for real-time updates
io.on('connection', (socket) => {
  console.log('🟢 New client connected:', socket.id);
  
  socket.on('join-room', (room) => {
    socket.join(room);
    console.log(`Socket ${socket.id} joined room: ${room}`);
  });
  
  socket.on('attendance-marked', (data) => {
    io.emit('attendance-update', data);
  });
  
  socket.on('disconnect', () => {
    console.log('🔴 Client disconnected:', socket.id);
  });
});

// Make io accessible to routes
app.set('io', io);

// Serve frontend with proper routing
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/welcome.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  🚀 Server running on port ${PORT}
  📁 Environment: ${process.env.NODE_ENV || 'development'}
  🌐 Visit: http://localhost:${PORT}
  📊 API: http://localhost:${PORT}/api
  `);
});


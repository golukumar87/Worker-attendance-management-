const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { body, validationResult } = require('express-validator');
const { verifyToken, isManagerOrAdmin } = require('../middleware/auth');
const { sendEmail, sendSms, sendWhatsapp, generateOtp, hashOtp, verifyOtp } = require('../utils/notify');

let adminSessionUserId = null;

const isAdminSessionActive = () => Boolean(adminSessionUserId);

// Generate unique employee ID
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

// Register new user
router.post('/register', [
    body('username').notEmpty().trim().withMessage('Username is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('department').optional().isIn(['HR', 'IT', 'Finance', 'Marketing', 'Operations', 'Sales']),
    body('role').optional().isIn(['admin', 'vice_admin', 'manager', 'employee'])
], async (req, res) => {
    try {
        if (isAdminSessionActive()) {
            return res.status(403).json({
                success: false,
                message: 'Admin is logged in. Registration is temporarily disabled.'
            });
        }
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                errors: errors.array() 
            });
        }

        const { username, email, password, department = 'IT', role = 'employee', phone, deviceId, deviceName } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ 
            $or: [{ email }, { username }] 
        });
        
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'User with this email or username already exists' 
            });
        }

        // Generate employee ID
        const employeeId = await generateEmployeeId();

        // Create new user
        const user = new User({
            username,
            email,
            password, // Will be hashed by pre-save hook
            department,
            role,
            employeeId,
            phone,
            deviceId: deviceId || undefined,
            deviceName: deviceName || '',
            deviceBoundAt: deviceId ? new Date() : undefined,
            deviceLastSeenAt: deviceId ? new Date() : undefined
        });

        await user.save();

        // Generate JWT token
        const token = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        // Return user data without password
        const userData = user.toObject();
        delete userData.password;

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            token,
            user: userData
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error registering user',
            error: error.message 
        });
    }
});

// Login user
router.post('/login', [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                errors: errors.array() 
            });
        }

        const { email, password, deviceId, deviceName } = req.body;

        // Find user by email
        const user = await User.findOne({ email });
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        if (isAdminSessionActive() && user.role !== 'admin' && user.role !== 'vice_admin') {
            return res.status(403).json({
                success: false,
                message: 'Admin is logged in. Please try again later.'
            });
        }

        // Check password
        const isPasswordValid = await user.comparePassword(password);
        
        if (!isPasswordValid) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        if (user.deviceId && deviceId && user.deviceId !== deviceId) {
            const otp = generateOtp();
            user.pendingDeviceId = deviceId;
            user.pendingDeviceName = deviceName || '';
            user.deviceOtpHash = await hashOtp(otp);
            user.deviceOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
            await user.save();
            const message = `Your device verification OTP is ${otp}. It expires in 10 minutes.`;
            if (user.notifyEmail && user.email) {
                await sendEmail({ to: user.email, subject: 'Device Verification OTP', text: message });
            }
            if (user.notifySms && user.phone) {
                await sendSms({ to: user.phone, text: message });
            }
            if (user.notifyWhatsapp && user.phone) {
                await sendWhatsapp({ to: user.phone, text: message });
            }
            return res.status(403).json({
                success: false,
                code: 'DEVICE_OTP_REQUIRED',
                message: 'Device change requires OTP verification.'
            });
        }

        if (!user.deviceId && deviceId) {
            user.deviceId = deviceId;
            user.deviceName = deviceName || '';
            user.deviceBoundAt = new Date();
        }
        if (deviceId) {
            user.deviceLastSeenAt = new Date();
        }
        await user.save();

        // Generate JWT token
        const token = jwt.sign(
            { userId: user._id, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        if (user.role === 'admin' || user.role === 'vice_admin') {
            adminSessionUserId = String(user._id);
        }

        // Return user data without password
        const userData = user.toObject();
        delete userData.password;

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: userData
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error during login',
            error: error.message 
        });
    }
});

// Logout user
router.post('/logout', verifyToken, async (req, res) => {
    try {
        if (req.user?.role === 'admin' && adminSessionUserId === String(req.userId)) {
            adminSessionUserId = null;
        }
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error during logout' });
    }
});

// Reset device binding
router.post('/device/reset', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        user.deviceId = null;
        user.deviceName = '';
        user.deviceBoundAt = null;
        user.deviceLastSeenAt = null;
        await user.save();
        res.json({ success: true, message: 'Device binding reset' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Device reset failed' });
    }
});

// Verify device OTP and bind new device
router.post('/device/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ success: false, message: 'Email and OTP required.' });
        }
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !user.deviceOtpHash || !user.deviceOtpExpiresAt) {
            return res.status(400).json({ success: false, message: 'OTP not requested.' });
        }
        if (new Date() > user.deviceOtpExpiresAt) {
            return res.status(400).json({ success: false, message: 'OTP expired.' });
        }
        const valid = await verifyOtp(otp, user.deviceOtpHash);
        if (!valid) {
            return res.status(401).json({ success: false, message: 'Invalid OTP.' });
        }
        user.deviceId = user.pendingDeviceId || user.deviceId;
        user.deviceName = user.pendingDeviceName || user.deviceName;
        user.deviceBoundAt = new Date();
        user.pendingDeviceId = null;
        user.pendingDeviceName = '';
        user.deviceOtpHash = null;
        user.deviceOtpExpiresAt = null;
        await user.save();
        res.json({ success: true, message: 'Device verified. Please login again.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'OTP verification failed.' });
    }
});

// Get current user profile
router.get('/profile', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password');
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        res.json({
            success: true,
            user
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching profile',
            error: error.message 
        });
    }
});

// Update user profile
router.put('/profile', verifyToken, [
    body('username').optional().trim(),
    body('email').optional().isEmail().normalizeEmail(),
    body('phone').optional(),
    body('department').optional().isIn(['HR', 'IT', 'Finance', 'Marketing', 'Operations', 'Sales']),
    body('role').optional().isIn(['admin', 'vice_admin']),
    body('attendancePin').optional().isLength({ min: 4, max: 6 }).isNumeric().withMessage('PIN must be 4-6 digits')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                errors: errors.array() 
            });
        }

        const updates = req.body;
        delete updates.password; // Don't allow password update through this route
        delete updates.employeeId; // Don't allow employeeId update
        if (updates.role && req.user.role !== 'admin' && req.user.role !== 'vice_admin') {
            delete updates.role;
        }
        if (updates.attendancePin) {
            const pinHash = await bcrypt.hash(String(updates.attendancePin), 10);
            updates.attendancePinHash = pinHash;
            updates.attendancePinUpdatedAt = new Date();
        }
        delete updates.attendancePin;

        const user = await User.findByIdAndUpdate(
            req.userId,
            { $set: updates },
            { new: true, runValidators: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating profile',
            error: error.message 
        });
    }
});

// Update notification preferences
router.put('/notifications', verifyToken, async (req, res) => {
    try {
        const { notifyEmail, notifySms, notifyWhatsapp } = req.body;
        const user = await User.findByIdAndUpdate(
            req.userId,
            { $set: { notifyEmail: Boolean(notifyEmail), notifySms: Boolean(notifySms), notifyWhatsapp: Boolean(notifyWhatsapp) } },
            { new: true }
        ).select('-password');
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update notifications.' });
    }
});

// Enroll face descriptor
router.post('/face-enroll', verifyToken, async (req, res) => {
    try {
        const { descriptor } = req.body;
        if (!Array.isArray(descriptor) || descriptor.length < 10) {
            return res.status(400).json({ success: false, message: 'Invalid face descriptor.' });
        }

        const user = await User.findByIdAndUpdate(
            req.userId,
            {
                $set: {
                    faceDescriptor: descriptor,
                    faceEnrolled: true,
                    faceUpdatedAt: new Date()
                }
            },
            { new: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, message: 'Face enrolled successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error enrolling face' });
    }
});

// Get face descriptor by employee ID (Manager/Admin)
router.get('/face-descriptor/:employeeId', verifyToken, isManagerOrAdmin, async (req, res) => {
    try {
        const { employeeId } = req.params;
        const user = await User.findOne({ employeeId }).select('faceDescriptor faceEnrolled username employeeId');
        if (!user) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }
        res.json({
            success: true,
            data: {
                employeeId: user.employeeId,
                name: user.username,
                faceEnrolled: user.faceEnrolled,
                faceDescriptor: user.faceDescriptor || []
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching face descriptor' });
    }
});

// Change password
router.post('/change-password', verifyToken, [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                success: false, 
                errors: errors.array() 
            });
        }

        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.userId);

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        // Verify current password
        const isPasswordValid = await user.comparePassword(currentPassword);
        
        if (!isPasswordValid) {
            return res.status(401).json({ 
                success: false, 
                message: 'Current password is incorrect' 
            });
        }

        // Update password
        user.password = newPassword;
        await user.save();

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Password change error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error changing password',
            error: error.message 
        });
    }
});

// Logout (optional - client side token removal)
router.post('/logout', verifyToken, (req, res) => {
    // In a real application with token blacklist, you'd add the token to a blacklist here
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
});

// Forgot password - request reset
router.post('/forgot-password', [
    body('email').isEmail().normalizeEmail()
], async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'No account found with this email' 
            });
        }

        // Generate reset token
        const resetToken = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '1h' }
        );

        // In production, send email with reset link
        // For now, return token in response (for testing)
        res.json({
            success: true,
            message: 'Password reset instructions sent to email',
            resetToken // Remove this in production!
        });

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error processing request',
            error: error.message 
        });
    }
});

// Reset password with token
router.post('/reset-password/:token', [
    body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
    try {
        const { token } = req.params;
        const { newPassword } = req.body;

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Invalid or expired token' 
            });
        }

        // Update password
        user.password = newPassword;
        await user.save();

        res.json({
            success: true,
            message: 'Password reset successfully'
        });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Invalid or expired token',
            error: error.message 
        });
    }
});

// Get all users (Admin only)
router.get('/users', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. Admin only.' 
            });
        }

        const users = await User.find().select('-password').sort({ createdAt: -1 });
        
        res.json({
            success: true,
            count: users.length,
            users
        });

    } catch (error) {
        console.error('Fetch users error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching users',
            error: error.message 
        });
    }
});

// Delete user (Admin only)
router.delete('/users/:userId', verifyToken, async (req, res) => {
    try {
        // Check if user is admin
        if (req.user.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. Admin only.' 
            });
        }

        const { userId } = req.params;
        
        // Don't allow deleting yourself
        if (userId === req.userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete your own account' 
            });
        }

        const user = await User.findByIdAndDelete(userId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        res.json({
            success: true,
            message: 'User deleted successfully'
        });

    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting user',
            error: error.message 
        });
    }
});

module.exports = router;

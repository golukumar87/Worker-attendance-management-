const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT token
const verifyToken = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Access denied. No token provided.' 
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const user = await User.findById(decoded.userId).select('-password');
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid token. User not found.' 
            });
        }

        req.user = user;
        req.userId = decoded.userId;
        next();
    } catch (error) {
        return res.status(401).json({ 
            success: false, 
            message: 'Invalid or expired token.' 
        });
    }
};

// Check if user is admin
const isAdmin = async (req, res, next) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'vice_admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. Admin privileges required.' 
            });
        }
        next();
    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: 'Error checking admin privileges.' 
        });
    }
};

// Check if user is manager or admin
const isManagerOrAdmin = async (req, res, next) => {
    try {
        if (req.user.role !== 'manager' && req.user.role !== 'admin' && req.user.role !== 'vice_admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. Manager or Admin privileges required.' 
            });
        }
        next();
    } catch (error) {
        return res.status(500).json({ 
            success: false, 
            message: 'Error checking privileges.' 
        });
    }
};

// Optional authentication (doesn't require token)
const optionalAuth = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
            const user = await User.findById(decoded.userId).select('-password');
            if (user) {
                req.user = user;
                req.userId = decoded.userId;
            }
        }
        next();
    } catch (error) {
        // If token is invalid, continue without user
        next();
    }
};

module.exports = {
    verifyToken,
    isAdmin,
    isManagerOrAdmin,
    optionalAuth
};

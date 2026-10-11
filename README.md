# Attendance Management System

A full-stack attendance tracking solution built with Node.js, Express, MongoDB, and Socket.IO. The system helps organizations monitor employee attendance, automate absence alerts, manage leaves, handle shift rosters, and provide real-time updates for administrators and staff.

## Problem Statement

Traditional attendance systems often rely on manual processes such as paper registers, spreadsheets, or inconsistent check-in methods. These methods create several challenges:

- Errors in attendance recording and payroll calculations
- Difficulty tracking late arrivals, missed check-ins, and absences
- Delayed communication about employee attendance issues
- Limited traceability for auditor or management reviews
- Time-consuming leave and shift management
- Lack of real-time visibility for managers and administrators

## Solution

This project provides a centralized digital attendance management platform that:

- Automates employee check-in and check-out
- Tracks employee attendance status in real time
- Detects absent employees automatically
- Supports leave requests and roster-based scheduling
- Maintains audit logs for accountability
- Sends notifications via email, SMS, or WhatsApp
- Supports biometric and face-based attendance workflows
- Provides web-based dashboards and employee record management

## Objectives

The main objectives of this project are to:

- Eliminate manual attendance errors
- Improve employee accountability and punctuality
- Provide real-time attendance visibility to managers
- Reduce administrative overhead in HR and operations
- Maintain secure and auditable employee records
- Support efficient payroll and compliance reporting
- Enable modern, scalable employee management workflows

## Key Features

- User authentication and role-based access
- Admin, manager, vice-admin, and employee roles
- Employee registration and profile management
- Attendance check-in and check-out tracking
- Late arrival and absence detection
- Automatic daily absent alerts
- Leave request handling
- Shift roster management
- Student/employee marks tracking module
- Biometric and face-enrollment support
- Device-based verification and OTP-based login protection
- Real-time updates through Socket.IO
- File upload support for profile photos and documents
- Email/SMS/WhatsApp notification support
- Audit log generation for operational transparency
- MongoDB-backed data persistence

## Tech Stack

- Backend: Node.js, Express.js
- Database: MongoDB with Mongoose
- Real-time communication: Socket.IO
- Authentication: JWT, express-session, bcryptjs
- Validation: express-validator
- Notifications: nodemailer, SMS/WhatsApp supports via utility layer
- File handling: multer
- Reporting/export: ExcelJS, PDFKit
- Frontend: Static HTML/CSS/JS in the public folder

## Project Structure

```text
attendance-management-system/
├── .env
├── data/
├── middleware/
├── models/
├── public/
├── routes/
├── utils/
├── package.json
├── server.js
├── run.txt
└── README.md
```

## Core Modules

### Server and App Setup
The project initializes an Express server, connects to MongoDB, loads environment variables, configures session handling, and exposes the REST API for attendance and user management.

### Authentication and User Management
The app supports user registration, login, token generation, and role-based access restrictions. Admin creation can be handled through environment variables and the initial boot flow.

### Attendance Management
Employees can check in and check out through the attendance API. The system validates duplicate check-ins, calculates late status, tracks check-out data, and records attendance for each day.

### Alerts and Notification System
The project includes an alert engine that creates and triggers attendance alerts for scenarios like late check-ins or absences. Notifications can be delivered through configured channels.

### Audit and Compliance
Audit logs capture user actions and system events so administrators can review operational changes and maintain accountability.

### Leave and Roster Logic
The project includes dedicated modules for managing leave requests and shift rosters, helping HR and managers assign and review work schedules efficiently.

### Biometric and Device Security
The system supports face-enrollment, device binding, OTP verification, and attendance flow controls designed around employee identity validation.

## Installation

1. Clone the repository
2. Open the project folder
3. Install dependencies:

```bash
npm install
```

4. Start MongoDB locally

On Windows:

```bash
net start MongoDB
```

Or run MongoDB manually from your installation directory if needed.

5. Start the app in development mode:

```bash
npm run dev
```

Production run:

```bash
npm start
```

## Environment Configuration

Create or update the `.env` file in the project root with the following variables:

```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/attendance_db
JWT_SECRET=your-super-secret-jwt-key-2024
SESSION_SECRET=your-session-secret-key-2024
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-email-password
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123
ADMIN_USERNAME=Admin
```

Note: Replace the sample values with your actual secure configuration before running the application in a live environment.

## Running the Project

Use the following commands:

```bash
npm install
npm run dev
```

Then open the local application in a browser using the configured port, typically:

```text
http://localhost:3000
```

## API Overview

The application exposes several API groups under `/api`, including:

- `/api/auth` — registration, login, logout, session-driven user workflows
- `/api/attendance` — attendance records, check-in/out logic, reports
- `/api/marks` — marks-related operations
- `/api/leave` — leave requests and leave data management
- `/api/roster` — roster and shift management
- `/api/alerts` — alert generation and monitoring
- `/api/audit` — audit trail access
- `/api/biometric` — biometric and identity-related attendance logic
- `/api/upload` — profile and document uploads

## Security Considerations

This project includes several operational safeguards such as:

- JWT-based authentication
- Session-based access handling
- Password hashing with bcrypt
- Device verification and OTP checks
- IP-based attendance restrictions through middleware
- Role-based authorization rules

For production deployment, it is strongly recommended to:

- Use a real MongoDB deployment instead of localhost
- Use strong secret values in environment variables
- Configure HTTPS
- Restrict cross-origin access appropriately
- Add production-grade monitoring and logging
- Validate all requests using secure backend rules

## Future Enhancements

Potential improvements for this application include:

- Dashboard analytics for management reporting
- Advanced export reports (CSV, PDF, Excel)
- Multi-branch and multi-location support
- Facial recognition benchmarking and better verification workflows
- Notification templates and scheduling
- Better mobile-first attendance experience
- Detailed role permissions and admin oversight controls

## License

This project is currently distributed under the ISC license as defined in the package metadata.

## Summary

This Attendance Management System is designed to modernize workforce tracking by replacing manual processes with a secure, real-time, and scalable digital solution. It addresses the core business problem of employee attendance tracking while providing management tools that improve accountability, automation, and operational efficiency.

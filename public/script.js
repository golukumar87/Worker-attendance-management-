const API_BASE = (() => {
  if (window.location.protocol === 'file:') return 'http://localhost:3000';
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    if (window.location.port && window.location.port !== '3000') {
      return 'http://localhost:3000';
    }
  }
  return window.location.origin;
})();

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function getDeviceId() {
  const key = 'attendanceDeviceId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `dev-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function getDeviceName() {
  return navigator.userAgent || 'Browser';
}

function isDashboardPage() {
  return window.location.pathname.toLowerCase().includes('dashboard.html');
}

// Initialize Socket.IO
const socket = io(API_BASE);

// Global variables
let attendanceChart = null;
let currentUser = null;
let token = sessionStorage.getItem('token');
let lastAttendanceRecords = [];
let cachedEmployees = [];
let cachedMarks = [];
const PENDING_KEY = 'pendingAttendanceActions';
let heroGuardLastShown = 0;
let qrScannerInstance = null;
let faceStream = null;
let photoStream = null;
let photoMode = 'checkin';
let capturedFaceImage = '';
let capturedCheckInPhoto = '';
let capturedCheckOutPhoto = '';
let faceModelsLoaded = false;
let faceEnrollMode = false;
let lastLivenessPassed = false;
let lastLivenessScore = 0;
let currentQrToken = '';
let qrTokenTimer = null;
let qrExpiryAt = 0;
let qrCountdownTimer = null;
let geoMap = null;
let geoCircle = null;
let geoMarker = null;
let currentCoords = null;
let currentAccuracy = null;
let monthlyTrendChart = null;
let departmentPerfChart = null;
const ATTENDANCE_CACHE_KEY = 'attendanceHistoryCache';
const GEO_BRANCHES_KEY = 'geofenceBranches';
const GEO_ACTIVE_KEY = 'geofenceActiveBranch';

function initTooltips() {
  const explicitTooltips = [
    { selector: '.logout-btn', text: 'Logout' },
    { selector: '#navLoginBtn', text: 'Login to your account' },
    { selector: '#navRegisterBtn', text: 'Create a new account' },
    { selector: '.nav-btn-profile', text: 'Edit profile details' },
    { selector: '.nav-btn-logout', text: 'Logout' },
    { selector: '.btn-edit', text: 'Edit record' },
    { selector: '.btn-delete', text: 'Delete record' },
    { selector: '.present-shift', text: 'Update shift' },
    { selector: '#checkInBtn', text: 'Submit check-in for today' },
    { selector: '#checkOutBtn', text: 'Submit check-out for today' },
    { selector: '#applyFilter', text: 'Filter attendance records' },
    { selector: '#generateReport', text: 'Generate report for selected dates' },
    { selector: '#exportReport', text: 'Download report as PDF' },
    { selector: '#addEmployeeBtn', text: 'Add a new employee' },
    { selector: '#saveSettings', text: 'Save settings changes' },
    { selector: '#filterDate', text: 'Filter by date' },
    { selector: '#filterDepartment', text: 'Filter by department' },
    { selector: '#filterStatus', text: 'Filter by status' },
    { selector: '#reportStartDate', text: 'Report start date' },
    { selector: '#reportEndDate', text: 'Report end date' },
    { selector: '#reportDepartment', text: 'Report department' },
    { selector: '#employeeSearch', text: 'Search employees' },
    { selector: '#marksSearch', text: 'Search payroll records' },
    { selector: '#marksDepartmentFilter', text: 'Filter payroll by department' }
  ];

  const processedFlag = 'tooltipReady';

  function getLabelText(control) {
    const id = control.getAttribute('id');
    let label = null;
    if (id) {
      label = document.querySelector(`label[for="${id}"]`);
    }
    if (!label) {
      label = control.closest('label');
    }
    if (!label) return '';
    return label.textContent.replace(/\s+/g, ' ').trim();
  }

  function setTooltip(el, text, options = {}) {
    if (!text) return;
    if (el.dataset[processedFlag]) return;
    const isFormControl = options.isFormControl === true
      || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
    if (isFormControl) {
      if (!el.getAttribute('title')) {
        el.setAttribute('title', text);
      }
    } else {
      if (!el.dataset.tooltip) {
        el.dataset.tooltip = text;
      }
    }
    if (!el.getAttribute('aria-label')) {
      el.setAttribute('aria-label', text);
    }
    el.dataset[processedFlag] = 'true';
  }

  function applyTooltips(root) {
    if (!root || !root.querySelectorAll) return;

    explicitTooltips.forEach(({ selector, text }) => {
      root.querySelectorAll(selector).forEach(el => setTooltip(el, text));
    });

    root.querySelectorAll('input, select, textarea').forEach(el => {
      if (el.type === 'hidden') return;
      if (el.closest('#heroAttendanceForm')) return;
      if (el.dataset[processedFlag]) return;
      const labelText = getLabelText(el);
      const placeholderText = (el.getAttribute('placeholder') || '').trim();
      const tooltipText = labelText || placeholderText;
      setTooltip(el, tooltipText, { isFormControl: true });
    });

    root.querySelectorAll('button, a, [role="button"]').forEach(el => {
      if (el.dataset[processedFlag]) return;
      let text = '';
      if (el.classList.contains('feature-card-link')) {
        const title = el.querySelector('h3')?.textContent?.trim();
        text = title ? `View ${title} details` : '';
      } else {
        text = (el.getAttribute('aria-label')
          || el.getAttribute('title')
          || el.textContent)
          .replace(/\s+/g, ' ')
          .trim();
        if (text.length > 80) {
          text = `${text.slice(0, 77)}...`;
        }
      }
      if (!text) return;
      setTooltip(el, text);
    });
  }

  applyTooltips(document);

  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => applyTooltips(node));
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// DOM Elements
document.addEventListener('DOMContentLoaded', function() {
  const splash = document.getElementById('welcomeSplash');
  if (splash) {
    setTimeout(() => {
      splash.classList.add('hide');
      setTimeout(() => splash.remove(), 700);
    }, 8000);
  }
  localStorage.removeItem('token');
  // Initialize date and time
  updateDateTime();
  setInterval(updateDateTime, 1000);
  
  // Setup event listeners
  setupEventListeners();
  
  // Socket.IO listeners
  setupSocketListeners();
  
  // Check if user is logged in
  if (token) {
    verifyToken();
  }
  
  // Initialize hamburger menu
  initHamburger();

  // Render any pending offline actions
  renderPendingActions();

  // Sync when back online
  window.addEventListener('online', syncPendingActions);

  updateNavAuthUI();
  if (document.getElementById('heroLocation')) {
    getLocation();
  }

  initHeroAttendanceGuard();
  initTooltips();
  applyRoleBasedUI();
  const holidayYearInput = document.getElementById('holidayYear');
  if (holidayYearInput && !holidayYearInput.value) {
    holidayYearInput.value = new Date().getFullYear();
  }
  if (isDashboardPage()) {
    loadFaceModels();
    fillGeofenceInputs();
    updateGeoMap();
    initCoreFeatureControls();
  }
});

// Initialize hamburger menu
function initHamburger() {
  const hamburger = document.querySelector('.hamburger');
  const navMenu = document.querySelector('.nav-menu');
  
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      navMenu.classList.toggle('active');
      hamburger.classList.toggle('active');
    });
  }
}

// Verify token
async function verifyToken() {
  try {
    const response = await fetch(apiUrl('/api/auth/profile'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const data = await response.json();
    
  if (data.success) {
    currentUser = data.user;
    if (isDashboardPage()) {
      showApplication();
      updateUserInfo();
      updateNavAuthUI();
    }
    updateNavAuthUI();
    refreshQrToken();
  } else {
      sessionStorage.removeItem('token');
      token = null;
      currentUser = null;
      updateNavAuthUI();
    }
  } catch (error) {
    console.error('Token verification failed:', error);
    updateNavAuthUI();
  }
}

// Show application (hide hero, show main app)
function showApplication() {
  const hero = document.querySelector('.hero');
  const features = document.querySelector('.features-section');
  const appContainer = document.querySelector('.app-container');
  const dashboardGuard = document.getElementById('dashboardGuard');

  if (!appContainer) {
    window.location.href = 'dashboard.html';
    return;
  }

  if (hero) hero.style.display = 'none';
  if (features) features.style.display = 'none';
  if (dashboardGuard) dashboardGuard.style.display = 'none';
  if (appContainer) appContainer.style.display = 'block';
  loadDashboard();
  loadSavedData();
  renderPendingActions();
}

// Update user information in sidebar
function updateUserInfo() {
  if (currentUser) {
    document.getElementById('userName').textContent = currentUser.username || 'User';
    document.getElementById('userRole').textContent = currentUser.role || 'Employee';
    document.getElementById('userDepartment').textContent = currentUser.department || '';
    document.getElementById('headerUserName').textContent = currentUser.username || 'User';
    
    if (currentUser.profilePicture) {
      document.getElementById('sidebarProfilePic').src = currentUser.profilePicture;
      document.getElementById('headerProfilePic').src = currentUser.profilePicture;
    }
    renderUserQRCode();
    updateFaceEnrollStatus();
    startQrTokenAutoRefresh();
    updateDeviceInfo();
    const emailToggle = document.getElementById('emailNotifications');
    const smsToggle = document.getElementById('smsNotifications');
    const waToggle = document.getElementById('whatsappNotifications');
    if (emailToggle) emailToggle.checked = currentUser.notifyEmail !== false;
    if (smsToggle) smsToggle.checked = Boolean(currentUser.notifySms);
    if (waToggle) waToggle.checked = Boolean(currentUser.notifyWhatsapp);
  }
}

function updateNavAuthUI() {
  const loginItem = document.getElementById('navLoginItem');
  const registerItem = document.getElementById('navRegisterItem');
  const userItem = document.getElementById('navUserItem');
  const userName = document.getElementById('navUserName');
  const userPic = document.getElementById('navUserPic');

  if (!loginItem || !registerItem || !userItem) return;

  if (currentUser && token) {
    loginItem.style.display = 'none';
    registerItem.style.display = 'none';
    userItem.style.display = 'flex';
    if (userName) userName.textContent = currentUser.username || 'Admin';
    if (userPic) userPic.src = currentUser.profilePicture || 'raa.jpg';
  } else {
    loginItem.style.display = 'list-item';
    registerItem.style.display = 'list-item';
    userItem.style.display = 'none';
    if (userPic) userPic.src = 'raa.jpg';
  }

  updateHeroAttendanceAccess();
  applyRoleBasedUI();
}

function applyRoleBasedUI() {
  const role = currentUser?.role || 'guest';
  const accessMap = {
    admin: ['dashboard', 'core-features', 'mark-attendance', 'qr-attendance', 'history', 'reports', 'alerts', 'leave-management', 'shift-roster', 'geo-fencing', 'analytics', 'offline-sync', 'export-center', 'smart-insights', 'shift-automation', 'leave-approval', 'payroll-sync', 'audit-trail', 'device-management', 'api-integrations', 'employees', 'marks', 'settings', 'saved-data', 'present-employees'],
    vice_admin: ['dashboard', 'core-features', 'mark-attendance', 'qr-attendance', 'history', 'reports', 'alerts', 'leave-management', 'shift-roster', 'geo-fencing', 'analytics', 'offline-sync', 'export-center', 'smart-insights', 'shift-automation', 'leave-approval', 'payroll-sync', 'audit-trail', 'device-management', 'api-integrations', 'employees', 'marks', 'settings', 'saved-data', 'present-employees'],
    manager: ['dashboard', 'core-features', 'mark-attendance', 'qr-attendance', 'history', 'reports', 'alerts', 'leave-management', 'shift-roster', 'geo-fencing', 'offline-sync', 'export-center', 'smart-insights', 'shift-automation', 'leave-approval', 'payroll-sync', 'audit-trail', 'device-management', 'api-integrations', 'settings', 'present-employees'],
    employee: ['dashboard', 'core-features', 'mark-attendance', 'qr-attendance', 'history', 'reports', 'alerts', 'leave-management', 'settings']
  };
  const allowed = new Set(accessMap[role] || accessMap.employee);
  document.querySelectorAll('.nav-btn').forEach(btn => {
    const tab = btn.dataset.tab;
    if (!tab) return;
    btn.style.display = allowed.has(tab) ? 'flex' : 'none';
  });
  document.querySelectorAll('.tab-content').forEach(tab => {
    const id = tab.id;
    if (!id) return;
    tab.style.display = allowed.has(id) ? '' : 'none';
  });
  const activeTab = document.querySelector('.tab-content.active');
  if (activeTab && !allowed.has(activeTab.id)) {
    if (allowed.has('dashboard')) {
      switchTab('dashboard');
    }
  }
}

function updateDeviceInfo() {
  const info = document.getElementById('deviceInfo');
  if (!info) return;
  if (!currentUser?.deviceId) {
    info.textContent = 'No device bound';
    return;
  }
  const boundAt = currentUser.deviceBoundAt ? new Date(currentUser.deviceBoundAt).toLocaleString() : 'unknown';
  info.textContent = `Bound device: ${currentUser.deviceName || 'This device'} (since ${boundAt})`;
}

async function resetDeviceBinding() {
  if (!token) {
    showToast('Please login first', 'warning');
    return;
  }
  try {
    const response = await fetch(apiUrl('/api/auth/device/reset'), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.success) {
      currentUser.deviceId = null;
      currentUser.deviceName = '';
      currentUser.deviceBoundAt = null;
      updateDeviceInfo();
      showToast('Device binding reset. Please login again to bind.', 'success');
    } else {
      showToast(data.message || 'Device reset failed', 'error');
    }
  } catch (error) {
    showToast('Device reset failed', 'error');
  }
}

function openKioskMode() {
  window.open('kiosk.html', '_blank');
}

// Handle Login
async function handleLogin(event) {
  event.preventDefault();
  
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  
  try {
    const response = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, deviceId: getDeviceId(), deviceName: getDeviceName() })
    });
    
    const data = await response.json();
    
    if (data.success) {
      token = data.token;
      currentUser = data.user;
      sessionStorage.setItem('token', token);
      closeModal('loginModal');
      showToast('Login successful!', 'success');
      updateNavAuthUI();
      updateDeviceInfo();
      if (isDashboardPage()) {
        showApplication();
        updateUserInfo();
      } else {
        window.location.href = 'dashboard.html';
      }
    } else {
      if (data.code === 'DEVICE_OTP_REQUIRED') {
        const otp = prompt('Device OTP required. Please enter OTP sent to your email/phone:');
        if (otp) {
          await verifyDeviceOtp(email, otp);
        }
      } else {
        showToast(data.message || 'Login failed', 'error');
      }
    }
  } catch (error) {
    showToast('Network error. Please try again.', 'error');
  }
}

// Handle Register
async function handleRegister(event) {
  event.preventDefault();
  
  const username = document.getElementById('regUsername').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  const department = document.getElementById('regDepartment').value;
  
  try {
    const response = await fetch(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, department, deviceId: getDeviceId(), deviceName: getDeviceName() })
    });
    
    const data = await response.json();
    
    if (data.success) {
      token = data.token;
      currentUser = data.user;
      sessionStorage.setItem('token', token);
    closeModal('registerModal');
    showToast('Registration successful!', 'success');
    updateNavAuthUI();
    refreshQrToken();
    if (isDashboardPage()) {
      showApplication();
      updateUserInfo();
    } else {
        window.location.href = 'dashboard.html';
      }
    } else {
      showToast(data.message || 'Registration failed', 'error');
    }
  } catch (error) {
    showToast('Network error. Please try again.', 'error');
  }
}

// Logout
async function logout() {
  try {
    if (token) {
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    }
  } catch (error) {
    console.error('Logout error:', error);
  }
  sessionStorage.removeItem('token');
  token = null;
  currentUser = null;
  if (qrTokenTimer) {
    clearInterval(qrTokenTimer);
    qrTokenTimer = null;
  }
  if (qrCountdownTimer) {
    clearInterval(qrCountdownTimer);
    qrCountdownTimer = null;
  }
  currentQrToken = '';
  qrExpiryAt = 0;
  const hero = document.querySelector('.hero');
  const features = document.querySelector('.features-section');
  const appContainer = document.querySelector('.app-container');
  const dashboardGuard = document.getElementById('dashboardGuard');

  if (appContainer) appContainer.style.display = 'none';
  if (hero) hero.style.display = 'flex';
  if (features) features.style.display = 'block';
  if (dashboardGuard) dashboardGuard.style.display = 'block';
  updateNavAuthUI();
  updateDeviceInfo();
  if (!hero) {
    window.location.href = 'index.html';
    return;
  }
  showToast('Logged out successfully', 'success');
}

// Show Login Modal
function showLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) modal.style.display = 'block';
}

// Show Register Modal
function showRegisterModal() {
  const modal = document.getElementById('registerModal');
  if (modal) modal.style.display = 'block';
}

async function verifyDeviceOtp(email, otp) {
  try {
    const response = await fetch(apiUrl('/api/auth/device/verify-otp'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    const data = await response.json();
    if (data.success) {
      showToast('Device verified. Please login again.', 'success');
    } else {
      showToast(data.message || 'OTP verification failed', 'error');
    }
  } catch (error) {
    showToast('OTP verification failed', 'error');
  }
}

function showProfileModal() {
  if (!currentUser) {
    showToast('Please login first', 'warning');
    return;
  }
  const nameInput = document.getElementById('profileName');
  const emailInput = document.getElementById('profileEmail');
  const phoneInput = document.getElementById('profilePhone');
  const deptInput = document.getElementById('profileDepartment');
  const roleInput = document.getElementById('profileRole');
  const pinInput = document.getElementById('profilePin');

  if (nameInput) nameInput.value = currentUser.username || '';
  if (emailInput) emailInput.value = currentUser.email || '';
  if (phoneInput) phoneInput.value = currentUser.phone || '';
  if (deptInput) deptInput.value = currentUser.department || 'IT';
  if (roleInput) roleInput.value = currentUser.role || 'admin';
  if (pinInput) pinInput.value = '';

  const modal = document.getElementById('profileModal');
  if (modal) modal.style.display = 'block';
}

async function saveProfile(event) {
  event.preventDefault();
  if (!token) {
    showToast('Please login first', 'warning');
    return;
  }

  const payload = {
    username: document.getElementById('profileName')?.value?.trim(),
    email: document.getElementById('profileEmail')?.value?.trim(),
    phone: document.getElementById('profilePhone')?.value?.trim(),
    department: document.getElementById('profileDepartment')?.value,
    role: document.getElementById('profileRole')?.value,
    attendancePin: document.getElementById('profilePin')?.value?.trim()
  };

  try {
    const response = await fetch(apiUrl('/api/auth/profile'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.success) {
      currentUser = data.user;
      updateUserInfo();
      updateNavAuthUI();
      updateDeviceInfo();
      const pinInput = document.getElementById('profilePin');
      if (pinInput) pinInput.value = '';
      closeModal('profileModal');
      showToast('Profile updated successfully', 'success');
    } else {
      showToast(data.message || 'Error updating profile', 'error');
    }
  } catch (error) {
    showToast('Error updating profile', 'error');
  }
}

// Close Modal
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

// Scroll to features
function scrollToFeatures() {
  const features = document.getElementById('features');
  if (features) {
    features.scrollIntoView({ behavior: 'smooth' });
  } else {
    window.location.href = 'features.html';
  }
}

function goToDemo() {
  window.location.href = 'features.html#demo';
}

function goToDashboard() {
  window.location.href = 'dashboard.html';
}

// Update date and time
function updateDateTime() {
  const now = new Date();
  const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
  
  const dateElement = document.getElementById('currentDate');
  const timeElement = document.getElementById('currentTime');
  
  if (dateElement) dateElement.textContent = now.toLocaleDateString('en-US', dateOptions);
  if (timeElement) timeElement.textContent = now.toLocaleTimeString('en-US', timeOptions);
}

function loadGeofenceBranches() {
  try {
    const raw = localStorage.getItem(GEO_BRANCHES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveGeofenceBranches(branches) {
  localStorage.setItem(GEO_BRANCHES_KEY, JSON.stringify(branches));
}

function ensureDefaultBranch() {
  const branches = loadGeofenceBranches();
  if (branches.length) return branches;
  const fallback = { id: 'main', name: 'Main Office', lat: 28.6139, lng: 77.2090, radius: 300, radiusDay: 300, radiusNight: 450, radiusExtra: 600 };
  saveGeofenceBranches([fallback]);
  localStorage.setItem(GEO_ACTIVE_KEY, fallback.id);
  return [fallback];
}

function getActiveGeofenceBranch() {
  const branches = ensureDefaultBranch();
  const activeId = localStorage.getItem(GEO_ACTIVE_KEY) || branches[0].id;
  return branches.find(b => b.id === activeId) || branches[0];
}

function populateGeofenceBranchSelect() {
  const select = document.getElementById('geoBranchSelect');
  if (!select) return;
  const branches = ensureDefaultBranch();
  select.innerHTML = '';
  branches.forEach(branch => {
    const option = document.createElement('option');
    option.value = branch.id;
    option.textContent = branch.name;
    select.appendChild(option);
  });
  const active = getActiveGeofenceBranch();
  select.value = active.id;
}

function selectGeofenceBranch() {
  const select = document.getElementById('geoBranchSelect');
  if (!select) return;
  localStorage.setItem(GEO_ACTIVE_KEY, select.value);
  fillGeofenceInputs();
  updateGeoMap();
}

function addGeofenceBranch() {
  const name = document.getElementById('geoBranchName')?.value?.trim();
  if (!name) {
    showToast('Branch name required', 'warning');
    return;
  }
  const branches = ensureDefaultBranch();
  const id = `branch-${Date.now()}`;
  const settings = getGeofenceSettings();
  branches.push({
    id,
    name,
    lat: settings.lat,
    lng: settings.lng,
    radius: settings.radius,
    radiusDay: settings.radiusDay,
    radiusNight: settings.radiusNight,
    radiusExtra: settings.radiusExtra
  });
  saveGeofenceBranches(branches);
  localStorage.setItem(GEO_ACTIVE_KEY, id);
  document.getElementById('geoBranchName').value = '';
  populateGeofenceBranchSelect();
  showToast('Branch added', 'success');
}

function getGeofenceSettings() {
  const fallback = { lat: 28.6139, lng: 77.2090, radius: 300, radiusDay: 300, radiusNight: 450, radiusExtra: 600 };
  const branch = getActiveGeofenceBranch();
  if (!branch) return fallback;
  return {
    lat: Number(branch.lat) || fallback.lat,
    lng: Number(branch.lng) || fallback.lng,
    radius: Number(branch.radius) || fallback.radius,
    radiusDay: Number(branch.radiusDay) || Number(branch.radius) || fallback.radiusDay,
    radiusNight: Number(branch.radiusNight) || fallback.radiusNight,
    radiusExtra: Number(branch.radiusExtra) || fallback.radiusExtra
  };
}

function saveGeofenceSettings() {
  const lat = Number(document.getElementById('geoLat')?.value);
  const lng = Number(document.getElementById('geoLng')?.value);
  const radius = Number(document.getElementById('geoRadius')?.value);
  const radiusDay = Number(document.getElementById('geoRadiusDay')?.value);
  const radiusNight = Number(document.getElementById('geoRadiusNight')?.value);
  const radiusExtra = Number(document.getElementById('geoRadiusExtra')?.value);
  if (!lat || !lng || !radius) {
    showToast('Please enter valid geo-fence values', 'warning');
    return;
  }
  const branches = ensureDefaultBranch();
  const active = getActiveGeofenceBranch();
  const idx = branches.findIndex(b => b.id === active.id);
  const updated = {
    ...active,
    lat,
    lng,
    radius,
    radiusDay: radiusDay || radius,
    radiusNight: radiusNight || Math.round(radius * 1.5),
    radiusExtra: radiusExtra || Math.round(radius * 2)
  };
  if (idx >= 0) {
    branches[idx] = updated;
  }
  saveGeofenceBranches(branches);
  showToast('Geo-fence saved', 'success');
  updateGeoMap();
  updateGeofenceStatus();
}

function fillGeofenceInputs() {
  populateGeofenceBranchSelect();
  const settings = getGeofenceSettings();
  const latInput = document.getElementById('geoLat');
  const lngInput = document.getElementById('geoLng');
  const radiusInput = document.getElementById('geoRadius');
  const radiusDayInput = document.getElementById('geoRadiusDay');
  const radiusNightInput = document.getElementById('geoRadiusNight');
  const radiusExtraInput = document.getElementById('geoRadiusExtra');
  if (latInput) latInput.value = settings.lat;
  if (lngInput) lngInput.value = settings.lng;
  if (radiusInput) radiusInput.value = settings.radius;
  if (radiusDayInput) radiusDayInput.value = settings.radiusDay;
  if (radiusNightInput) radiusNightInput.value = settings.radiusNight;
  if (radiusExtraInput) radiusExtraInput.value = settings.radiusExtra;
}

function haversineDistanceMeters(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function getActiveShift() {
  const shiftSelect = document.getElementById('shift');
  if (shiftSelect && shiftSelect.value) return shiftSelect.value;
  const heroShift = document.getElementById('heroShift');
  if (heroShift && heroShift.value) return heroShift.value;
  return currentUser?.defaultShift || currentUser?.shift || 'Day';
}

function getEffectiveRadius(settings) {
  const shift = getActiveShift();
  if (shift === 'Night') return settings.radiusNight || settings.radius;
  if (shift === 'Extra Work') return settings.radiusExtra || settings.radius;
  return settings.radiusDay || settings.radius;
}

function isInsideGeofence() {
  if (!currentCoords) return false;
  const settings = getGeofenceSettings();
  const distance = haversineDistanceMeters(currentCoords, settings);
  const radius = getEffectiveRadius(settings);
  return distance <= radius;
}

function updateGeofenceStatus() {
  const statusEl = document.getElementById('geoStatus');
  if (!currentCoords) {
    if (statusEl) statusEl.textContent = 'Location not available';
    return;
  }
  const settings = getGeofenceSettings();
  const distance = haversineDistanceMeters(currentCoords, settings);
  const radius = getEffectiveRadius(settings);
  const inside = distance <= radius;
  if (statusEl) {
    statusEl.textContent = inside
      ? `Inside office radius (${Math.round(distance)}m / ${radius}m)`
      : `Outside office radius (${Math.round(distance)}m / ${radius}m)`;
  }

  const checkInBtn = document.getElementById('checkInBtn');
  const checkOutBtn = document.getElementById('checkOutBtn');
  const heroIn = document.getElementById('heroCheckInBtn');
  const heroOut = document.getElementById('heroCheckOutBtn');
  if (checkInBtn) checkInBtn.disabled = !inside;
  if (checkOutBtn) checkOutBtn.disabled = !inside;
  if (heroIn) heroIn.disabled = !inside;
  if (heroOut) heroOut.disabled = !inside;
}

function updateGeoMap() {
  const mapEl = document.getElementById('geoMap');
  if (!mapEl || !window.L) return;
  const settings = getGeofenceSettings();
  const radius = getEffectiveRadius(settings);
  if (!geoMap) {
    geoMap = L.map('geoMap').setView([settings.lat, settings.lng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(geoMap);
    geoMap.on('click', (event) => {
      const latInput = document.getElementById('geoLat');
      const lngInput = document.getElementById('geoLng');
      if (latInput) latInput.value = event.latlng.lat.toFixed(6);
      if (lngInput) lngInput.value = event.latlng.lng.toFixed(6);
      showToast('Office location updated. Save to apply.', 'info');
    });
  }
  if (geoCircle) geoMap.removeLayer(geoCircle);
  geoCircle = L.circle([settings.lat, settings.lng], {
    radius,
    color: '#2563eb',
    fillColor: '#60a5fa',
    fillOpacity: 0.2
  }).addTo(geoMap);

  if (currentCoords) {
    if (geoMarker) geoMap.removeLayer(geoMarker);
    geoMarker = L.marker([currentCoords.lat, currentCoords.lng]).addTo(geoMap);
  }
  geoMap.setView([settings.lat, settings.lng], 15);
  if (mapEl.offsetParent === null) {
    setTimeout(() => {
      if (geoMap) geoMap.invalidateSize();
    }, 220);
  } else {
    geoMap.invalidateSize();
  }
}

async function reportGeofenceViolation(reason) {
  if (!token) return;
  try {
    await fetch(apiUrl('/api/attendance/geofence-violation'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        location: document.getElementById('location')?.value || '',
        locationLat: currentCoords?.lat,
        locationLng: currentCoords?.lng,
        locationAccuracy: currentAccuracy,
        reason: reason || 'Outside geo-fence'
      })
    });
  } catch (_) {}
}

function ensureInsideGeofence() {
  if (!currentCoords) {
    showToast('Location unavailable. Please enable GPS.', 'warning');
    return false;
  }
  if (!isInsideGeofence()) {
    showToast('Outside office radius. Attendance not allowed.', 'error');
    reportGeofenceViolation('Outside office radius');
    return false;
  }
  return true;
}

function isLoggedIn() {
  return Boolean(token && currentUser);
}

function updateHeroAttendanceAccess() {
  const form = document.getElementById('heroAttendanceForm');
  if (!form) return;
  const container = form.closest('.attendance-form-container');
  const locked = !isLoggedIn();
  form.dataset.locked = locked ? 'true' : 'false';
  if (container) {
    container.classList.toggle('hero-locked', locked);
  }
}

function initHeroAttendanceGuard() {
  const form = document.getElementById('heroAttendanceForm');
  if (!form) return;

  const guard = (event) => {
    if (isLoggedIn()) return;
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (now - heroGuardLastShown > 1500) {
      showToast('Please login to mark attendance.', 'warning');
      heroGuardLastShown = now;
    }
    showLoginModal();
    const active = document.activeElement;
    if (active && form.contains(active)) active.blur();
  };

  ['submit', 'focusin', 'click', 'keydown'].forEach(evt => {
    form.addEventListener(evt, guard, true);
  });
}

// Setup event listeners
function setupEventListeners() {
  // Close modals when clicking outside
  window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
      event.target.style.display = 'none';
    }
  };

  const shiftSelect = document.getElementById('shift');
  if (shiftSelect) {
    shiftSelect.addEventListener('change', () => {
      updateGeofenceStatus();
      updateGeoMap();
    });
  }
}

// Setup Socket.IO listeners
function setupSocketListeners() {
  socket.on('attendance-update', (data) => {
    showToast(`${data.data?.name || 'Someone'} ${data.type === 'checkin' ? 'checked in' : 'checked out'}`, 'success');
    const appContainer = document.querySelector('.app-container');
    if (appContainer && appContainer.style.display === 'block') {
      loadDashboard();
      loadAttendanceHistory();
    }
  });
}

// Switch between tabs
function switchTab(tabId) {
  // Update active button
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.tab === tabId) {
      btn.classList.add('active');
    }
  });
  
  // Show selected tab
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.getElementById(tabId).classList.add('active');
  
  // Load tab specific data
  switch(tabId) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'mark-attendance':
      getLocation();
      loadTodayStatus();
      break;
    case 'qr-attendance':
      getLocation();
      ensureQrTokenFresh();
      break;
    case 'history':
      loadAttendanceHistory();
      break;
    case 'reports':
      loadAutoReports();
      break;
    case 'alerts':
      loadAlerts();
      if (currentUser?.role === 'admin' || currentUser?.role === 'vice_admin' || currentUser?.role === 'manager') {
        loadGeofenceViolations();
        loadAuditLogs();
        if (currentUser?.role === 'admin' || currentUser?.role === 'vice_admin') {
          loadEditRequests();
        }
        loadAnomalies();
      }
      break;
    case 'leave-management':
      loadLeaveBalance();
      loadMyLeaves();
      loadPendingLeaves();
      loadHolidays();
      break;
    case 'shift-roster':
      loadRoster();
      break;
    case 'geo-fencing':
      fillGeofenceInputs();
      updateGeoMap();
      updateGeofenceStatus();
      setTimeout(() => {
        if (geoMap) geoMap.invalidateSize();
      }, 200);
      break;
    case 'analytics':
      loadAnalytics();
      break;
    case 'employees':
      loadEmployees();
      break;
    case 'marks':
      loadMarks();
      loadPayrollSummary();
      break;
    case 'settings':
      loadDocuments();
      updateDeviceInfo();
      break;
    case 'saved-data':
      loadSavedData();
      break;
    case 'present-employees':
      loadPresentEmployees();
      break;
  }
}

// Get user location
function getLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const accuracy = Math.round(position.coords.accuracy || 0);
        const coords = `Lat: ${position.coords.latitude.toFixed(4)}, Long: ${position.coords.longitude.toFixed(4)}${accuracy ? ` (+/-${accuracy}m)` : ''}`;
        currentCoords = { lat: position.coords.latitude, lng: position.coords.longitude };
        currentAccuracy = position.coords.accuracy || null;
        const locationInput = document.getElementById('location');
        const heroLocationInput = document.getElementById('heroLocation');
        if (locationInput) locationInput.value = coords;
        if (heroLocationInput) heroLocationInput.value = coords;
        updateGeofenceStatus();
        updateGeoMap();
      },
      (error) => {
        const locationInput = document.getElementById('location');
        const heroLocationInput = document.getElementById('heroLocation');
        if (locationInput) locationInput.value = 'Location access denied';
        if (heroLocationInput) heroLocationInput.value = 'Location access denied';
      }
    );
  } else {
    const locationInput = document.getElementById('location');
    const heroLocationInput = document.getElementById('heroLocation');
    if (locationInput) locationInput.value = 'Geolocation not supported';
    if (heroLocationInput) heroLocationInput.value = 'Geolocation not supported';
  }
}

function loadPendingActions() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function savePendingActions(actions) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(actions));
}

function queueOfflineAction(action) {
  const actions = loadPendingActions();
  actions.push({ id: Date.now(), ...action });
  savePendingActions(actions);
  renderPendingActions();
}

function renderPendingActions() {
  const grid = document.getElementById('pendingDataGrid');
  if (!grid) return;
  const actions = loadPendingActions();
  grid.innerHTML = '';

  if (actions.length === 0) {
    return;
  }

  actions.forEach(item => {
    const card = document.createElement('div');
    card.className = 'data-card pending';
    card.innerHTML = `
      <div class="data-card-header">
        <i class="fas fa-clock"></i>
        <span class="data-time">Pending Sync</span>
      </div>
      <div class="data-card-body">
        <p><strong>Type:</strong> ${item.type}</p>
        <p><strong>Employee:</strong> ${item.payload?.name || 'N/A'} (${item.payload?.employeeId || item.employeeId || 'N/A'})</p>
        <p><strong>Department:</strong> ${item.payload?.department || 'N/A'}</p>
      </div>
    `;
    grid.appendChild(card);
  });
}

async function syncPendingActions() {
  if (!navigator.onLine) {
    showToast('You are offline. Sync will retry automatically.', 'warning');
    return;
  }

  const actions = loadPendingActions();
  if (actions.length === 0) return;

  const remaining = [];
  for (const action of actions) {
    try {
      if (action.type === 'checkin') {
        const result = await sendCheckIn(action.payload, action.token);
        if (!result.ok) remaining.push(action);
      } else if (action.type === 'checkout') {
        const result = await sendCheckOut(action.employeeId, action.payload, action.token);
        if (!result.ok) remaining.push(action);
      }
    } catch (error) {
      remaining.push(action);
    }
  }

  savePendingActions(remaining);
  renderPendingActions();
  if (remaining.length === 0) {
    showToast('All pending actions synced!', 'success');
    loadDashboard();
    loadAttendanceHistory();
  } else {
    showToast('Some actions are still pending sync.', 'warning');
  }
}

async function sendCheckIn(payload, authToken) {
  try {
    const response = await fetch(apiUrl('/api/attendance/checkin'), {
      method: 'POST',
      headers: authToken
        ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }
        : { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!data.success) {
      return { ok: false, message: data.message || 'Check-in failed', networkError: false };
    }

    await fetch(apiUrl('/api/save-data'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'checkin',
        employeeId: payload.employeeId,
        name: payload.name,
        department: payload.department,
        location: payload.location,
        timestamp: new Date().toISOString()
      })
    });
    return { ok: true, message: 'Check-in successful', networkError: false, data };
  } catch (error) {
    return { ok: false, message: 'Network error', networkError: true };
  }
}

async function sendCheckOut(employeeId, payload, authToken) {
  try {
    const response = await fetch(apiUrl(`/api/attendance/checkout/${employeeId}`), {
      method: 'POST',
      headers: authToken
        ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }
        : { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const data = await response.json();
    if (!data.success) {
      return { ok: false, message: data.message || 'Check-out failed', networkError: false };
    }

    await fetch(apiUrl('/api/save-data'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'checkout',
        employeeId,
        timestamp: new Date().toISOString()
      })
    });
    return { ok: true, message: 'Check-out successful', networkError: false, data };
  } catch (error) {
    return { ok: false, message: 'Network error', networkError: true };
  }
}

// Handle Check In
async function handleCheckIn(e) {
  e.preventDefault();
  
  if (!token || !currentUser) {
    showToast('Please login first', 'error');
    showLoginModal();
    return;
  }

  if (!ensureInsideGeofence()) {
    return;
  }
  
  const employeeId = document.getElementById('employeeId').value || currentUser.employeeId;
  const name = document.getElementById('name').value || currentUser.username;
  const department = document.getElementById('department').value || currentUser.department;
  const notes = document.getElementById('notes').value;
  const shift = document.getElementById('shift').value;
  const location = document.getElementById('location').value;
  
  if (!employeeId || !name || !department) {
    showToast('Please fill all required fields', 'error');
    return;
  }
  
  const payload = {
    employeeId,
    name,
    department,
    notes,
    shift,
    location,
    locationLat: currentCoords?.lat,
    locationLng: currentCoords?.lng,
    locationAccuracy: currentAccuracy,
    checkInPhoto: capturedCheckInPhoto,
    livenessPassed: lastLivenessPassed,
    livenessScore: lastLivenessScore
  };

  if (!navigator.onLine) {
    queueOfflineAction({ type: 'checkin', payload, token });
    showToast('Offline: Check-in queued for sync.', 'warning');
    return;
  }

  const result = await sendCheckIn(payload, token);
  if (result.ok) {
    showToast('Check-in successful!', 'success');
    document.getElementById('attendanceForm').reset();
    resetCheckInPhoto();
    getLocation();
    loadTodayStatus();
    loadDashboard();
    socket.emit('attendance-marked', { type: 'checkin', data: payload });
  } else if (result.networkError) {
    queueOfflineAction({ type: 'checkin', payload, token });
    showToast('Network issue. Check-in queued for sync.', 'warning');
  } else {
    showToast(result.message || 'Check-in failed', 'error');
  }
}

// Handle Check In (Hero)
async function handleHeroCheckIn(e) {
  e.preventDefault();

  if (!ensureInsideGeofence()) {
    return;
  }

  const employeeId = document.getElementById('heroEmployeeId')?.value?.trim();
  const name = document.getElementById('heroName')?.value?.trim();
  const department = document.getElementById('heroDepartment')?.value;
  const notes = document.getElementById('heroNotes')?.value || '';
  const shift = document.getElementById('heroShift')?.value || 'Day';
  const location = document.getElementById('heroLocation')?.value || '';

  if (!employeeId || !name || !department) {
    showToast('Please fill all required fields', 'error');
    return;
  }

  const payload = {
    employeeId,
    name,
    department,
    notes,
    shift,
    location,
    locationLat: currentCoords?.lat,
    locationLng: currentCoords?.lng,
    locationAccuracy: currentAccuracy,
    checkInPhoto: capturedCheckInPhoto,
    livenessPassed: lastLivenessPassed,
    livenessScore: lastLivenessScore
  };

  if (!navigator.onLine) {
    queueOfflineAction({ type: 'checkin', payload, token });
    showToast('Offline: Check-in queued for sync.', 'warning');
    return;
  }

  const result = await sendCheckIn(payload, token);
  if (result.ok) {
    showToast('Check-in successful!', 'success');
    document.getElementById('heroAttendanceForm')?.reset();
    resetCheckInPhoto();
    getLocation();
    loadTodayStatus();
    loadDashboard();
    socket.emit('attendance-marked', { type: 'checkin', data: payload });
  } else if (result.networkError) {
    queueOfflineAction({ type: 'checkin', payload, token });
    showToast('Network issue. Check-in queued for sync.', 'warning');
  } else {
    showToast(result.message || 'Check-in failed', 'error');
  }
}

// Handle Check Out
async function handleCheckOut() {
  const employeeId = document.getElementById('employeeId')?.value?.trim() || currentUser?.employeeId;
  
  if (!employeeId) {
    showToast('Please enter Employee ID', 'error');
    return;
  }

  if (!ensureInsideGeofence()) {
    return;
  }
  
  const payload = {
    location: document.getElementById('location')?.value || '',
    locationLat: currentCoords?.lat,
    locationLng: currentCoords?.lng,
    locationAccuracy: currentAccuracy,
    checkOutPhoto: capturedCheckOutPhoto
  };

  if (!navigator.onLine) {
    queueOfflineAction({ type: 'checkout', employeeId, payload, token });
    showToast('Offline: Check-out queued for sync.', 'warning');
    return;
  }

  const result = await sendCheckOut(employeeId, payload, token);
  if (result.ok) {
    showToast('Check-out successful!', 'success');
    resetCheckOutPhoto();
    loadTodayStatus();
    loadDashboard();
    socket.emit('attendance-marked', { type: 'checkout', data: { employeeId } });
  } else if (result.networkError) {
    queueOfflineAction({ type: 'checkout', employeeId, payload, token });
    showToast('Network issue. Check-out queued for sync.', 'warning');
  } else {
    showToast(result.message || 'Check-out failed', 'error');
  }
}

// Handle Check Out (Hero)
async function handleHeroCheckOut() {
  const employeeId = document.getElementById('heroEmployeeId')?.value?.trim();

  if (!employeeId) {
    showToast('Please enter Employee ID', 'error');
    return;
  }

  if (!ensureInsideGeofence()) {
    return;
  }

  const payload = {
    location: document.getElementById('heroLocation')?.value || '',
    locationLat: currentCoords?.lat,
    locationLng: currentCoords?.lng,
    locationAccuracy: currentAccuracy,
    checkOutPhoto: capturedCheckOutPhoto
  };

  if (!navigator.onLine) {
    queueOfflineAction({ type: 'checkout', employeeId, payload, token });
    showToast('Offline: Check-out queued for sync.', 'warning');
    return;
  }

  const result = await sendCheckOut(employeeId, payload, token);
  if (result.ok) {
    showToast('Check-out successful!', 'success');
    resetCheckOutPhoto();
    loadTodayStatus();
    loadDashboard();
    socket.emit('attendance-marked', { type: 'checkout', data: { employeeId } });
  } else if (result.networkError) {
    queueOfflineAction({ type: 'checkout', employeeId, payload, token });
    showToast('Network issue. Check-out queued for sync.', 'warning');
  } else {
    showToast(result.message || 'Check-out failed', 'error');
  }
}

// Load Dashboard
async function loadDashboard() {
  try {
    const response = await fetch(apiUrl('/api/attendance'));
    const data = await response.json();
    
    if (data.success) {
      updateDashboardStats(data.stats);
      updateAttendanceChart(data.data);
      updateRecentActivity(data.data);
      updateInsights(data.data, data.stats);
      if (currentUser?.role === 'admin' || currentUser?.role === 'vice_admin' || currentUser?.role === 'manager') {
        triggerAbsentAlerts();
        triggerShiftAutoRules();
      }
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }
}

async function triggerAbsentAlerts() {
  if (!token) return;
  const key = `absent-alerts-${new Date().toISOString().slice(0,10)}`;
  if (localStorage.getItem(key)) return;
  try {
    const response = await fetch(apiUrl('/api/attendance/absent-alerts'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({})
    });
    const data = await response.json();
    if (data.success) {
      localStorage.setItem(key, '1');
    }
  } catch (_) {}
}

async function triggerShiftAutoRules() {
  if (!token) return;
  const key = `shift-auto-${new Date().toISOString().slice(0,10)}`;
  if (localStorage.getItem(key)) return;
  try {
    const response = await fetch(apiUrl('/api/attendance/shift-auto-rules'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({})
    });
    const data = await response.json();
    if (data.success) {
      localStorage.setItem(key, '1');
    }
  } catch (_) {}
}

async function loadAnalytics() {
  try {
    const monthInput = document.getElementById('analyticsMonth');
    if (monthInput && !monthInput.value) {
      const now = new Date();
      monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const monthValue = monthInput?.value || '';
    const params = new URLSearchParams();
    if (monthValue) {
      const [year, month] = monthValue.split('-');
      if (year && month) {
        params.append('year', year);
        params.append('month', month);
      }
    }
    const response = await fetch(apiUrl(`/api/attendance/analytics?${params.toString()}`));
    const data = await response.json();
    if (!data.success) return;

    const analytics = data.data;
    const totalEl = document.getElementById('analyticsTotalEmployees');
    const absEl = document.getElementById('analyticsAbsenteeism');
    if (totalEl) totalEl.textContent = analytics.totalEmployees || 0;
    if (absEl) absEl.textContent = `${analytics.absenteeismRate || 0}%`;

    const trendCtx = document.getElementById('monthlyTrendChart');
    if (trendCtx) {
      if (monthlyTrendChart) monthlyTrendChart.destroy();
      monthlyTrendChart = new Chart(trendCtx, {
        type: 'line',
        data: {
          labels: analytics.trends.labels,
          datasets: [{
            label: 'Daily Check-ins',
            data: analytics.trends.values,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.2)',
            fill: true,
            tension: 0.3
          }]
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } }
        }
      });
    }

    const deptCtx = document.getElementById('departmentPerfChart');
    if (deptCtx) {
      if (departmentPerfChart) departmentPerfChart.destroy();
      const labels = analytics.departmentPerformance.map(item => item.department);
      const values = analytics.departmentPerformance.map(item => item.absenteeismRate);
      departmentPerfChart = new Chart(deptCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Absenteeism %',
            data: values,
            backgroundColor: '#60a5fa'
          }]
        },
        options: {
          responsive: true,
          scales: { y: { beginAtZero: true, max: 100 } }
        }
      });
    }
    renderAttendanceHeatmap(analytics.trends.labels, analytics.trends.values);
  } catch (error) {
    console.error('Analytics error:', error);
  }
}

function renderAttendanceHeatmap(labels = [], values = []) {
  const container = document.getElementById('attendanceHeatmap');
  if (!container) return;
  container.innerHTML = '';
  const max = Math.max(...values, 0);
  labels.forEach((label, idx) => {
    const value = values[idx] || 0;
    const level = max === 0 ? 0 : Math.min(4, Math.floor((value / max) * 4));
    const cell = document.createElement('div');
    cell.className = `heatmap-cell level-${level}`;
    cell.title = `${label}: ${value}`;
    cell.textContent = label.split(' ')[0];
    container.appendChild(cell);
  });
}

// Update dashboard statistics
function updateDashboardStats(stats) {
  const totalEl = document.getElementById('totalEmployees');
  const presentEl = document.getElementById('presentToday');
  const lateEl = document.getElementById('lateToday');
  const rateEl = document.getElementById('attendanceRate');

  if (!totalEl || !presentEl || !lateEl || !rateEl) return;

  totalEl.textContent = stats.total || 0;
  presentEl.textContent = stats.present || 0;
  lateEl.textContent = stats.late || 0;
  
  const attendanceRate = stats.total > 0 ? ((stats.present / stats.total) * 100).toFixed(1) : 0;
  rateEl.textContent = `${attendanceRate}%`;
}

// Update attendance chart
function updateAttendanceChart(data) {
  const canvas = document.getElementById('attendanceChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  // Group by hour
  const hourlyData = {};
  for (let i = 8; i <= 18; i++) {
    hourlyData[`${i}:00`] = 0;
  }
  
  data.forEach(record => {
    const hour = new Date(record.checkInTime).getHours();
    if (hour >= 8 && hour <= 18) {
      hourlyData[`${hour}:00`]++;
    }
  });
  
  if (attendanceChart) {
    attendanceChart.destroy();
  }
  
  attendanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Object.keys(hourlyData),
      datasets: [{
        label: 'Check-ins by Hour',
        data: Object.values(hourlyData),
        borderColor: '#4361ee',
        backgroundColor: 'rgba(67, 97, 238, 0.1)',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1
          }
        }
      }
    }
  });
}

// Update recent activity
function updateRecentActivity(data) {
  const activityList = document.getElementById('recentActivity');
  if (!activityList) return;
  
  activityList.innerHTML = '';
  
  const recent = data.slice(0, 10); // Get last 10 records
  
  recent.forEach(record => {
    const activityItem = document.createElement('div');
    activityItem.className = 'activity-item';
    
    const isCheckout = Boolean(record.checkOutTime);
    const time = new Date(isCheckout ? record.checkOutTime : record.checkInTime).toLocaleTimeString();
    
    activityItem.innerHTML = `
      <div class="activity-icon">
        <i class="fas ${isCheckout ? 'fa-sign-out-alt' : 'fa-user-check'}"></i>
      </div>
      <div class="activity-details">
        <h4>${record.name} ${isCheckout ? 'checked out' : 'checked in'}</h4>
        <p class="activity-time">${time}</p>
      </div>
      <span class="status-badge status-${record.status.toLowerCase()}">${record.status}</span>
    `;
    
    activityList.appendChild(activityItem);
  });
}

function updateInsights(data, stats) {
  const insights = document.getElementById('insightsList');
  if (!insights) return;

  const total = stats?.total || data.length;
  const present = stats?.present || 0;
  const late = stats?.late || 0;
  const lateRate = total > 0 ? ((late / total) * 100).toFixed(1) : 0;

  const byDept = {};
  data.forEach(record => {
    const dept = record.department || 'Unknown';
    byDept[dept] = (byDept[dept] || 0) + 1;
  });

  const topDept = Object.keys(byDept).sort((a, b) => byDept[b] - byDept[a])[0];

  insights.innerHTML = `
    <div class="insight-item">Present today: <strong>${present}</strong> of <strong>${total}</strong></div>
    <div class="insight-item">Late arrivals rate: <strong>${lateRate}%</strong></div>
    <div class="insight-item">Most active department: <strong>${topDept || 'N/A'}</strong></div>
  `;
}

// Load today's status
async function loadTodayStatus() {
  const employeeId = document.getElementById('employeeId').value || currentUser?.employeeId;
  if (!employeeId) return;
  
  try {
    const response = await fetch(apiUrl(`/api/attendance?employeeId=${employeeId}`));
    const data = await response.json();
    
    const statusDiv = document.getElementById('todayStatus');
    if (!statusDiv) return;
    
    const today = data.data.find(record => {
      const recordDate = new Date(record.checkInTime).toDateString();
      const todayDate = new Date().toDateString();
      return recordDate === todayDate;
    });
    
    if (today) {
      statusDiv.innerHTML = `
        <div class="status-card">
          <p><strong>Status:</strong> <span class="status-badge status-${today.status.toLowerCase()}">${today.status}</span></p>
          <p><strong>Check In:</strong> ${new Date(today.checkInTime).toLocaleTimeString()}</p>
          ${today.checkOutTime ? `<p><strong>Check Out:</strong> ${new Date(today.checkOutTime).toLocaleTimeString()}</p>` : ''}
          ${today.overtime ? `<p><strong>Overtime:</strong> ${today.overtime} hours</p>` : ''}
        </div>
      `;
    } else {
      statusDiv.innerHTML = '<p>No attendance marked for today</p>';
    }
  } catch (error) {
    console.error('Error loading status:', error);
  }
}

// Load attendance history with filters
async function loadAttendanceHistory() {
  try {
    const date = document.getElementById('filterDate').value;
    const department = document.getElementById('filterDepartment').value;
    const status = document.getElementById('filterStatus').value;
    
    let url = '/api/attendance';
    const params = new URLSearchParams();
    if (date) params.append('date', date);
    if (department) params.append('department', department);
    if (status) params.append('status', status);
    
    if (params.toString()) {
      url += '?' + params.toString();
    }
    
    const response = await fetch(apiUrl(url));
    const data = await response.json();
    lastAttendanceRecords = Array.isArray(data.data) ? data.data : [];
    updateAttendanceTable(lastAttendanceRecords);
    localStorage.setItem(ATTENDANCE_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      records: lastAttendanceRecords
    }));
  } catch (error) {
    console.error('Error loading history:', error);
    if (!navigator.onLine) {
      const cached = localStorage.getItem(ATTENDANCE_CACHE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed.records)) {
            updateAttendanceTable(parsed.records);
            showToast('Offline: showing cached attendance history.', 'warning');
          }
        } catch (_) {}
      }
    }
  }
}

async function loadAlerts() {
  if (!token) return;
  try {
    const response = await fetch(apiUrl('/api/alerts'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!data.success) return;
    const list = document.getElementById('alertsList');
    if (!list) return;
    list.innerHTML = '';
    data.data.forEach(alert => {
      const row = document.createElement('tr');
      const when = alert.createdAt ? new Date(alert.createdAt).toLocaleString() : '';
      row.innerHTML = `
        <td>${alert.type || 'system'}</td>
        <td>${alert.level || 'info'}</td>
        <td>${alert.message || alert.title || '-'}</td>
        <td>${when}</td>
        <td>
          ${alert.readAt ? '<span class="muted-text">Read</span>' : `<button class="btn-secondary" onclick="markAlertRead('${alert._id}')">Mark Read</button>`}
        </td>
      `;
      list.appendChild(row);
    });
  } catch (error) {
    console.error('Alerts error:', error);
  }
}

async function markAlertRead(id) {
  if (!token || !id) return;
  try {
    const response = await fetch(apiUrl(`/api/alerts/${id}/read`), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.success) {
      loadAlerts();
    }
  } catch (_) {}
}

async function markAllAlertsRead() {
  if (!token) return;
  try {
    const response = await fetch(apiUrl('/api/alerts/read-all'), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.success) {
      loadAlerts();
    }
  } catch (_) {}
}

async function loadGeofenceViolations() {
  if (!token) return;
  try {
    const response = await fetch(apiUrl('/api/attendance/geofence-violations'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!data.success) return;
    const list = document.getElementById('geoViolationList');
    if (!list) return;
    list.innerHTML = '';
    data.data.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.name || ''} (${item.employeeId})</td>
        <td>${item.location || 'N/A'}</td>
        <td>${item.locationAccuracy ? `${Math.round(item.locationAccuracy)}m` : '-'}</td>
        <td>${item.reason || '-'}</td>
        <td>${item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</td>
      `;
      list.appendChild(row);
    });
  } catch (error) {
    console.error('Geo violation error:', error);
  }
}

async function loadAuditLogs() {
  if (!token) return;
  try {
    const response = await fetch(apiUrl('/api/audit'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!data.success) return;
    const list = document.getElementById('auditLogList');
    if (!list) return;
    list.innerHTML = '';
    data.data.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.actorName || 'System'}</td>
        <td>${item.action}</td>
        <td>${item.entityType}</td>
        <td>${item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</td>
      `;
      list.appendChild(row);
    });
  } catch (error) {
    console.error('Audit log error:', error);
  }
}

async function loadEditRequests() {
  if (!token) return;
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'vice_admin') return;
  try {
    const response = await fetch(apiUrl('/api/attendance/edit-requests'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!data.success) return;
    const list = document.getElementById('editRequestList');
    if (!list) return;
    list.innerHTML = '';
    data.data.forEach(reqItem => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${reqItem.requestedByName || '-'}</td>
        <td>${reqItem.attendanceId}</td>
        <td><pre class="small-pre">${JSON.stringify(reqItem.changes || {}, null, 2)}</pre></td>
        <td>${reqItem.createdAt ? new Date(reqItem.createdAt).toLocaleString() : ''}</td>
        <td>
          <button class="btn-primary" onclick="approveEditRequest('${reqItem._id}')">Approve</button>
          <button class="btn-secondary" onclick="rejectEditRequest('${reqItem._id}')">Reject</button>
        </td>
      `;
      list.appendChild(row);
    });
  } catch (error) {
    console.error('Edit requests error:', error);
  }
}

async function loadAnomalies() {
  if (!token) return;
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'vice_admin' && currentUser?.role !== 'manager') return;
  try {
    const response = await fetch(apiUrl('/api/attendance/anomalies'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!data.success) return;
    const list = document.getElementById('anomalyList');
    if (!list) return;
    list.innerHTML = '';
    data.data.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.type}</td>
        <td>${item.employeeId || '-'}</td>
        <td>${item.message || '-'}</td>
      `;
      list.appendChild(row);
    });
  } catch (error) {
    console.error('Anomaly error:', error);
  }
}

async function approveEditRequest(id) {
  if (!token) return;
  try {
    const response = await fetch(apiUrl(`/api/attendance/edit-requests/${id}/approve`), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.success) {
      showToast('Edit request approved', 'success');
      loadEditRequests();
      loadAttendanceHistory();
    } else {
      showToast(data.message || 'Approval failed', 'error');
    }
  } catch (error) {
    showToast('Approval failed', 'error');
  }
}

async function rejectEditRequest(id) {
  if (!token) return;
  try {
    const response = await fetch(apiUrl(`/api/attendance/edit-requests/${id}/reject`), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.success) {
      showToast('Edit request rejected', 'success');
      loadEditRequests();
    } else {
      showToast(data.message || 'Reject failed', 'error');
    }
  } catch (error) {
    showToast('Reject failed', 'error');
  }
}

// Update attendance table
function updateAttendanceTable(records) {
  const tbody = document.getElementById('attendanceList');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  records.forEach(record => {
    const row = document.createElement('tr');
    
    const gradeClass = String(record.grade || 'na').toLowerCase().replace('+', '-plus');
    row.innerHTML = `
      <td>${record.employeeId || 'N/A'}</td>
      <td>${record.name}</td>
      <td>${record.department || 'N/A'}</td>
      <td>${record.shift || 'Day'}</td>
      <td>${new Date(record.checkInTime).toLocaleString()}</td>
      <td>${record.checkOutTime ? new Date(record.checkOutTime).toLocaleString() : 'Not checked out'}</td>
      <td><span class="status-badge status-${record.status.toLowerCase()}">${record.status}</span></td>
      <td>${record.locationLat ? `GPS (${Number(record.locationAccuracy || 0).toFixed(0)}m)` : 'N/A'}</td>
      <td>
        ${currentUser?.role === 'admin' || currentUser?.role === 'vice_admin'
          ? `<button onclick="openEditAttendance('${record._id}')" class="btn-edit"><i class="fas fa-edit"></i></button>
             <button onclick="deleteRecord('${record._id}')" class="btn-delete"><i class="fas fa-trash"></i></button>`
          : `<span class="muted-text">Admin only</span>`}
      </td>
    `;
    
    tbody.appendChild(row);
  });
}

async function loadPayrollSummary() {
  if (!token) return;
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'vice_admin') return;
  const monthInput = document.getElementById('payrollMonth');
  if (monthInput && !monthInput.value) {
    const now = new Date();
    monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const monthValue = monthInput?.value || '';
  const params = new URLSearchParams();
  if (monthValue) {
    const [year, month] = monthValue.split('-');
    if (year && month) {
      params.append('year', year);
      params.append('month', month);
    }
  }
  try {
    const response = await fetch(apiUrl(`/api/marks/summary?${params.toString()}`), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!data.success) {
      showToast(data.message || 'Summary failed', 'error');
      return;
    }
    const list = document.getElementById('payrollSummaryList');
    if (!list) return;
    list.innerHTML = '';
    data.data.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.name} (${item.employeeId})</td>
        <td>${item.present}</td>
        <td>${item.late}</td>
        <td>${item.halfDay}</td>
        <td>${item.overtime}</td>
        <td>${item.grossPay}</td>
        <td>${item.advancePaid}</td>
        <td>${item.netPay}</td>
      `;
      list.appendChild(row);
    });
  } catch (error) {
    showToast('Summary failed', 'error');
  }
}

function exportPayrollJson() {
  const list = document.getElementById('payrollSummaryList');
  if (!list) return;
  const rows = [];
  list.querySelectorAll('tr').forEach(row => {
    const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
    rows.push(cells);
  });
  if (!rows.length) {
    showToast('No payroll data to export', 'warning');
    return;
  }
  const json = rows.map(item => ({
    employee: item[0],
    present: item[1],
    late: item[2],
    halfDay: item[3],
    overtime: item[4],
    grossPay: item[5],
    advancePaid: item[6],
    netPay: item[7]
  }));
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `payroll_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportPayrollTally() {
  const list = document.getElementById('payrollSummaryList');
  if (!list) return;
  const rows = [];
  list.querySelectorAll('tr').forEach(row => {
    const cells = Array.from(row.querySelectorAll('td')).map(td => td.textContent.trim());
    rows.push(cells);
  });
  if (!rows.length) {
    showToast('No payroll data to export', 'warning');
    return;
  }
  const headers = ['Employee', 'Gross', 'Advance', 'Net'];
  const csvRows = rows.map(item => [item[0], item[5], item[6], item[7]]);
  const csv = [headers, ...csvRows]
    .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tally_payroll_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Generate report
async function generateReport() {
  const startDate = document.getElementById('reportStartDate').value;
  const endDate = document.getElementById('reportEndDate').value;
  
  if (!startDate || !endDate) {
    showToast('Please select date range', 'error');
    return;
  }
  
  try {
    const response = await fetch(apiUrl(`/api/attendance/report?startDate=${startDate}&endDate=${endDate}`));
    const data = await response.json();
    
    displayReport(data.data);
  } catch (error) {
    console.error('Error generating report:', error);
  }
}

async function generateAutoReport() {
  if (!token) {
    showToast('Please login first', 'warning');
    return;
  }
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'vice_admin' && currentUser?.role !== 'manager') {
    showToast('Admin/Manager only', 'warning');
    return;
  }
  const type = document.getElementById('autoReportType')?.value || 'weekly';
  try {
    const response = await fetch(apiUrl('/api/attendance/auto-report'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ type })
    });
    const data = await response.json();
    if (data.success) {
      showToast('Auto report generated', 'success');
      loadAutoReports();
    } else {
      showToast(data.message || 'Auto report failed', 'error');
    }
  } catch (error) {
    showToast('Auto report failed', 'error');
  }
}

async function loadAutoReports() {
  if (!token) return;
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'vice_admin' && currentUser.role !== 'manager')) {
    return;
  }
  try {
    const response = await fetch(apiUrl('/api/attendance/auto-report'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!data.success) return;
    const list = document.getElementById('autoReportList');
    if (!list) return;
    list.innerHTML = '';
    data.data.forEach(item => {
      const row = document.createElement('tr');
      const period = `${new Date(item.periodStart).toLocaleDateString()} - ${new Date(item.periodEnd).toLocaleDateString()}`;
      row.innerHTML = `
        <td>${item.type}</td>
        <td>${period}</td>
        <td>${item.generatedBy || '-'}</td>
        <td>${item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</td>
      `;
      list.appendChild(row);
    });
  } catch (error) {
    console.error('Auto report error:', error);
  }
}

// Display report
function displayReport(reportData) {
  const reportDiv = document.getElementById('reportContent');
  if (!reportDiv) return;
  
  let html = '<div class="report-container">';
  
  reportData.forEach(day => {
    html += `
      <div class="report-day">
        <h3>${day.date}</h3>
        <div class="report-stats">
          <div>Total: ${day.total}</div>
          <div>Present: ${day.present}</div>
          <div>Late: ${day.late}</div>
          <div>Absent: ${day.absent}</div>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  reportDiv.innerHTML = html;
}

// Export to Excel
function exportToExcel() {
  if (!lastAttendanceRecords || lastAttendanceRecords.length === 0) {
    showToast('No data to export.', 'warning');
    return;
  }

  const headers = ['Employee ID', 'Name', 'Department', 'Shift', 'Check In', 'Check Out', 'Status'];
  const rows = lastAttendanceRecords.map(record => ([
    record.employeeId || 'N/A',
    record.name || 'N/A',
    record.department || 'N/A',
    record.shift || 'Day',
    record.checkInTime ? new Date(record.checkInTime).toLocaleString() : '',
    record.checkOutTime ? new Date(record.checkOutTime).toLocaleString() : '',
    record.status || 'N/A'
  ]));

  const csv = [headers, ...rows]
    .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `attendance_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportToExcelFile() {
  if (!lastAttendanceRecords || lastAttendanceRecords.length === 0) {
    showToast('No data to export.', 'warning');
    return;
  }
  const headers = ['Employee ID', 'Name', 'Department', 'Shift', 'Check In', 'Check Out', 'Status'];
  const rows = lastAttendanceRecords.map(record => ([
    record.employeeId || 'N/A',
    record.name || '',
    record.department || '',
    record.shift || 'Day',
    record.checkInTime ? new Date(record.checkInTime).toLocaleString() : '',
    record.checkOutTime ? new Date(record.checkOutTime).toLocaleString() : '',
    record.status || 'N/A'
  ]));
  const table = [
    '<table>',
    `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`,
    ...rows.map(r => `<tr>${r.map(v => `<td>${String(v)}</td>`).join('')}</tr>`),
    '</table>'
  ].join('');
  const blob = new Blob([table], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `attendance_${new Date().toISOString().slice(0,10)}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportHistoryJson() {
  if (!lastAttendanceRecords || lastAttendanceRecords.length === 0) {
    showToast('No data to export.', 'warning');
    return;
  }
  const blob = new Blob([JSON.stringify(lastAttendanceRecords, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `attendance_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportCustomReport() {
  if (!lastAttendanceRecords || lastAttendanceRecords.length === 0) {
    showToast('Load attendance history first.', 'warning');
    return;
  }
  const fields = Array.from(document.querySelectorAll('.report-field:checked')).map(el => el.value);
  if (!fields.length) {
    showToast('Select at least one field', 'warning');
    return;
  }
  const headers = fields.map(f => f.replace(/([A-Z])/g, ' $1'));
  const rows = lastAttendanceRecords.map(record => fields.map(f => {
    const val = record[f];
    if (f === 'checkInTime' || f === 'checkOutTime') {
      return val ? new Date(val).toLocaleString() : '';
    }
    return val ?? '';
  }));
  const csv = [headers, ...rows]
    .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `custom_report_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Export to PDF
function exportToPDF() {
  const reportContent = document.getElementById('reportContent');
  if (!reportContent || reportContent.innerHTML.trim() === '') {
    showToast('Please generate a report first.', 'warning');
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    showToast('Popup blocked. Please allow popups for PDF export.', 'warning');
    return;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>Attendance Report</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          .report-container { display: grid; gap: 16px; }
          .report-day { border: 1px solid #ddd; padding: 12px; border-radius: 8px; }
          .report-stats { display: flex; gap: 16px; flex-wrap: wrap; }
        </style>
      </head>
      <body>
        <h2>Attendance Report</h2>
        ${reportContent.innerHTML}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

// Load employees
async function loadEmployees() {
  try {
    const response = await fetch(apiUrl('/api/attendance'));
    const data = await response.json();
    
    // Get unique employees
    const employees = [];
    const seen = new Set();
    
    data.data.forEach(record => {
      if (!seen.has(record.employeeId)) {
        seen.add(record.employeeId);
        employees.push(record);
      }
    });
    
    cachedEmployees = employees;
    displayEmployees(employees);
    if (document.getElementById('presentEmployeesList')) {
      loadPresentEmployees();
    }
  } catch (error) {
    console.error('Error loading employees:', error);
  }
}

// Display employees grid
function displayEmployees(employees) {
  const grid = document.getElementById('employeesGrid');
  if (!grid) return;
  
  grid.innerHTML = '';
  
  employees.forEach(emp => {
    const card = document.createElement('div');
    card.className = 'employee-card';
    
    card.innerHTML = `
      <div class="employee-card-header">
        <div class="employee-avatar">
          <i class="fas fa-user"></i>
        </div>
        <div class="employee-info">
          <h3>${emp.name}</h3>
          <p>ID: ${emp.employeeId}</p>
        </div>
      </div>
      <div class="employee-card-footer">
        <span>${emp.department || 'N/A'}</span>
        <span class="status-badge status-present">Active</span>
      </div>
    `;
    
    grid.appendChild(card);
  });
}

function filterEmployees() {
  const input = document.getElementById('employeeSearch');
  if (!input) return;
  const query = input.value.toLowerCase();
  const filtered = cachedEmployees.filter(emp =>
    (emp.name || '').toLowerCase().includes(query) ||
    (emp.employeeId || '').toLowerCase().includes(query) ||
    (emp.department || '').toLowerCase().includes(query)
  );
  displayEmployees(filtered);
}

// Load present employees (today, not checked out)
async function loadPresentEmployees() {
  try {
    const response = await fetch(apiUrl('/api/attendance'));
    const data = await response.json();
    const records = Array.isArray(data.data) ? data.data : [];
    const present = records.filter(item =>
      !item.checkOutTime &&
      ['Present', 'Late', 'Half-Day'].includes(item.status)
    );
    updatePresentEmployeesTable(present);
  } catch (error) {
    console.error('Error loading present employees:', error);
  }
}

function updatePresentEmployeesTable(records) {
  const tbody = document.getElementById('presentEmployeesList');
  if (!tbody) return;

  tbody.innerHTML = '';
  const roleMap = new Map();
  cachedEmployees.forEach(emp => {
    if (emp.employeeId) roleMap.set(emp.employeeId, emp.role || 'N/A');
  });

  records.forEach(record => {
    const row = document.createElement('tr');
    const role = roleMap.get(record.employeeId) || 'N/A';
    row.innerHTML = `
      <td>${record.employeeId || 'N/A'}</td>
      <td>${record.name || 'N/A'}</td>
      <td>${record.department || 'N/A'}</td>
      <td>
        <select class="present-shift" data-id="${record._id}">
          <option value="Day" ${record.shift === 'Day' ? 'selected' : ''}>Day</option>
          <option value="Night" ${record.shift === 'Night' ? 'selected' : ''}>Night</option>
          <option value="Extra Work" ${record.shift === 'Extra Work' ? 'selected' : ''}>Extra Work</option>
        </select>
      </td>
      <td>${record.checkInTime ? new Date(record.checkInTime).toLocaleString() : 'N/A'}</td>
      <td>${role}</td>
      <td>
        <button class="btn-secondary" onclick="presentCheckout('${record.employeeId}')">
          Checkout
        </button>
        <button class="btn-primary" onclick="presentSaveShift('${record._id}')">
          Save Shift
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function presentCheckout(employeeId) {
  if (!employeeId) return;
  const payload = {
    location: document.getElementById('location')?.value || '',
    locationLat: currentCoords?.lat,
    locationLng: currentCoords?.lng,
    locationAccuracy: currentAccuracy,
    checkOutPhoto: capturedCheckOutPhoto
  };
  const result = await sendCheckOut(employeeId, payload, token);
  if (result.ok) {
    showToast('Check-out successful!', 'success');
    loadPresentEmployees();
    loadAttendanceHistory();
    loadDashboard();
  } else {
    showToast(result.message || 'Check-out failed', 'error');
  }
}

async function presentSaveShift(recordId) {
  if (!token || !currentUser) {
    showToast('Please login first', 'warning');
    return;
  }
  if (currentUser.role !== 'admin' && currentUser.role !== 'vice_admin') {
    showToast('Admin only: shift update restricted.', 'warning');
    return;
  }
  const select = document.querySelector(`.present-shift[data-id="${recordId}"]`);
  if (!select) return;
  const shift = select.value;
  try {
    const response = await fetch(apiUrl(`/api/attendance/${recordId}`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ shift })
    });
    const data = await response.json();
    if (data.success) {
      showToast('Shift updated', 'success');
      loadPresentEmployees();
      loadAttendanceHistory();
    } else {
      showToast(data.message || 'Shift update failed', 'error');
    }
  } catch (error) {
    showToast('Shift update failed', 'error');
  }
}

// Save settings
function saveSettings() {
  const settings = {
    lateThreshold: document.getElementById('lateThreshold').value,
    workStart: document.getElementById('workStart').value,
    workEnd: document.getElementById('workEnd').value,
    emailNotifications: document.getElementById('emailNotifications').checked,
    smsNotifications: document.getElementById('smsNotifications').checked,
    whatsappNotifications: document.getElementById('whatsappNotifications').checked
  };
  
  localStorage.setItem('attendanceSettings', JSON.stringify(settings));
  if (token) {
    fetch(apiUrl('/api/auth/notifications'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        notifyEmail: settings.emailNotifications,
        notifySms: settings.smsNotifications,
        notifyWhatsapp: settings.whatsappNotifications
      })
    }).catch(() => {});
  }
  showToast('Settings saved successfully!', 'success');
}

async function uploadDocument() {
  if (!token) {
    showToast('Please login first', 'warning');
    return;
  }
  const input = document.getElementById('documentUpload');
  if (!input || !input.files?.length) {
    showToast('Please select a document', 'warning');
    return;
  }
  const formData = new FormData();
  formData.append('document', input.files[0]);
  try {
    const response = await fetch(apiUrl('/api/upload/document'), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await response.json();
    if (data.success) {
      showToast('Document uploaded', 'success');
      input.value = '';
      loadDocuments();
    } else {
      showToast(data.message || 'Upload failed', 'error');
    }
  } catch (error) {
    showToast('Upload failed', 'error');
  }
}

async function loadDocuments() {
  if (!token) return;
  try {
    const response = await fetch(apiUrl('/api/documents'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!data.success) return;
    const list = document.getElementById('documentList');
    if (!list) return;
    list.innerHTML = '';
    data.data.forEach(doc => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><a href="${doc.filename}" target="_blank" rel="noopener">${doc.originalName || 'Document'}</a></td>
        <td>${doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleString() : ''}</td>
      `;
      list.appendChild(row);
    });
  } catch (error) {
    console.error('Documents error:', error);
  }
}

// Load saved data
async function loadSavedData() {
  try {
    const response = await fetch(apiUrl('/api/get-data'));
    const data = await response.json();
    
    if (data.success) {
      displaySavedData(data.data);
    }
  } catch (error) {
    console.error('Error loading saved data:', error);
  }
}

// Display saved data
function displaySavedData(data) {
  const grid = document.getElementById('savedDataGrid');
  if (!grid) return;
  
  grid.innerHTML = '';
  
  if (data.length === 0) {
    grid.innerHTML = '<p class="no-data">No saved data found</p>';
    renderPendingActions();
    return;
  }
  
  data.reverse().forEach(item => {
    const card = document.createElement('div');
    card.className = 'data-card';
    
    card.innerHTML = `
      <div class="data-card-header">
        <i class="fas fa-${item.type === 'checkin' ? 'sign-in-alt' : 'sign-out-alt'}"></i>
        <span class="data-time">${new Date(item.timestamp).toLocaleString()}</span>
      </div>
      <div class="data-card-body">
        <p><strong>Type:</strong> ${item.type}</p>
        <p><strong>Employee:</strong> ${item.name || 'N/A'} (${item.employeeId || 'N/A'})</p>
        <p><strong>Department:</strong> ${item.department || 'N/A'}</p>
        ${item.location ? `<p><strong>Location:</strong> ${item.location}</p>` : ''}
        ${item.notes ? `<p><strong>Notes:</strong> ${item.notes}</p>` : ''}
      </div>
    `;
    
    grid.appendChild(card);
  });
  renderPendingActions();
}

// Clear saved data
async function clearSavedData() {
  if (confirm('Are you sure you want to clear all saved data?')) {
    try {
      await fetch(apiUrl('/api/save-data'), {
        method: 'DELETE'
      });
      loadSavedData();
      showToast('Data cleared successfully', 'success');
    } catch (error) {
      showToast('Error clearing data', 'error');
    }
  }
}

// Upload profile picture
async function uploadProfilePicture() {
  const file = document.getElementById('profileUpload').files[0];
  if (!file) return;
  
  const formData = new FormData();
  formData.append('profile', file);
  
  try {
    const response = await fetch(apiUrl('/api/upload/profile'), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    
    const data = await response.json();
    
    if (data.success) {
      document.getElementById('profilePreview').src = data.profileUrl;
      document.getElementById('sidebarProfilePic').src = data.profileUrl;
      document.getElementById('headerProfilePic').src = data.profileUrl;
      const navUserPic = document.getElementById('navUserPic');
      if (navUserPic) navUserPic.src = data.profileUrl;
      showToast('Profile picture updated!', 'success');
    }
  } catch (error) {
    showToast('Error uploading picture', 'error');
  }
}

// Show Add Employee Modal
function showAddEmployeeModal() {
  document.getElementById('addEmployeeModal').style.display = 'block';
}

// Add Employee
async function addEmployee(event) {
  event.preventDefault();
  
  const employeeData = {
    name: document.getElementById('empName').value,
    email: document.getElementById('empEmail').value,
    department: document.getElementById('empDepartment').value,
    role: document.getElementById('empRole').value
  };
  
  try {
    const response = await fetch(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(employeeData)
    });
    
    const data = await response.json();
    
    if (data.success) {
      closeModal('addEmployeeModal');
      showToast('Employee added successfully', 'success');
      loadEmployees();
    } else {
      showToast(data.message || 'Error adding employee', 'error');
    }
  } catch (error) {
    showToast('Network error', 'error');
  }
}

// Show toast notification
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function handleContactSubmit(event) {
  event.preventDefault();
  showToast('Thanks! Your message has been received.', 'success');
  const form = event.target;
  if (form) form.reset();
}

// Edit record
function toLocalInputValue(dateValue) {
  if (!dateValue) return '';
  const date = new Date(dateValue);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function openEditAttendance(id) {
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'vice_admin' && currentUser?.role !== 'manager') {
    showToast('Admin only: attendance editing is restricted.', 'warning');
    return;
  }
  const record = lastAttendanceRecords.find(item => item._id === id);
  if (!record) {
    showToast('Attendance record not found', 'error');
    return;
  }

  document.getElementById('editAttendanceId').value = record._id;
  document.getElementById('editStatus').value = record.status || 'Present';
  document.getElementById('editCheckIn').value = toLocalInputValue(record.checkInTime);
  document.getElementById('editCheckOut').value = toLocalInputValue(record.checkOutTime);
  document.getElementById('editNotes').value = record.notes || '';
  document.getElementById('editLocation').value = record.location || '';
  const shiftEl = document.getElementById('editShift');
  if (shiftEl) shiftEl.value = record.shift || 'Day';
  document.getElementById('editAttendanceModal').style.display = 'block';
}

async function saveAttendanceEdit(event) {
  event.preventDefault();
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'vice_admin' && currentUser?.role !== 'manager') {
    showToast('Admin only: attendance editing is restricted.', 'warning');
    return;
  }
  const id = document.getElementById('editAttendanceId').value;
  const status = document.getElementById('editStatus').value;
  const checkInTime = document.getElementById('editCheckIn').value;
  const checkOutTime = document.getElementById('editCheckOut').value;
  const notes = document.getElementById('editNotes').value;
  const location = document.getElementById('editLocation').value;
  const shift = document.getElementById('editShift')?.value;

  try {
    const changes = {
      status,
      checkInTime: checkInTime ? new Date(checkInTime) : null,
      checkOutTime: checkOutTime ? new Date(checkOutTime) : null,
      notes,
      location,
      shift
    };
    const isManager = currentUser?.role === 'manager';
    const response = await fetch(apiUrl(isManager ? `/api/attendance/${id}/edit-request` : `/api/attendance/${id}`), {
      method: isManager ? 'POST' : 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(isManager ? { changes, reason: 'Manager edit request' } : changes)
    });

    const data = await response.json();
    if (data.success) {
      showToast(isManager ? 'Edit request submitted' : 'Attendance updated successfully', 'success');
      closeModal('editAttendanceModal');
      loadAttendanceHistory();
      loadDashboard();
    } else {
      showToast(data.message || 'Error updating record', 'error');
    }
  } catch (error) {
    showToast('Error updating record', 'error');
  }
}

// Delete record
async function deleteRecord(id) {
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'vice_admin') {
    showToast('Admin only: delete is restricted.', 'warning');
    return;
  }
  if (!confirm('Are you sure you want to delete this record?')) return;
  
  try {
    const response = await fetch(apiUrl(`/api/attendance/${id}`), {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Record deleted successfully', 'success');
      loadAttendanceHistory();
    }
  } catch (error) {
    showToast('Error deleting record', 'error');
  }
}

function openMarksModal(record = null) {
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'vice_admin') {
    showToast('Admin only: payroll editing is restricted.', 'warning');
    return;
  }
  const modal = document.getElementById('marksModal');
  const idField = document.getElementById('marksRecordId');
  const employeeIdField = document.getElementById('marksEmployeeId');

  idField.value = record?._id || '';
  employeeIdField.value = record?.employeeId || '';
  employeeIdField.disabled = Boolean(record?._id);
  document.getElementById('marksEmployeeName').value = record?.name || '';
  document.getElementById('marksDepartment').value = record?.department || 'IT';
  const shiftField = document.getElementById('marksShift');
  if (shiftField) shiftField.value = record?.shift || 'Day';
  document.getElementById('marksSalary').value = record?.salary ?? 0;
  document.getElementById('marksHalfDay').value = record?.halfDay ?? 0;
  document.getElementById('marksAdvancePaid').value = record?.advancePaid ?? 0;

  if (modal) modal.style.display = 'block';
}

function openMarksModalById(id) {
  const record = cachedMarks.find(item => item._id === id);
  openMarksModal(record || null);
}

async function saveMarks(event) {
  event.preventDefault();
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'vice_admin') {
    showToast('Admin only: payroll editing is restricted.', 'warning');
    return;
  }
  const id = document.getElementById('marksRecordId').value;

  const payload = {
    employeeId: document.getElementById('marksEmployeeId').value.trim(),
    name: document.getElementById('marksEmployeeName').value.trim(),
    department: document.getElementById('marksDepartment').value,
    shift: document.getElementById('marksShift')?.value || 'Day',
    salary: Number(document.getElementById('marksSalary').value || 0),
    halfDay: Number(document.getElementById('marksHalfDay').value || 0),
    advancePaid: Number(document.getElementById('marksAdvancePaid').value || 0)
  };

  try {
    const response = await fetch(apiUrl(id ? `/api/marks/${id}` : '/api/marks'), {
      method: id ? 'PUT' : 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (data.success) {
      closeModal('marksModal');
      showToast('Payroll record saved successfully', 'success');
      loadMarks();
    } else {
      showToast(data.message || 'Error saving record', 'error');
    }
  } catch (error) {
    showToast('Error saving record', 'error');
  }
}

async function loadMarks() {
  const search = document.getElementById('marksSearch')?.value || '';
  const department = document.getElementById('marksDepartmentFilter')?.value || '';

  try {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (department) params.append('department', department);

    const response = await fetch(apiUrl(`/api/marks${params.toString() ? `?${params}` : ''}`));
    const data = await response.json();
    cachedMarks = Array.isArray(data.data) ? data.data : [];
    updateMarksTable(cachedMarks);
    updateMarksSummary(cachedMarks);
  } catch (error) {
    console.error('Error loading marks:', error);
  }
}

function updateMarksSummary(records) {
  const totalEl = document.getElementById('totalPayrollEmployees');
  const salaryEl = document.getElementById('totalPayrollSalary');
  const advanceEl = document.getElementById('totalPayrollAdvance');
  if (!totalEl || !salaryEl || !advanceEl) return;

  const total = records.length;
  const totalSalary = records.reduce((sum, item) => sum + (Number(item.salary) || 0), 0);
  const totalAdvance = records.reduce((sum, item) => sum + (Number(item.advancePaid) || 0), 0);

  totalEl.textContent = total;
  salaryEl.textContent = totalSalary.toFixed(0);
  advanceEl.textContent = totalAdvance.toFixed(0);
}

function updateMarksTable(records) {
  const tbody = document.getElementById('marksList');
  if (!tbody) return;

  tbody.innerHTML = '';

  records.forEach(record => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${record.employeeId || 'N/A'}</td>
      <td>${record.name || 'N/A'}</td>
      <td>${record.department || 'N/A'}</td>
      <td>${record.shift || 'Day'}</td>
      <td>${record.salary ?? 0}</td>
      <td>${record.halfDay ?? 0}</td>
      <td>${record.advancePaid ?? 0}</td>
      <td>
        ${currentUser?.role === 'admin' || currentUser?.role === 'vice_admin'
          ? `<button class="btn-edit" onclick="openMarksModalById('${record._id}')"><i class="fas fa-edit"></i></button>
             <button class="btn-delete" onclick="deleteMarks('${record._id}')"><i class="fas fa-trash"></i></button>`
          : `<span class="muted-text">Admin only</span>`}
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function deleteMarks(id) {
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'vice_admin') {
    showToast('Admin only: delete is restricted.', 'warning');
    return;
  }
  if (!confirm('Delete this payroll record?')) return;
  try {
    const response = await fetch(apiUrl(`/api/marks/${id}`), { 
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.success) {
      showToast('Payroll record deleted', 'success');
      loadMarks();
    } else {
      showToast(data.message || 'Error deleting record', 'error');
    }
  } catch (error) {
    showToast('Error deleting record', 'error');
  }
}

function formatDateShort(dateValue) {
  if (!dateValue) return 'N/A';
  const d = new Date(dateValue);
  return d.toLocaleDateString();
}

async function loadLeaveBalance() {
  if (!token) return;
  try {
    const response = await fetch(apiUrl('/api/leave/balance'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!data.success) return;
    const balance = data.data;
    const totalEl = document.getElementById('leaveTotal');
    const usedEl = document.getElementById('leaveUsed');
    const remainingEl = document.getElementById('leaveRemaining');
    if (totalEl) totalEl.textContent = balance.total ?? 0;
    if (usedEl) usedEl.textContent = balance.used ?? 0;
    if (remainingEl) remainingEl.textContent = balance.remaining ?? 0;
  } catch (error) {
    console.error('Leave balance error:', error);
  }
}

async function applyLeave(event) {
  event.preventDefault();
  if (!token) {
    showToast('Please login first', 'warning');
    return;
  }

  const payload = {
    startDate: document.getElementById('leaveStartDate')?.value,
    endDate: document.getElementById('leaveEndDate')?.value,
    type: document.getElementById('leaveType')?.value,
    reason: document.getElementById('leaveReason')?.value?.trim()
  };

  try {
    const response = await fetch(apiUrl('/api/leave/apply'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.success) {
      showToast('Leave request submitted', 'success');
      document.getElementById('leaveApplyForm')?.reset();
      loadMyLeaves();
      loadLeaveBalance();
    } else {
      showToast(data.message || 'Failed to submit leave', 'error');
    }
  } catch (error) {
    showToast('Failed to submit leave', 'error');
  }
}

async function loadMyLeaves() {
  if (!token) return;
  try {
    const response = await fetch(apiUrl('/api/leave/my'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!data.success) return;
    const list = document.getElementById('myLeaveList');
    if (!list) return;
    list.innerHTML = '';
    data.data.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${formatDateShort(item.startDate)} - ${formatDateShort(item.endDate)}</td>
        <td>${item.type || 'Casual'}</td>
        <td>${item.days || 0}</td>
        <td>${item.status}</td>
        <td>${item.reviewedBy || '-'}</td>
      `;
      list.appendChild(row);
    });
  } catch (error) {
    console.error('Load my leaves error:', error);
  }
}

async function loadPendingLeaves() {
  const section = document.getElementById('pendingLeaveSection');
  if (!section) return;
  if (!token || !currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'vice_admin' && currentUser.role !== 'manager')) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  try {
    const response = await fetch(apiUrl('/api/leave/pending'), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!data.success) return;
    const list = document.getElementById('pendingLeaveList');
    if (!list) return;
    list.innerHTML = '';
    data.data.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.name} (${item.employeeId})</td>
        <td>${item.department || 'N/A'}</td>
        <td>${formatDateShort(item.startDate)} - ${formatDateShort(item.endDate)}</td>
        <td>${item.type}</td>
        <td>${item.days}</td>
        <td>${item.reason || '-'}${item.approvalStage ? ` <span class="muted-text">(${item.approvalStage})</span>` : ''}</td>
        <td>
          <button class="btn-primary" onclick="approveLeave('${item._id}')">Approve</button>
          <button class="btn-secondary" onclick="rejectLeavePrompt('${item._id}')">Reject</button>
        </td>
      `;
      list.appendChild(row);
    });
  } catch (error) {
    console.error('Load pending leaves error:', error);
  }
}

async function approveLeave(id) {
  try {
    const response = await fetch(apiUrl(`/api/leave/${id}/approve`), {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.success) {
      showToast('Leave approved', 'success');
      loadPendingLeaves();
      loadLeaveBalance();
    } else {
      showToast(data.message || 'Approve failed', 'error');
    }
  } catch (error) {
    showToast('Approve failed', 'error');
  }
}

function rejectLeavePrompt(id) {
  const reason = prompt('Reason for rejection (optional):');
  rejectLeave(id, reason);
}

async function rejectLeave(id, reason) {
  try {
    const response = await fetch(apiUrl(`/api/leave/${id}/reject`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ reason: reason || '' })
    });
    const data = await response.json();
    if (data.success) {
      showToast('Leave rejected', 'success');
      loadPendingLeaves();
    } else {
      showToast(data.message || 'Reject failed', 'error');
    }
  } catch (error) {
    showToast('Reject failed', 'error');
  }
}

async function loadHolidays() {
  try {
    const response = await fetch(apiUrl('/api/leave/holidays'));
    const data = await response.json();
    if (!data.success) return;
    const list = document.getElementById('holidayList');
    if (!list) return;
    const isAdminRole = currentUser?.role === 'admin' || currentUser?.role === 'vice_admin';
    const addControls = document.querySelector('#holidayName')?.closest('.form-grid');
    if (addControls) {
      addControls.style.display = isAdminRole ? 'grid' : 'none';
    }
    list.innerHTML = '';
    data.data.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${formatDateShort(item.date)}</td>
        <td>${item.name}</td>
        <td>${item.description || '-'}</td>
        <td>
          ${isAdminRole ? `<button class="btn-delete" onclick="deleteHoliday('${item._id}')"><i class="fas fa-trash"></i></button>` : '-'}
        </td>
      `;
      list.appendChild(row);
    });
  } catch (error) {
    console.error('Load holidays error:', error);
  }
}

async function syncPublicHolidays() {
  if (!token || (currentUser?.role !== 'admin' && currentUser?.role !== 'vice_admin')) {
    showToast('Admin only', 'warning');
    return;
  }
  const country = document.getElementById('holidayCountry')?.value?.trim() || 'IN';
  const year = document.getElementById('holidayYear')?.value?.trim() || `${new Date().getFullYear()}`;
  try {
    const response = await fetch(apiUrl(`/api/leave/holidays/sync?country=${encodeURIComponent(country)}&year=${encodeURIComponent(year)}`), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.success) {
      showToast(`Synced ${data.count || 0} holidays`, 'success');
      loadHolidays();
    } else {
      showToast(data.message || 'Holiday sync failed', 'error');
    }
  } catch (error) {
    showToast('Holiday sync failed', 'error');
  }
}

async function addHoliday() {
  if (!token || (currentUser?.role !== 'admin' && currentUser?.role !== 'vice_admin')) {
    showToast('Admin only', 'warning');
    return;
  }
  const payload = {
    name: document.getElementById('holidayName')?.value?.trim(),
    date: document.getElementById('holidayDate')?.value,
    description: document.getElementById('holidayDescription')?.value?.trim()
  };
  if (!payload.name || !payload.date) {
    showToast('Holiday name and date required', 'warning');
    return;
  }
  try {
    const response = await fetch(apiUrl('/api/leave/holidays'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.success) {
      showToast('Holiday added', 'success');
      document.getElementById('holidayName').value = '';
      document.getElementById('holidayDate').value = '';
      document.getElementById('holidayDescription').value = '';
      loadHolidays();
    } else {
      showToast(data.message || 'Failed to add holiday', 'error');
    }
  } catch (error) {
    showToast('Failed to add holiday', 'error');
  }
}

async function deleteHoliday(id) {
  if (!confirm('Delete this holiday?')) return;
  try {
    const response = await fetch(apiUrl(`/api/leave/holidays/${id}`), {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.success) {
      showToast('Holiday deleted', 'success');
      loadHolidays();
    } else {
      showToast(data.message || 'Delete failed', 'error');
    }
  } catch (error) {
    showToast('Delete failed', 'error');
  }
}

function getMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

async function loadRoster() {
  if (!token) return;
  const weekInput = document.getElementById('rosterWeekStart');
  const deptInput = document.getElementById('rosterDepartment');
  if (!weekInput || !deptInput) return;
  if (!weekInput.value) {
    const monday = getMonday();
    weekInput.value = monday.toISOString().slice(0, 10);
  }
  const weekStart = weekInput.value;
  const department = deptInput.value;
  if (!department) {
    showToast('Select department', 'warning');
    return;
  }

  try {
    const response = await fetch(apiUrl(`/api/roster?weekStart=${weekStart}&department=${department}`), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    const list = document.getElementById('rosterList');
    if (!list) return;
    list.innerHTML = '';
    if (!data.success || !data.data) {
      return;
    }
    const isManager = currentUser?.role === 'admin' || currentUser?.role === 'vice_admin' || currentUser?.role === 'manager';
    data.data.assignments.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.employeeId}</td>
        <td>${item.name}</td>
        <td>
          <select class="roster-shift" data-employee="${item.employeeId}" ${isManager ? '' : 'disabled'}>
            <option value="Day" ${item.shift === 'Day' ? 'selected' : ''}>Day</option>
            <option value="Night" ${item.shift === 'Night' ? 'selected' : ''}>Night</option>
            <option value="Extra Work" ${item.shift === 'Extra Work' ? 'selected' : ''}>Extra Work</option>
          </select>
        </td>
        <td>
          ${isManager ? `<button class="btn-secondary" onclick="saveRosterShift('${item.employeeId}', '${item.name}')">Save</button>` : '<span class="muted-text">View only</span>'}
        </td>
      `;
      list.appendChild(row);
    });
  } catch (error) {
    console.error('Load roster error:', error);
  }
}

async function autoAssignRoster() {
  if (!token || !currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'vice_admin' && currentUser.role !== 'manager')) {
    showToast('Admin/Manager only', 'warning');
    return;
  }
  const weekStart = document.getElementById('rosterWeekStart')?.value;
  const department = document.getElementById('rosterDepartment')?.value;
  const shift = document.getElementById('rosterShift')?.value;
  if (!weekStart || !department) {
    showToast('Week and department required', 'warning');
    return;
  }
  try {
    const response = await fetch(apiUrl('/api/roster/auto-assign'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ weekStart, department, shift })
    });
    const data = await response.json();
    if (data.success) {
      showToast('Roster updated', 'success');
      loadRoster();
    } else {
      showToast(data.message || 'Auto-assign failed', 'error');
    }
  } catch (error) {
    showToast('Auto-assign failed', 'error');
  }
}

async function autoAssignRosterSmart() {
  if (!token || !currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'vice_admin' && currentUser.role !== 'manager')) {
    showToast('Admin/Manager only', 'warning');
    return;
  }
  const weekStart = document.getElementById('rosterWeekStart')?.value;
  const department = document.getElementById('rosterDepartment')?.value;
  if (!weekStart || !department) {
    showToast('Week and department required', 'warning');
    return;
  }
  try {
    const response = await fetch(apiUrl('/api/roster/auto-assign-smart'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ weekStart, department })
    });
    const data = await response.json();
    if (data.success) {
      showToast('Smart roster updated', 'success');
      loadRoster();
    } else {
      showToast(data.message || 'Smart assign failed', 'error');
    }
  } catch (error) {
    showToast('Smart assign failed', 'error');
  }
}

async function saveRosterShift(employeeId, name) {
  const weekStart = document.getElementById('rosterWeekStart')?.value;
  const department = document.getElementById('rosterDepartment')?.value;
  const select = document.querySelector(`.roster-shift[data-employee="${employeeId}"]`);
  if (!select || !weekStart || !department) return;
  const shift = select.value;
  try {
    const response = await fetch(apiUrl('/api/roster/assignment'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ weekStart, department, employeeId, name, shift })
    });
    const data = await response.json();
    if (data.success) {
      showToast('Shift saved', 'success');
    } else {
      showToast(data.message || 'Save failed', 'error');
    }
  } catch (error) {
    showToast('Save failed', 'error');
  }
}

function renderUserQRCode() {
  const qrBox = document.getElementById('qrCodeBox');
  const qrEmployeeId = document.getElementById('qrEmployeeId');
  if (!qrBox) return;
  qrBox.innerHTML = '';
  if (!currentUser?.employeeId) {
    qrBox.innerHTML = '<span class="muted-text">Employee ID unavailable</span>';
    setQrStatus('Login required to generate QR.', 'warning');
    if (qrEmployeeId) qrEmployeeId.textContent = '-';
    return;
  }
  if (qrEmployeeId) qrEmployeeId.textContent = currentUser.employeeId;
  if (!currentQrToken) {
    qrBox.innerHTML = '<span class="muted-text">Generating QR...</span>';
    setQrStatus('Requesting token...', 'info');
    if (token) refreshQrToken();
    return;
  }
  renderQrWithFallback(qrBox, currentQrToken);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function ensureQrLibraryLoaded() {
  if (window.QRCode) return true;
  const fallbacks = [
    'https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
  ];
  for (const src of fallbacks) {
    try {
      await loadScript(src);
      if (window.QRCode) return true;
    } catch (_) {}
  }
  return Boolean(window.QRCode);
}

async function renderQrWithFallback(qrBox, tokenValue) {
  if (!window.QRCode) {
    const loaded = await ensureQrLibraryLoaded();
    if (!loaded) {
      qrBox.innerHTML = '<span class="muted-text">QR library not loaded</span>';
      setQrStatus('QR library blocked. Check internet/CSP.', 'error');
      return;
    }
  }
  try {
    new QRCode(qrBox, {
      text: tokenValue,
      width: 180,
      height: 180,
      correctLevel: QRCode.CorrectLevel.L
    });
  } catch (error) {
    console.error('QR render failed:', error);
    qrBox.innerHTML = '<span class="muted-text">QR render failed</span>';
    const reason = error?.message ? ` (${error.message})` : '';
    setQrStatus(`Unable to render QR${reason}`, 'error');
  }
}

function parseQrPayload(text) {
  if (!text) return '';
  if (text.startsWith('EMP')) return text.trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed.employeeId) return parsed.employeeId;
  } catch (_) {}
  return text.trim();
}

async function refreshQrToken() {
  if (!token) return;
  try {
    const response = await fetch(apiUrl('/api/attendance/qr-token'), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (data.success) {
      currentQrToken = data.token;
      const ttl = Number(data.expiresIn || 300);
      qrExpiryAt = Date.now() + (ttl * 1000);
      startQrCountdown();
      renderUserQRCode();
      setQrStatus('QR ready', 'success');
    } else {
      setQrStatus(data.message || 'QR token failed', 'error');
    }
  } catch (error) {
    setQrStatus('Unable to refresh QR', 'error');
    showToast('Unable to refresh QR', 'error');
  }
}

function startQrTokenAutoRefresh() {
  if (qrTokenTimer) return;
  refreshQrToken();
  qrTokenTimer = setInterval(() => {
    if (token) {
      refreshQrToken();
    }
  }, 30000);
}

function ensureQrTokenFresh() {
  if (!token) return;
  const now = Date.now();
  if (!currentQrToken || !qrExpiryAt || now > (qrExpiryAt - 10000)) {
    refreshQrToken();
  } else {
    renderUserQRCode();
    startQrCountdown();
  }
}

function setQrStatus(text, state = 'info') {
  const statusEl = document.getElementById('qrExpiryTimer');
  if (!statusEl) return;
  statusEl.textContent = text || '';
  statusEl.dataset.state = state;
}

function formatCountdown(ms) {
  if (ms < 0) return '00:00';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function startQrCountdown() {
  if (!qrExpiryAt) return;
  if (qrCountdownTimer) {
    clearInterval(qrCountdownTimer);
  }
  const tick = () => {
    if (!qrExpiryAt) return;
    const remaining = qrExpiryAt - Date.now();
    if (remaining <= 0) {
      setQrStatus('QR expired. Refreshing...', 'warning');
      clearInterval(qrCountdownTimer);
      qrCountdownTimer = null;
      refreshQrToken();
      return;
    }
    setQrStatus(`QR refresh in ${formatCountdown(remaining)}`, 'info');
  };
  tick();
  qrCountdownTimer = setInterval(tick, 1000);
}

function copyEmployeeId() {
  const id = currentUser?.employeeId;
  if (!id) {
    showToast('Employee ID not available', 'warning');
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(id)
      .then(() => showToast('Employee ID copied', 'success'))
      .catch(() => showToast('Unable to copy Employee ID', 'error'));
  } else {
    showToast('Clipboard not supported', 'warning');
  }
}

function centerGeoMap() {
  const settings = getGeofenceSettings();
  if (!geoMap) {
    updateGeoMap();
  }
  if (geoMap) {
    geoMap.setView([settings.lat, settings.lng], 15);
    geoMap.invalidateSize();
  }
}

function useCurrentLocationForGeofence() {
  if (!currentCoords) {
    showToast('Location not available yet', 'warning');
    getLocation();
    return;
  }
  const latInput = document.getElementById('geoLat');
  const lngInput = document.getElementById('geoLng');
  if (latInput) latInput.value = currentCoords.lat.toFixed(6);
  if (lngInput) lngInput.value = currentCoords.lng.toFixed(6);
  saveGeofenceSettings();
}

async function startQrScanner() {
  if (!token) {
    showToast('Please login first', 'warning');
    return;
  }
  if (!window.Html5Qrcode) {
    showToast('QR scanner library not loaded', 'error');
    return;
  }
  const target = document.getElementById('qrScanner');
  if (!target) return;

  if (!qrScannerInstance) {
    qrScannerInstance = new Html5Qrcode('qrScanner');
  }

  try {
    await qrScannerInstance.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 220 },
      async (decodedText) => {
        await stopQrScanner();
        handleQrScan(decodedText);
      }
    );
  } catch (error) {
    showToast('Unable to start camera', 'error');
  }
}

async function stopQrScanner() {
  if (!qrScannerInstance) return;
  try {
    await qrScannerInstance.stop();
    await qrScannerInstance.clear();
  } catch (_) {}
}

async function handleQrScan(decodedText) {
  const qrToken = decodedText && decodedText.trim();
  if (!qrToken) {
    showToast('Invalid QR code', 'error');
    return;
  }

  if (!ensureInsideGeofence()) {
    return;
  }

  const employeeId = decodeEmployeeIdFromToken(qrToken);
  if (!employeeId) {
    showToast('Invalid or expired QR token', 'error');
    return;
  }

  if (!capturedFaceImage) {
    showToast('Please capture face first', 'warning');
    return;
  }
  if (!lastLivenessPassed) {
    showToast('Liveness check required', 'warning');
    return;
  }

  const pin = document.getElementById('qrPin')?.value?.trim();
  if (!pin) {
    showToast('Enter employee PIN', 'warning');
    return;
  }

  const faceVerified = await verifyFaceForEmployee(employeeId, capturedFaceImage);
  if (!faceVerified) {
    showToast('Face verification failed', 'error');
    return;
  }

  const payload = {
    token: qrToken,
    location: document.getElementById('location')?.value || '',
    faceImage: capturedFaceImage,
    faceVerified: true,
    pin,
    livenessPassed: true,
    livenessScore: lastLivenessScore,
    locationLat: currentCoords?.lat,
    locationLng: currentCoords?.lng,
    locationAccuracy: currentAccuracy
  };

  try {
    const response = await fetch(apiUrl('/api/attendance/qr-scan'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.success) {
      showToast(data.action === 'checkout' ? 'Check-out successful' : 'Check-in successful', 'success');
      capturedFaceImage = '';
      lastLivenessPassed = false;
      lastLivenessScore = 0;
      const pinInput = document.getElementById('qrPin');
      if (pinInput) pinInput.value = '';
      const facePreview = document.getElementById('facePreview');
      if (facePreview) {
        facePreview.src = '';
        facePreview.style.display = 'none';
      }
      loadAttendanceHistory();
      loadDashboard();
    } else {
      showToast(data.message || 'QR scan failed', 'error');
    }
  } catch (error) {
    showToast('QR scan failed', 'error');
  }
}

async function openFaceCapture() {
  const modal = document.getElementById('faceCaptureModal');
  const video = document.getElementById('faceVideo');
  if (!modal || !video) return;
  modal.style.display = 'block';
  lastLivenessPassed = false;
  lastLivenessScore = 0;
  updateLivenessStatus('Ready for liveness check.', 'info');
  try {
    faceStream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = faceStream;
  } catch (error) {
    showToast('Camera access denied', 'error');
  }
}

async function captureFace() {
  const video = document.getElementById('faceVideo');
  const canvas = document.getElementById('faceCanvas');
  if (!video || !canvas) return;
  const liveness = await runLivenessCheck(video);
  lastLivenessPassed = liveness.passed;
  lastLivenessScore = liveness.score;
  if (!liveness.passed) {
    updateLivenessStatus('Liveness failed. Move face and try again.', 'error');
    showToast('Liveness check failed', 'error');
    return;
  }
  const antiSpoof = runAntiSpoofCheck(video);
  if (!antiSpoof.passed) {
    updateLivenessStatus('Anti-spoof failed. Improve lighting and try again.', 'error');
    showToast('Anti-spoof check failed', 'error');
    return;
  }
  const width = video.videoWidth || 320;
  const height = video.videoHeight || 240;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);
  capturedFaceImage = canvas.toDataURL('image/png');
  const preview = document.getElementById('facePreview');
  if (preview) {
    preview.src = capturedFaceImage;
    preview.style.display = 'block';
  }
  updateLivenessStatus('Liveness passed.', 'success');
  showToast('Face captured', 'success');
}

function closeFaceCapture() {
  const modal = document.getElementById('faceCaptureModal');
  if (modal) modal.style.display = 'none';
  if (faceStream) {
    faceStream.getTracks().forEach(track => track.stop());
    faceStream = null;
  }
  faceEnrollMode = false;
}

function updateLivenessStatus(text, state = 'info') {
  const status = document.getElementById('livenessStatus');
  if (!status) return;
  status.textContent = text || '';
  status.dataset.state = state;
}

function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runLivenessCheck(video) {
  if (!faceModelsLoaded || !window.faceapi) {
    updateLivenessStatus('Face models not loaded.', 'warning');
    return { passed: false, score: 0 };
  }
  updateLivenessStatus('Performing liveness check...', 'info');
  const options = new faceapi.TinyFaceDetectorOptions();
  const samples = [];
  for (let i = 0; i < 6; i += 1) {
    const detection = await faceapi.detectSingleFace(video, options).withFaceLandmarks();
    if (detection) samples.push(detection.landmarks);
    await waitMs(200);
  }
  if (samples.length < 2) {
    return { passed: false, score: 0 };
  }

  const ear = (eye) => {
    const p2 = eye[1];
    const p3 = eye[2];
    const p4 = eye[3];
    const p5 = eye[4];
    const p6 = eye[5];
    const p1 = eye[0];
    const vertical = Math.hypot(p2.x - p6.x, p2.y - p6.y) + Math.hypot(p3.x - p5.x, p3.y - p5.y);
    const horizontal = Math.hypot(p1.x - p4.x, p1.y - p4.y);
    return horizontal ? vertical / (2 * horizontal) : 0;
  };

  let blinkDetected = false;
  let turnDetected = false;
  let movementScore = 0;

  samples.forEach((lm, idx) => {
    const leftEye = lm.getLeftEye();
    const rightEye = lm.getRightEye();
    const earValue = (ear(leftEye) + ear(rightEye)) / 2;
    if (earValue > 0.23) {
      blinkDetected = blinkDetected || samples.some(other => {
        const oe = (ear(other.getLeftEye()) + ear(other.getRightEye())) / 2;
        return oe < 0.18;
      });
    }

    const nose = lm.positions[30];
    const left = lm.positions[36];
    const right = lm.positions[45];
    const ratio = (nose.x - left.x) / (right.x - left.x);
    if (ratio < 0.35 || ratio > 0.65) {
      turnDetected = true;
    }
    if (idx > 0) {
      const prev = samples[idx - 1].positions[30];
      const dx = nose.x - prev.x;
      const dy = nose.y - prev.y;
      movementScore = Math.max(movementScore, Math.sqrt(dx * dx + dy * dy));
    }
  });

  const passed = blinkDetected || turnDetected || movementScore >= 6;
  return { passed, score: Number(movementScore.toFixed(2)) };
}

function runAntiSpoofCheck(video) {
  const canvas = document.createElement('canvas');
  const width = video.videoWidth || 320;
  const height = video.videoHeight || 240;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const gray = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3;
    sum += gray;
    sumSq += gray * gray;
  }
  const n = img.data.length / 4;
  const mean = sum / n;
  const variance = (sumSq / n) - (mean * mean);
  const passed = variance > 200;
  return { passed, variance: Number(variance.toFixed(2)) };
}

async function openPhotoCapture(mode) {
  const modal = document.getElementById('photoCaptureModal');
  const video = document.getElementById('photoVideo');
  if (!modal || !video) return;
  photoMode = mode || 'checkin';
  modal.style.display = 'block';
  try {
    photoStream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = photoStream;
  } catch (error) {
    showToast('Camera access denied', 'error');
  }
}

function capturePhoto() {
  const video = document.getElementById('photoVideo');
  const canvas = document.getElementById('photoCanvas');
  if (!video || !canvas) return;
  const width = video.videoWidth || 320;
  const height = video.videoHeight || 240;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/png');
  if (photoMode === 'checkout') {
    capturedCheckOutPhoto = dataUrl;
    const preview = document.getElementById('checkOutPhotoPreview');
    if (preview) {
      preview.src = dataUrl;
      preview.style.display = 'block';
    }
  } else {
    capturedCheckInPhoto = dataUrl;
    const preview = document.getElementById('checkInPhotoPreview');
    if (preview) {
      preview.src = dataUrl;
      preview.style.display = 'block';
    }
  }
  showToast('Photo captured', 'success');
}

function closePhotoCapture() {
  const modal = document.getElementById('photoCaptureModal');
  if (modal) modal.style.display = 'none';
  if (photoStream) {
    photoStream.getTracks().forEach(track => track.stop());
    photoStream = null;
  }
}

function resetCheckInPhoto() {
  capturedCheckInPhoto = '';
  const preview = document.getElementById('checkInPhotoPreview');
  if (preview) {
    preview.src = '';
    preview.style.display = 'none';
  }
}

function resetCheckOutPhoto() {
  capturedCheckOutPhoto = '';
  const preview = document.getElementById('checkOutPhotoPreview');
  if (preview) {
    preview.src = '';
    preview.style.display = 'none';
  }
}

async function loadFaceModels() {
  if (!window.faceapi) return;
  const modelUrl = '/models/face-api';
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
      faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl)
    ]);
    faceModelsLoaded = true;
  } catch (error) {
    faceModelsLoaded = false;
    console.error('Face models failed to load', error);
  }
}

async function getFaceDescriptorFromImage(dataUrl) {
  if (!faceModelsLoaded || !window.faceapi) {
    showToast('Face models not loaded', 'warning');
    return null;
  }
  const img = await faceapi.fetchImage(dataUrl);
  const detection = await faceapi.detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!detection || !detection.descriptor) {
    showToast('Face not detected clearly', 'warning');
    return null;
  }
  return Array.from(detection.descriptor);
}

function decodeEmployeeIdFromToken(tokenValue) {
  try {
    const payload = tokenValue.split('.')[1];
    if (!payload) return '';
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.employeeId || '';
  } catch (_) {
    return '';
  }
}

async function verifyFaceForEmployee(employeeId, imageDataUrl) {
  try {
    const response = await fetch(apiUrl(`/api/auth/face-descriptor/${employeeId}`), {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!data.success || !data.data?.faceEnrolled || !data.data.faceDescriptor?.length) {
      showToast('Employee face not enrolled', 'warning');
      return false;
    }
    const descriptor = await getFaceDescriptorFromImage(imageDataUrl);
    if (!descriptor) return false;
    const stored = data.data.faceDescriptor;
    const dist = faceapi.euclideanDistance(descriptor, stored);
    return dist < 0.55;
  } catch (error) {
    return false;
  }
}

function updateFaceEnrollStatus() {
  const status = document.getElementById('faceEnrollStatus');
  if (!status) return;
  if (currentUser?.faceEnrolled) {
    status.textContent = 'Face enrolled';
  } else {
    status.textContent = 'Face not enrolled';
  }
}

function openFaceEnroll() {
  faceEnrollMode = true;
  openFaceCapture();
}

async function enrollFace() {
  if (!capturedFaceImage) {
    showToast('Capture a clear face first', 'warning');
    return;
  }
  if (!lastLivenessPassed) {
    showToast('Liveness check required before enrollment', 'warning');
    return;
  }
  const descriptor = await getFaceDescriptorFromImage(capturedFaceImage);
  if (!descriptor) return;
  try {
    const response = await fetch(apiUrl('/api/auth/face-enroll'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ descriptor })
    });
    const data = await response.json();
    if (data.success) {
      showToast('Face enrolled', 'success');
      currentUser.faceEnrolled = true;
      updateFaceEnrollStatus();
      capturedFaceImage = '';
      const preview = document.getElementById('facePreview');
      if (preview) {
        preview.src = '';
        preview.style.display = 'none';
      }
      closeFaceCapture();
    } else {
      showToast(data.message || 'Enrollment failed', 'error');
    }
  } catch (error) {
    showToast('Enrollment failed', 'error');
  }
}

function initCoreFeatureControls() {
  const configs = [
    {
      key: 'biometricSettings',
      formId: 'coreBiometricForm',
      msgId: 'coreBiometricMsg',
      resetId: 'coreBiometricReset',
      saveMsg: 'Biometric settings saved.',
      fields: [
        { id: 'coreBiometricFingerprint', name: 'fingerprint', type: 'checkbox', defaultValue: true },
        { id: 'coreBiometricFace', name: 'face', type: 'checkbox', defaultValue: true },
        { id: 'coreBiometricRfid', name: 'rfid', type: 'checkbox', defaultValue: true },
        { id: 'coreBiometricLiveness', name: 'liveness' },
        { id: 'coreBiometricRetries', name: 'retries' },
        { id: 'coreBiometricDeviceLock', name: 'deviceLock', type: 'checkbox', defaultValue: false }
      ]
    },
    {
      key: 'geofenceSettingsLite',
      formId: 'coreGeofenceForm',
      msgId: 'coreGeofenceMsg',
      resetId: 'coreGeofenceReset',
      saveMsg: 'Geo-fencing settings saved.',
      fields: [
        { id: 'coreGeofenceEnabled', name: 'enabled', type: 'checkbox', defaultValue: true },
        { id: 'coreGeofenceRadius', name: 'radius' },
        { id: 'coreGeofenceDrift', name: 'drift' },
        { id: 'coreGeofenceStrict', name: 'strict', type: 'checkbox', defaultValue: false },
        { id: 'coreGeofenceOverride', name: 'override', type: 'checkbox', defaultValue: false },
        { id: 'coreGeofenceAlerts', name: 'alerts', type: 'checkbox', defaultValue: true }
      ]
    },
    {
      key: 'analyticsSettings',
      formId: 'coreAnalyticsForm',
      msgId: 'coreAnalyticsMsg',
      resetId: 'coreAnalyticsReset',
      saveMsg: 'Analytics settings saved.',
      fields: [
        { id: 'coreAnalyticsRefresh', name: 'refresh' },
        { id: 'coreAnalyticsRetention', name: 'retention' },
        { id: 'coreAnalyticsAnomaly', name: 'anomaly', defaultValue: 'medium' },
        { id: 'coreAnalyticsRank', name: 'rank', type: 'checkbox', defaultValue: true },
        { id: 'coreAnalyticsHeatmap', name: 'heatmap', type: 'checkbox', defaultValue: true }
      ]
    },
    {
      key: 'notificationSettings',
      formId: 'coreNotifyForm',
      msgId: 'coreNotifyMsg',
      resetId: 'coreNotifyReset',
      saveMsg: 'Notification settings saved.',
      fields: [
        { id: 'coreNotifyEmail', name: 'email', type: 'checkbox', defaultValue: true },
        { id: 'coreNotifySms', name: 'sms', type: 'checkbox', defaultValue: false },
        { id: 'coreNotifyWhatsapp', name: 'whatsapp', type: 'checkbox', defaultValue: false },
        { id: 'coreNotifyLate', name: 'late' },
        { id: 'coreNotifyAbsence', name: 'absence' },
        { id: 'coreNotifyDigest', name: 'digest' },
        { id: 'coreNotifyEscalation', name: 'escalation', type: 'checkbox', defaultValue: true }
      ]
    },
    {
      key: 'mobileSettings',
      formId: 'coreMobileForm',
      msgId: 'coreMobileMsg',
      resetId: 'coreMobileReset',
      saveMsg: 'Mobile settings saved.',
      fields: [
        { id: 'coreMobileCheckin', name: 'checkin', type: 'checkbox', defaultValue: true },
        { id: 'coreMobileOffline', name: 'offline', type: 'checkbox', defaultValue: true },
        { id: 'coreMobilePhoto', name: 'photo', type: 'checkbox', defaultValue: false },
        { id: 'coreMobilePush', name: 'push', type: 'checkbox', defaultValue: true },
        { id: 'coreMobileTheme', name: 'theme', defaultValue: 'system' }
      ]
    },
    {
      key: 'cloudBackupSettings',
      formId: 'coreCloudForm',
      msgId: 'coreCloudMsg',
      resetId: 'coreCloudReset',
      saveMsg: 'Backup settings saved.',
      fields: [
        { id: 'coreCloudEnabled', name: 'enabled', type: 'checkbox', defaultValue: true },
        { id: 'coreCloudFrequency', name: 'frequency', defaultValue: 'daily' },
        { id: 'coreCloudTime', name: 'time' },
        { id: 'coreCloudRetention', name: 'retention' },
        { id: 'coreCloudEncryption', name: 'encryption', type: 'checkbox', defaultValue: true }
      ]
    }
  ];

  configs.forEach(config => {
    const form = document.getElementById(config.formId);
    if (!form) return;
    const msg = document.getElementById(config.msgId);
    const resetBtn = document.getElementById(config.resetId);

    const loadSettings = () => {
      const data = JSON.parse(localStorage.getItem(config.key) || '{}');
      config.fields.forEach(field => {
        const el = document.getElementById(field.id);
        if (!el) return;
        if (field.type === 'checkbox') {
          if (data[field.name] === undefined) {
            el.checked = Boolean(field.defaultValue);
          } else {
            el.checked = Boolean(data[field.name]);
          }
        } else {
          el.value = data[field.name] ?? field.defaultValue ?? '';
        }
      });
    };

    const collectData = () => {
      const data = {};
      config.fields.forEach(field => {
        const el = document.getElementById(field.id);
        if (!el) return;
        if (field.type === 'checkbox') {
          data[field.name] = el.checked;
        } else {
          data[field.name] = el.value;
        }
      });
      return data;
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      localStorage.setItem(config.key, JSON.stringify(collectData()));
      if (msg) msg.textContent = config.saveMsg;
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        localStorage.removeItem(config.key);
        loadSettings();
        if (msg) msg.textContent = 'Settings reset.';
      });
    }

    loadSettings();
  });

  const testRestoreBtn = document.getElementById('coreCloudTest');
  const testRestoreMsg = document.getElementById('coreCloudMsg');
  if (testRestoreBtn) {
    testRestoreBtn.addEventListener('click', () => {
      if (testRestoreMsg) {
        testRestoreMsg.textContent = 'Test restore started. You will receive a status update shortly.';
      }
    });
  }
}

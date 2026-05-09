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

let currentCoords = null;

function setStatus(text, type = 'info') {
  const el = document.getElementById('kioskStatus');
  if (el) el.textContent = text || '';
}

function initLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      currentCoords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      const coords = `Lat: ${position.coords.latitude.toFixed(4)}, Long: ${position.coords.longitude.toFixed(4)}`;
      const input = document.getElementById('kioskLocation');
      if (input) input.value = coords;
    },
    () => {
      const input = document.getElementById('kioskLocation');
      if (input) input.value = 'Location unavailable';
    }
  );
}

async function kioskCheckIn() {
  const employeeId = document.getElementById('kioskEmployeeId').value.trim();
  const name = document.getElementById('kioskName').value.trim();
  const department = document.getElementById('kioskDepartment').value;
  const shift = document.getElementById('kioskShift').value;
  const location = document.getElementById('kioskLocation').value || '';
  if (!employeeId || !name) {
    setStatus('Employee ID and name required');
    return;
  }
  try {
    const response = await fetch(apiUrl('/api/attendance/checkin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId,
        name,
        department,
        shift,
        location,
        locationLat: currentCoords?.lat,
        locationLng: currentCoords?.lng,
        locationAccuracy: currentCoords?.accuracy
      })
    });
    const data = await response.json();
    if (data.success) {
      setStatus('Check-in successful');
    } else {
      setStatus(data.message || 'Check-in failed');
    }
  } catch (error) {
    setStatus('Network error');
  }
}

async function kioskCheckOut() {
  const employeeId = document.getElementById('kioskEmployeeId').value.trim();
  if (!employeeId) {
    setStatus('Employee ID required');
    return;
  }
  try {
    const response = await fetch(apiUrl(`/api/attendance/checkout/${employeeId}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: document.getElementById('kioskLocation').value || '',
        locationLat: currentCoords?.lat,
        locationLng: currentCoords?.lng,
        locationAccuracy: currentCoords?.accuracy
      })
    });
    const data = await response.json();
    if (data.success) {
      setStatus('Check-out successful');
    } else {
      setStatus(data.message || 'Check-out failed');
    }
  } catch (error) {
    setStatus('Network error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLocation();
});

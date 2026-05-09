const normalizeIp = (ip) => {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.replace('::ffff:', '');
  return ip;
};

const parseList = (raw) => {
  if (!raw) return [];
  return raw.split(',').map(item => item.trim()).filter(Boolean);
};

const isAllowed = (ip, whitelist) => {
  if (!whitelist.length) return true;
  const normalized = normalizeIp(ip);
  if (normalized === '127.0.0.1' || normalized === '::1') return true;
  return whitelist.some(entry => {
    if (entry.endsWith('*')) {
      const prefix = entry.slice(0, -1);
      return normalized.startsWith(prefix);
    }
    if (entry.endsWith('.')) {
      return normalized.startsWith(entry);
    }
    return normalized === entry;
  });
};

const ipWhitelist = (req, res, next) => {
  const whitelist = parseList(process.env.OFFICE_IP_WHITELIST || '');
  if (!isAllowed(req.ip, whitelist)) {
    return res.status(403).json({ success: false, message: 'Access denied: IP not allowed.' });
  }
  next();
};

module.exports = ipWhitelist;

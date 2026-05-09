const https = require('https');
const http = require('http');

const postJson = (url, payload) => new Promise((resolve) => {
  try {
    const data = JSON.stringify(payload || {});
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.write(data);
    req.end();
  } catch (_) {
    resolve(false);
  }
});

const sendWebhooks = async (event, payload) => {
  const raw = process.env.WEBHOOK_URLS || '';
  const urls = raw.split(',').map(u => u.trim()).filter(Boolean);
  if (!urls.length) return;
  for (const url of urls) {
    await postJson(url, { event, payload, sentAt: new Date().toISOString() });
  }
};

module.exports = { sendWebhooks };

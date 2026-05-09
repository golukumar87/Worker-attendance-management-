const bcrypt = require('bcryptjs');

const getEnv = (key, fallback = '') => process.env[key] || fallback;

const sendEmail = async ({ to, subject, text }) => {
  if (!to) return { ok: false, reason: 'no-recipient' };
  const host = getEnv('SMTP_HOST');
  const user = getEnv('SMTP_USER');
  const pass = getEnv('SMTP_PASS');
  const port = Number(getEnv('SMTP_PORT', '587'));
  if (!host || !user || !pass) {
    return { ok: false, reason: 'smtp-not-configured' };
  }
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
    await transporter.sendMail({
      from: getEnv('SMTP_FROM', user),
      to,
      subject: subject || 'Notification',
      text: text || ''
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
};

const sendSms = async ({ to, text }) => {
  if (!to) return { ok: false, reason: 'no-recipient' };
  const sid = getEnv('TWILIO_SID');
  const token = getEnv('TWILIO_TOKEN');
  const from = getEnv('TWILIO_FROM');
  if (!sid || !token || !from) {
    return { ok: false, reason: 'twilio-not-configured' };
  }
  try {
    const twilio = require('twilio');
    const client = twilio(sid, token);
    await client.messages.create({ from, to, body: text || '' });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
};

const sendWhatsapp = async ({ to, text }) => {
  if (!to) return { ok: false, reason: 'no-recipient' };
  const sid = getEnv('TWILIO_SID');
  const token = getEnv('TWILIO_TOKEN');
  const from = getEnv('TWILIO_WHATSAPP_FROM');
  if (!sid || !token || !from) {
    return { ok: false, reason: 'whatsapp-not-configured' };
  }
  try {
    const twilio = require('twilio');
    const client = twilio(sid, token);
    await client.messages.create({ from, to: `whatsapp:${to}`, body: text || '' });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
};

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const hashOtp = async (otp) => bcrypt.hash(String(otp), 10);

const verifyOtp = async (otp, hash) => bcrypt.compare(String(otp || ''), hash || '');

module.exports = {
  sendEmail,
  sendSms,
  sendWhatsapp,
  generateOtp,
  hashOtp,
  verifyOtp
};

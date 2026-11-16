// Sends real SMS / WhatsApp messages to farmers.
//   fast2sms - Indian SMS gateway, only needs an API key
//   twilio   - SMS, or WhatsApp when TWILIO_WHATSAPP=1
//   none     - messages are only saved and shown in the farmer portal
const C = require('./config');

function normalize(phone) {
  const raw = String(phone || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (raw.startsWith('+')) return '+' + digits;
  if (digits.length === 10) return C.DEFAULT_COUNTRY_CODE + digits;
  return '+' + digits;
}

function providerLabel() {
  if (C.SMS_PROVIDER === 'fast2sms' && C.FAST2SMS_KEY) return 'Fast2SMS (SMS)';
  if (C.SMS_PROVIDER === 'twilio' && C.TWILIO_SID && C.TWILIO_TOKEN && C.TWILIO_FROM)
    return C.TWILIO_WHATSAPP ? 'Twilio WhatsApp' : 'Twilio SMS';
  return null;
}

async function fast2sms(number, text) {
  const r = await fetch('https://www.fast2sms.com/dev/bulkV2', {
    method: 'POST',
    headers: { authorization: C.FAST2SMS_KEY },
    body: new URLSearchParams({ route: C.FAST2SMS_ROUTE, message: text, language: 'english',
                                flash: '0', numbers: number.slice(-10) }),
    signal: AbortSignal.timeout(15000),
  });
  let body;
  try { body = await r.json(); } catch { return ['failed', `HTTP ${r.status}`]; }
  if (body.return === true) return ['sent', null];
  return ['failed', String(body.message || JSON.stringify(body)).slice(0, 250)];
}

async function twilio(number, text) {
  let to = number, from = C.TWILIO_FROM;
  if (C.TWILIO_WHATSAPP) { to = 'whatsapp:' + to; from = 'whatsapp:' + from; }
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${C.TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${C.TWILIO_SID}:${C.TWILIO_TOKEN}`).toString('base64') },
    body: new URLSearchParams({ From: from, To: to, Body: text }),
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 200 || r.status === 201) return ['sent', null];
  try { return ['failed', String((await r.json()).message).slice(0, 250)]; }
  catch { return ['failed', `HTTP ${r.status}`]; }
}

// Returns [status, error]. status is 'sent', 'failed' or 'not_sent'. Never throws.
async function sendMessage(phone, text) {
  const number = normalize(phone);
  if (!number) return ['not_sent', 'Farmer has no phone number'];
  if (!providerLabel()) return ['not_sent', 'SMS provider not configured (see .env)'];
  try {
    return C.SMS_PROVIDER === 'fast2sms' ? await fast2sms(number, text) : await twilio(number, text);
  } catch (e) {
    return ['failed', `${e.name}: ${e.message}`.slice(0, 250)];
  }
}

module.exports = { sendMessage, providerLabel, normalize };

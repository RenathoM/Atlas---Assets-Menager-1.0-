const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const DEFAULT_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1453805636784488509/6tdAXTB0DqdiWaLTmi05bWWDnTDk9mGLhmDFVTXgiL48yVKcOpN_at22DtCY8SotPvn1';

function truncate(str, n = 1000) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + `...(${str.length - n} more chars)` : str;
}

const FOOTER_TEXT = '# ======= End of Request =======';

async function send(event, details = {}) {
  const webhook = process.env.DISCORD_WEBHOOK_URL || DEFAULT_WEBHOOK;
  // Always attempt to send webhook; fallback to console if URL unavailable
  if (!webhook) {
    console.log(`[WEBHOOK FALLBACK] ${event}:`, details);
    return;
  }

  const title = `Bridge Event: ${event}`;
  const fields = [];

  for (const [k, v] of Object.entries(details)) {
    let value;
    try { value = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { value = String(v); }
    value = truncate(value, 900);
    fields.push({ name: k, value: value || '—', inline: false });
  }

  const payload = {
    embeds: [
      {
        title,
        color: 3066993,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: FOOTER_TEXT }
      },
    ],
  };

  try {
    await axios.post(webhook, payload, { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.warn('Failed to send webhook:', err.message || err);
  }
}

async function sendFile(event, filePath, details = {}) {
  const webhook = process.env.DISCORD_WEBHOOK_URL || DEFAULT_WEBHOOK;
  // Always attempt to send webhook; fallback to console if URL unavailable
  if (!webhook) {
    console.log(`[WEBHOOK FALLBACK] ${event}:`, details);
    return;
  }
  if (!filePath) return send(event, details);
  try {
    const fields = [];
    for (const [k, v] of Object.entries(details)) {
      let value;
      try { value = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { value = String(v); }
      value = truncate(value, 900);
      fields.push({ name: k, value: value || '—', inline: false });
    }

    const payload = {
      embeds: [
        {
          title: `Bridge Event: ${event}`,
          color: 3066993,
          fields,
          timestamp: new Date().toISOString(),
          footer: { text: FOOTER_TEXT }
        },
      ],
    };

    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    if (fs.existsSync(filePath)) {
      form.append('file', fs.createReadStream(filePath));
    } else {
      // If file missing, include path text as an embed field
      form.append('file', Buffer.from(''), { filename: 'missing.txt' });
    }

    const headers = form.getHeaders();
    await axios.post(webhook, form, { headers, maxContentLength: Infinity, maxBodyLength: Infinity });
  } catch (err) {
    console.warn('Failed to send webhook file:', err.message || err);
  }
}

module.exports = { send, sendFile };

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const DEFAULT_WEBHOOK = process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1453805636784488509/6tdAXTB0DqdiWaLTmi05bWWDnTDk9mGLhmDFVTXgiL48yVKcOpN_at22DtCY8SotPvn1';

// Deduplicate trackers to avoid sending multiple .rbxm attachments or repeated summaries
// Persist state between restarts into OUT_DIR/.webhook_state.json when possible
const path = require('path');
const OUT_DIR = process.env.OUT_DIR || path.join(process.cwd(), 'out');
const STATE_PATH = path.join(OUT_DIR, '.webhook_state.json');

const _sentFileByAsset = new Set(); // keys: asset:<assetId>
const _sentFileByJob = new Set();   // keys: job:<jobId>
const _sentEventByJob = new Set();  // keys: event:<eventName>:job:<jobId>

function _loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = fs.readFileSync(STATE_PATH, 'utf8');
      const obj = JSON.parse(raw || '{}');
      (obj.sentFileByAsset || []).forEach(k => _sentFileByAsset.add(k));
      (obj.sentFileByJob || []).forEach(k => _sentFileByJob.add(k));
      (obj.sentEventByJob || []).forEach(k => _sentEventByJob.add(k));
    }
  } catch (e) {
    console.warn('Failed to load webhook state:', e.message || e);
  }
}

function _saveState() {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const obj = {
      sentFileByAsset: Array.from(_sentFileByAsset),
      sentFileByJob: Array.from(_sentFileByJob),
      sentEventByJob: Array.from(_sentEventByJob),
    };
    fs.writeFileSync(STATE_PATH, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.warn('Failed to save webhook state:', e.message || e);
  }
}

_loadState();

function truncate(str, n = 1000) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + `...(${str.length - n} more chars)` : str;
}

const FOOTER_TEXT = '';

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
    // Deduplicate asset_summary events per job to avoid duplicates
    const jobId = details?.jobId || details?.job_id || null;
    if (event === 'asset_summary' && jobId) {
      const key = `event:${event}:job:${jobId}`;
      if (_sentEventByJob.has(key)) return;
      _sentEventByJob.add(key);
      _saveState();
    }

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
  // Only deduplicate for .rbxm attachments (we allow other file types to be sent)
  const isRbxm = String(filePath || '').toLowerCase().endsWith('.rbxm');
    if (isRbxm) {
    const jobId = details?.jobId || details?.job_id || null;
    const assetId = details?.assetId || details?.asset_id || details?.response?.assetId || details?.response?.asset_id || null;
    if (jobId) {
      const key = `job:${jobId}`;
      if (_sentFileByJob.has(key)) return;
        _sentFileByJob.add(key);
        _saveState();
    } else if (assetId) {
      const key = `asset:${assetId}`;
      if (_sentFileByAsset.has(key)) return;
      _sentFileByAsset.add(key);
      _saveState();
    }
  }
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

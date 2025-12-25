const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const { jsonToRBXM } = require('./rbxmConverter');
// load .env if present
require('dotenv').config();
// sanitize possible quoted env values (e.g. ROBLOX_BEARER="token")
const _sanitizeEnv = v => {
  if (!v || typeof v !== 'string') return v;
  const m = v.match(/^\s*"?(.*?)"?\s*$/);
  return m ? m[1] : v;
};
process.env.ROBLOX_BEARER = _sanitizeEnv(process.env.ROBLOX_BEARER);
process.env.ROBLOX_API_KEY = _sanitizeEnv(process.env.ROBLOX_API_KEY);
const fs = require('fs');
const path = require('path');
const Queue = require('./queue');
const Webhook = require('./webhook');

const app = express();
app.use(express.json({ limit: '20mb' }));

const PORT = process.env.PORT || 3000;
const ASSETS_API_URL = process.env.ASSETS_API_URL || 'https://apis.roblox.com/assets/v1/assets';
const ASSET_DELIVERY_URL = process.env.ASSET_DELIVERY_URL || 'https://assetdelivery.roblox.com/v1/asset?id=';

app.post('/upload', async (req, res) => {
  try {
    // Validate experience secret if configured
    const experienceSecret = process.env.EXPERIENCE_SECRET;
    if (experienceSecret) {
      const provided = req.headers['x-bridge-secret'] || req.headers['x-experience-secret'];
      if (!provided || provided !== experienceSecret) {
        Webhook.send('request_rejected', { reason: 'invalid_experience_secret', ip: req.ip, headers: req.headers });
        return res.status(401).json({ error: 'Invalid experience secret' });
      }
    }

    // Basic payload validation
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ error: 'Empty payload' });
    }
    const payload = req.body;
    // send webhook notification about incoming request (truncate large fields)
    Webhook.send('request_received', { name: payload.name || null, assetType: payload.assetType || null, payload: payload });
    // If a base asset is provided, download it and use as the .rbxm source
    let rbxmXml;
    if (payload.baseAssetId) {
      try {
        const baseUrl = `${ASSET_DELIVERY_URL}${encodeURIComponent(payload.baseAssetId)}`;
        const headers = {};
        if (process.env.ROBLOX_BEARER) headers['Authorization'] = `Bearer ${process.env.ROBLOX_BEARER}`;
        const resp = await axios.get(baseUrl, { responseType: 'arraybuffer', headers });
        rbxmXml = Buffer.from(resp.data).toString('utf8');
        Webhook.send('base_asset_downloaded', { baseAssetId: payload.baseAssetId, size: resp.data.length });
      } catch (e) {
        Webhook.send('base_asset_failed', { baseAssetId: payload.baseAssetId, error: String(e?.message || e) });
        return res.status(502).json({ error: 'Failed to download base asset', detail: String(e?.message || e) });
      }
    } else {
      rbxmXml = jsonToRBXM(payload);
    }
    const buffer = Buffer.from(rbxmXml, 'utf8');
    // ensure output directory exists and save the generated .rbxm locally
    const outDir = process.env.OUT_DIR || path.join(process.cwd(), 'out');
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { /* ignore */ }
    const requestedName = payload.name || (payload.properties && payload.properties.Name) || 'Model';
    const name = requestedName; // keep compatibility with older references
    // if we downloaded a base asset, try to extract its internal Name to use as filename
    let downloadedName = null;
    try {
      const m = rbxmXml.match(/<string\s+name="Name">([^<]+)<\/string>/i);
      if (m && m[1]) downloadedName = m[1].trim();
    } catch (e) { /* ignore */ }

    let filename;
    const ts = Date.now();
    if (payload.baseAssetId && downloadedName) {
      // use the downloaded asset's name as prefix and keep a suffix indicating target name
      const suffix = requestedName || 'Model';
      filename = `${downloadedName.replace(/\s+/g, '_')}-${suffix.replace(/\s+/g, '_')}-${ts}.rbxm`;
    } else {
      filename = `${ts}-${requestedName.replace(/\s+/g, '_')}.rbxm`;
    }
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, rbxmXml, 'utf8');

    // if we used a base asset, also send the saved .rbxm to the webhook for audit
    if (payload.baseAssetId) {
      try { Webhook.sendFile('base_asset_saved_file', filepath, { baseAssetId: payload.baseAssetId, name }); } catch (e) { /* ignore */ }
    }


    const form = new FormData();
    const assetType = process.env.ASSET_TYPE || String(payload.assetType || '13');
    const fileBaseName = path.basename(filename, '.rbxm');
    form.append('file', buffer, { filename: path.basename(filepath), contentType: 'application/xml' });
    form.append('assetType', assetType);
    // use the same naming convention for the asset name field (without .rbxm)
    form.append('name', fileBaseName);

    const headers = { ...form.getHeaders() };

    if (process.env.ROBLOX_BEARER) {
      headers['Authorization'] = `Bearer ${process.env.ROBLOX_BEARER}`;
    }
    if (process.env.ROBLOX_API_KEY) {
      headers['x-api-key'] = process.env.ROBLOX_API_KEY;
    }

    // If dry run requested, return the generated .rbxm and skip upload
    if (String(req.query.dry).toLowerCase() === 'true') {
      Webhook.send('dry_run', { name, localPath: filepath, rbxm: rbxmXml });
      try { Webhook.sendFile('dry_run_file', filepath, { name, localPath: filepath }); } catch (e) { /* ignore */ }
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('X-RBXM-FILEPATH', filepath);
      return res.send(rbxmXml);
    }

    // If not dry, push job to queue for upload (async retries)
    if (String(req.query.dry).toLowerCase() !== 'true') {
      // include base asset metadata for downstream processing when present
      const meta = { name, filename, filepath, assetType };
      if (payload.baseAssetId) {
        meta.baseAssetId = payload.baseAssetId;
        // try to extract previous asset Name from the RBXM XML
        try {
          const m = rbxmXml.match(/<string\s+name="Name">([^<]+)<\/string>/i);
          if (m && m[1]) meta.previousName = m[1];
        } catch (e) { /* ignore */ }
      }
      const jobId = Queue.push({ form, meta });
      Webhook.send('job_enqueued', { jobId, name, fileName: path.basename(filepath), localPath: filepath, assetType });
      try { Webhook.sendFile('job_enqueued_file', filepath, { jobId, name, fileName: path.basename(filepath) }); } catch (e) { /* ignore */ }
      return res.status(202).json({ status: 'queued', jobId, _localPath: filepath });
    }

    // For dry runs we already returned earlier; keep path in response
    const response = await axios.post(ASSETS_API_URL, form, { headers });

    const result = response.data || {};
    result._localPath = filepath;
    res.status(response.status).json(result);
  } catch (err) {
    console.error(err.response?.data || err.message);
    const status = err.response?.status || 500;
    const body = err.response?.data || { error: err.message };
    // include local file when available
    try { body._localPath = filepath; } catch (e) { /* ignore */ }
    res.status(status).json(body);
  }
});

app.get('/', (req, res) => res.send('Roblox Assets Bridge is running'));

// Queue inspection endpoints
app.get('/queue', (req, res) => {
  try {
    const list = Queue.list();
    res.json({ count: list.length, jobs: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/queue/:id', (req, res) => {
  try {
    const job = Queue.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'not found' });
    // avoid returning the in-memory FormData object
    const { id, attempts, status, createdAt, serialized, error: jobError, response } = job;
    res.json({ id, attempts, status, createdAt, serialized, error: jobError, response });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Roblox bridge listening on port ${PORT}`);
});

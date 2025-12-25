const axios = require('axios');
const fs = require('fs');
const path = require('path');

class UploadQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.retryDelay = Number(process.env.RETRY_DELAY_MS || 5000);
    this.maxRetries = Number(process.env.MAX_RETRIES || 3);
    this._nextId = 1;
    this.persistPath = process.env.QUEUE_PERSIST_PATH || path.join(process.cwd(), 'queue.json');
    this._load();
  }

  _save() {
    try {
      fs.writeFileSync(this.persistPath, JSON.stringify(this.queue, null, 2), 'utf8');
    } catch (e) {
      console.warn('Failed to persist queue:', e.message || e);
    }
  }

  _load() {
    try {
      if (fs.existsSync(this.persistPath)) {
        const raw = fs.readFileSync(this.persistPath, 'utf8');
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          this.queue = arr;
          for (const j of this.queue) if (j.id && j.id >= this._nextId) this._nextId = j.id + 1;
        }
      }
    } catch (e) {
      console.warn('Failed to load persisted queue:', e.message || e);
    }
  }

  push(job) {
    const id = this._nextId++;
    const record = { id, attempts: 0, createdAt: Date.now(), meta: job.meta || {}, status: 'queued' };
    // store a minimal serializable form (we don't persist FormData)
    record.serialized = { filename: job.meta.filename, filepath: job.meta.filepath, name: job.meta.name, assetType: job.meta.assetType };
    // keep the actual form in memory for processing
    record.form = job.form;
    this.queue.push(record);
    this._save();
    this.processNext();
    return id;
  }

  list() {
    return this.queue.map(j => ({ id: j.id, attempts: j.attempts, status: j.status, createdAt: j.createdAt, serialized: j.serialized }));
  }

  get(id) {
    return this.queue.find(j => j.id === Number(id));
  }

  async processNext() {
    if (this.processing) return;
    const job = this.queue.find(j => j.status === 'queued');
    if (!job) return;
    this.processing = true;
    job.status = 'processing';
    this._save();
    try {
      const res = await this._send(job);
      job.status = 'done';
      job.response = res;
      // notify via webhook
      try {
        const Webhook = require('./webhook');
        Webhook.send('job_succeeded', { jobId: job.id, serialized: job.serialized, response: res });
        try { Webhook.sendFile('job_succeeded_file', job.serialized.filepath, { jobId: job.id, response: res }); } catch (e) {}
      } catch (e) { /* ignore */ }
      // persist successful response for audit
      try {
        const outDir = process.env.OUT_DIR || path.join(process.cwd(), 'out');
        const sucDir = path.join(outDir, 'success');
        fs.mkdirSync(sucDir, { recursive: true });
        const filePath = path.join(sucDir, `job-${job.id}-response.json`);
        fs.writeFileSync(filePath, JSON.stringify(res || {}, null, 2), 'utf8');
      } catch (e) { /* ignore */ }
      // send structured asset summary to webhook when possible
      try {
        const Webhook = require('./webhook');
        const prevId = job.meta?.baseAssetId || null;
        const prevName = job.meta?.previousName || job.meta?.name || null;
        const newId = job.assetId || job.response?.assetId || null;
        const previousPrice = null; // price requires additional Marketplace API
        // Determine newPrice: try to read publish response if available
        let newPrice = null;
        if (job.published && job.published.response) {
          newPrice = job.published.response?.price ?? null;
        }
        const status = job.published ? 'published' : (newId ? 'created_unpublished' : 'creation_failed');

        const summary = {
          jobId: job.id,
          previousAssetId: prevId,
          previousName: prevName,
          previousPrice: previousPrice,
          newAssetId: newId,
          newName: prevName ? `${prevName} [New]` : (job.meta?.name ? `${job.meta.name} [New]` : 'Model [New]'),
          newPrice: newPrice,
          status,
          timestamps: {
            createdAt: job.createdAt || null,
            completedAt: job.publishCompletedAt || new Date().toISOString(),
          },
        };

        // Send as a compact webhook event (no file) for quick audit
        Webhook.send('asset_summary', summary);
      } catch (e) { /* ignore */ }
    } catch (err) {
      job.status = 'failed';
      job.error = String(err?.message || err);
      // include response body if available
      job.errorDetail = err?.response?.data || null;
      console.error('Job failed permanently:', job.id, job.error, job.errorDetail || '');
      // persist error detail for audit
      try {
        const outDir = process.env.OUT_DIR || path.join(process.cwd(), 'out');
        const errDir = path.join(outDir, 'errors');
        fs.mkdirSync(errDir, { recursive: true });
        const errFile = path.join(errDir, `job-${job.id}-error.json`);
        const payload = job.errorDetail || { message: job.error };
        fs.writeFileSync(errFile, typeof payload === 'string' ? JSON.stringify({ message: payload }, null, 2) : JSON.stringify(payload, null, 2), 'utf8');
      } catch (e) { /* ignore */ }
      // send structured asset_summary even on failures when possible
      try {
        const Webhook = require('./webhook');
        const prevId = job.meta?.baseAssetId || null;
        const prevName = job.meta?.previousName || job.meta?.name || null;
        const newId = job.assetId || job.response?.assetId || null;
        const previousPrice = null;
        const newPrice = null;
        const status = newId ? 'created_unpublished' : 'creation_failed';
        const summary = {
          jobId: job.id,
          previousAssetId: prevId,
          previousName: prevName,
          previousPrice,
          newAssetId: newId,
          newName: prevName ? `${prevName} [New]` : (job.meta?.name ? `${job.meta.name} [New]` : 'Model [New]'),
          newPrice,
          status,
          timestamps: {
            createdAt: job.createdAt || null,
            completedAt: new Date().toISOString(),
          },
        };
        Webhook.send('asset_summary', summary);
      } catch (e) { /* ignore */ }
      try {
        const Webhook = require('./webhook');
        Webhook.send('job_failed', { jobId: job.id, serialized: job.serialized, error: job.error, errorDetail: job.errorDetail });
        try { Webhook.sendFile('job_failed_file', job.serialized.filepath, { jobId: job.id, error: job.error, errorDetail: job.errorDetail }); } catch (e) {}
      } catch (e) { /* ignore */ }
    } finally {
      this.processing = false;
      this._save();
      setImmediate(() => this.processNext());
    }
  }

  async _send(job) {
    while (job.attempts < this.maxRetries) {
      try {
        job.attempts++;
        const headers = { ...job.form.getHeaders() };
        if (process.env.ROBLOX_BEARER) headers['Authorization'] = `Bearer ${process.env.ROBLOX_BEARER}`;
        if (process.env.ROBLOX_API_KEY) headers['x-api-key'] = process.env.ROBLOX_API_KEY;
        const res = await axios.post(process.env.ASSETS_API_URL || 'https://apis.roblox.com/assets/v1/assets', job.form, { headers });
        console.log('Upload requested for job', job.id, res.data);
        job.response = res.data;

        // If an operationId is returned, poll the operations endpoint until assetId is ready
        const operationId = res.data?.operationId || res.data?.operation_id || res.operationId;
        if (operationId) {
          const operationsBase = process.env.ASSETS_OPERATIONS_URL || (process.env.ASSETS_API_URL ? process.env.ASSETS_API_URL.replace(/\/$/, '') + '/operations' : 'https://apis.roblox.com/assets/v1/operations');
          const opUrl = `${operationsBase}/${operationId}`;
          console.log('Polling operation:', opUrl);
          let attempts = 0;
          const maxPolls = Number(process.env.MAX_OPERATION_POLLS || 40);
          const pollInterval = Number(process.env.OPERATION_POLL_INTERVAL_MS || 3000);
          while (attempts < maxPolls) {
            attempts++;
            try {
              const opRes = await axios.get(opUrl, { headers: headers });
              const data = opRes.data;
              // notify operation update
              try { require('./webhook').send('operation_update', { jobId: job.id, operationId, data }); } catch (e) {}
              if (data?.assetId || data?.asset_id) {
                const assetId = data?.assetId || data?.asset_id;
                job.assetId = assetId;
                console.log('Operation completed for job', job.id, 'assetId:', assetId);
                // If configured, attempt to auto-publish the asset
                try {
                  if (String(process.env.AUTO_PUBLISH).toLowerCase() === 'true' && (process.env.PUBLISH_API_URL || process.env.PUBLISH_API_URL_TEMPLATE)) {
                    // Check allowlist (optional)
                    const allowListRaw = process.env.ALLOWLIST_ASSET_IDS || process.env.ASSET_ALLOWLIST || '';
                    const allowList = allowListRaw.split(',').map(s => s.trim()).filter(Boolean);
                    if (allowList.length > 0 && !allowList.includes(String(assetId))) {
                      try { require('./webhook').send('publish_skipped_not_allowed', { jobId: job.id, assetId, allowList }); } catch (e) {}
                      job.published = { skipped: true, reason: 'not_in_allowlist', allowList };
                    } else {
                      const publishUrlTemplate = process.env.PUBLISH_API_URL || process.env.PUBLISH_API_URL_TEMPLATE;
                      const publishUrl = publishUrlTemplate.replace('{assetId}', encodeURIComponent(assetId));
                      try { require('./webhook').send('publish_started', { jobId: job.id, assetId, publishUrl }); } catch (e) {}
                      job.publishStartedAt = new Date().toISOString();
                      const publishBody = { assetId, makePublic: true };
                      const publishHeaders = { 'Content-Type': 'application/json' };
                      if (process.env.ROBLOX_BEARER) publishHeaders['Authorization'] = `Bearer ${process.env.ROBLOX_BEARER}`;
                      if (process.env.ROBLOX_API_KEY) publishHeaders['x-api-key'] = process.env.ROBLOX_API_KEY;
                      const pubRes = await axios.post(publishUrl, publishBody, { headers: publishHeaders });
                      job.publishCompletedAt = new Date().toISOString();
                      try { require('./webhook').send('publish_succeeded', { jobId: job.id, assetId, publishResponse: pubRes.data }); } catch (e) {}
                      job.published = { publishUrl, response: pubRes.data, startedAt: job.publishStartedAt, completedAt: job.publishCompletedAt };
                    }
                  }
                } catch (e) {
                  console.warn('Auto-publish failed for job', job.id, String(e?.message || e));
                  try { require('./webhook').send('publish_failed', { jobId: job.id, assetId, error: String(e?.message || e) }); } catch (e2) {}
                  job.publishError = String(e?.message || e);
                }
                return job.response;
              }
              if (data?.status && String(data.status).toLowerCase() === 'failed') {
                throw new Error('Operation reported failed');
              }
            } catch (e) {
              console.warn('Operation poll error:', String(e?.message || e));
            }
            await new Promise(r => setTimeout(r, pollInterval));
          }
          throw new Error('Operation did not complete in time');
        }

        // If no operationId, assume immediate creation and return response
        console.log('Upload succeeded for job', job.id, res.data);
        return res.data;
      } catch (err) {
        console.warn(`Job ${job.id} attempt ${job.attempts} failed:`, err.response?.status || err.message);
        if (job.attempts >= this.maxRetries) throw err;
        await new Promise(r => setTimeout(r, this.retryDelay));
      }
    }
  }
}

module.exports = new UploadQueue();

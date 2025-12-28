const fs = require('fs');
const path = require('path');
const Webhook = require('./webhook');

const id = process.argv[2];
if (!id) {
  console.error('Usage: node send_summary.js <jobId>');
  process.exit(2);
}

const qpath = path.join(process.cwd(), 'queue.json');
if (!fs.existsSync(qpath)) {
  console.error('queue.json not found');
  process.exit(2);
}

const arr = JSON.parse(fs.readFileSync(qpath, 'utf8'));
const job = arr.find(j => String(j.id) === String(id));
if (!job) {
  console.error('Job not found:', id);
  process.exit(2);
}

const prevId = job.meta?.baseAssetId || null;
const prevName = job.meta?.previousName || job.meta?.name || null;
const newId = job.assetId || job.response?.assetId || null;
const previousPrice = null;
let newPrice = null;
if (job.published && job.published.response) newPrice = job.published.response.price ?? null;
const status = job.published ? 'published' : (newId ? 'created_unpublished' : 'creation_failed');

const summary = {
  jobId: job.id,
  previousAssetId: prevId,
  previousName: prevName,
  previousPrice,
  newAssetId: newId,
  newName: prevName ? `${prevName} [New]` : (job.meta?.name ? `${job.meta.name} [New]` : 'Model [New]'),
  newPrice: newPrice,
  status,
  timestamps: {
    createdAt: job.createdAt || null,
    completedAt: job.publishCompletedAt || (job.status === 'done' ? new Date().toISOString() : null),
  },
};

console.log('Sending summary for job', job.id, summary);
Webhook.send('asset_summary', summary).then(() => {
  console.log('Sent');
  process.exit(0);
}).catch(err => {
  console.error('Send failed', err);
  process.exit(1);
});

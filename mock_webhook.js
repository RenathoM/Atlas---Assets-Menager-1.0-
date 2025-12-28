const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const upload = multer({ dest: 'out/webhook_uploads/' });
const app = express();

app.post('/webhook', upload.single('file'), (req, res) => {
  try {
    const metaDir = path.join(process.cwd(), 'out', 'webhook_logs');
    fs.mkdirSync(metaDir, { recursive: true });
    const id = Date.now();
    const meta = {
      headers: req.headers,
      body: req.body,
      file: req.file ? { originalname: req.file.originalname, path: req.file.path, size: req.file.size } : null,
    };
    fs.writeFileSync(path.join(metaDir, `webhook-${id}.json`), JSON.stringify(meta, null, 2), 'utf8');
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Webhook mock error', e);
    res.status(500).json({ error: String(e) });
  }
});

const PORT = process.env.MOCK_WEBHOOK_PORT || 5000;
app.listen(PORT, () => console.log(`Mock Webhook listening on ${PORT}`));

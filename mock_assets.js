const express = require('express');
const app = express();
app.use(express.json());

app.post('/assets', (req, res) => {
  // simulate immediate asset creation
  const assetId = Math.floor(Math.random() * 900000) + 100000;
  res.json({ assetId });
});

app.get('/operations/:id', (req, res) => {
  res.json({ status: 'completed', assetId: Math.floor(Math.random() * 900000) + 100000 });
});

const PORT = process.env.MOCK_ASSETS_PORT || 4000;
app.listen(PORT, () => console.log(`Mock Assets API listening on ${PORT}`));

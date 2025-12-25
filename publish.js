#!/usr/bin/env node
const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('assetId', { type: 'string', demandOption: true, describe: 'AssetId retornado pela Assets API' })
    .option('publishUrl', { type: 'string', describe: 'URL de publicação (override via env PUBLISH_API_URL)' })
    .option('makePublic', { type: 'boolean', default: true, describe: 'Tornar o asset público' })
    .help().argv;

  const assetId = argv.assetId;
  const publishUrl = argv.publishUrl || process.env.PUBLISH_API_URL;
  const bearer = process.env.ROBLOX_BEARER || process.env.ROBLOX_API_KEY;

  if (!publishUrl) {
    console.error('Nenhuma PUBLISH_API_URL fornecida. Defina env PUBLISH_API_URL ou passe --publishUrl');
    console.error('Observação: os endpoints exatos para "publicar" variam conforme permissões/conta - consulte a documentação Roblox.');
    process.exit(2);
  }

  if (!bearer) {
    console.error('Nenhuma credencial encontrada. Defina ROBLOX_BEARER ou ROBLOX_API_KEY no ambiente.');
    process.exit(2);
  }

  try {
    // Requisição genérica: o body e método dependem do endpoint que você tiver disponível.
    const url = publishUrl.replace('{assetId}', encodeURIComponent(assetId));
    const body = { makePublic: Boolean(argv.makePublic), assetId };
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.ROBLOX_BEARER) headers['Authorization'] = `Bearer ${process.env.ROBLOX_BEARER}`;
    if (process.env.ROBLOX_API_KEY) headers['x-api-key'] = process.env.ROBLOX_API_KEY;

    console.log('Enviando publicação para', url);
    const res = await axios.post(url, body, { headers });
    console.log('Resposta:', res.status, res.data);
  } catch (e) {
    console.error('Erro ao publicar asset:', e.response?.status, e.response?.data || e.message);
    process.exit(1);
  }
}

main();

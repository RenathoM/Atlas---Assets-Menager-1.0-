#!/usr/bin/env node
const axios = require('axios');
require('dotenv').config();

const _sanitizeEnv = v => {
  if (!v || typeof v !== 'string') return v;
  const m = v.match(/^\s*"?(.*?)"?\s*$/);
  return m ? m[1] : v;
};

const bearer = _sanitizeEnv(process.env.ROBLOX_BEARER);
const apiKey = _sanitizeEnv(process.env.ROBLOX_API_KEY);
const assetsUrl = process.env.ASSETS_API_URL || 'https://apis.roblox.com/assets/v1/assets';

async function testCredentials() {
  console.log('[Validação de Credenciais]');
  console.log(`Assets API URL: ${assetsUrl}`);
  console.log(`ROBLOX_BEARER: ${bearer ? '***' + bearer.slice(-10) : 'não definido'}`);
  console.log(`ROBLOX_API_KEY: ${apiKey ? '***' + apiKey.slice(-10) : 'não definido'}`);
  
  if (!bearer && !apiKey) {
    console.error('❌ Nenhuma credencial configurada. Defina ROBLOX_BEARER ou ROBLOX_API_KEY no .env');
    process.exit(1);
  }

  // Test 1: Simple GET request with auth to check if token is valid
  if (bearer) {
    try {
      console.log('\n[Teste 1] Validando ROBLOX_BEARER com GET /assets?creatorId=1...');
      const res = await axios.get(`${assetsUrl.replace(/\/assets$/, '')}/assets?creatorId=1`, {
        headers: { Authorization: `Bearer ${bearer}` },
        timeout: 5000
      });
      console.log('✅ Token Bearer é válido (GET bem-sucedido)');
    } catch (e) {
      if (e.response?.status === 401) {
        console.error('❌ Token Bearer inválido (401 Unauthorized)');
      } else if (e.response?.status === 403) {
        console.error('⚠️  Token Bearer existe mas sem permissão (403 Forbidden)');
      } else {
        console.warn(`⚠️  GET request falhou: ${e.response?.status || e.message}`);
      }
    }
  }

  // Test 2: Try a simple POST with minimal FormData to test upload permission
  if (bearer || apiKey) {
    try {
      console.log('\n[Teste 2] Testando POST para upload com credenciais...');
      const FormData = require('form-data');
      const form = new FormData();
      form.append('file', Buffer.from('<?xml version="1.0"?><roblox></roblox>', 'utf8'), {
        filename: 'test.rbxm',
        contentType: 'application/xml'
      });
      form.append('assetType', '13');
      form.append('name', 'TestUpload');

      const headers = { ...form.getHeaders() };
      if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
      if (apiKey) headers['x-api-key'] = apiKey;

      try {
        const len = await new Promise((resolve, reject) => 
          form.getLength((err, l) => err ? reject(err) : resolve(l))
        );
        headers['Content-Length'] = len;
      } catch (e) {
        console.warn('Aviso: Não foi possível calcular Content-Length');
      }

      const res = await axios.post(assetsUrl, form, {
        headers,
        timeout: 10000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
      console.log('✅ Upload bem-sucedido!');
      console.log(`  operationId: ${res.data?.operationId || res.data?.operation_id || 'N/A'}`);
      console.log(`  assetId: ${res.data?.assetId || 'pendente (aguardando polling)'}`);
    } catch (e) {
      if (e.response?.status === 401) {
        console.error('❌ 401 Unauthorized — token inválido ou expirado');
      } else if (e.response?.status === 403) {
        console.error('❌ 403 Forbidden — credenciais sem permissão para criar assets');
        console.error('  Verifique se a conta tem permissão para criar/editar assets');
      } else if (e.response?.status === 408) {
        console.error('❌ 408 Request Timeout — servidor aguardou corpo que não foi enviado completamente');
        console.error('  Tente novamente ou verifique conectividade/firewall');
      } else if (e.code === 'ECONNREFUSED') {
        console.error(`❌ Conexão recusada — serviço não acessível em ${assetsUrl}`);
      } else if (e.code === 'ETIMEDOUT' || e.message.includes('timeout')) {
        console.error('❌ Timeout — rede lenta ou servidor não responsivo');
      } else {
        console.error(`❌ Erro na requisição: ${e.response?.status || e.message}`);
      }
      if (e.response?.data) {
        console.error(`  Resposta: ${JSON.stringify(e.response.data).substring(0, 200)}`);
      }
    }
  }
}

testCredentials().catch(console.error);

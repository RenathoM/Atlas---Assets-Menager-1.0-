#!/usr/bin/env node
/**
 * Script para transferir propriedade de um asset para um usuário específico
 * Pode ser usado com credenciais válidas para atualizar o proprietário do asset
 * 
 * Uso:
 *   node transfer.js --assetId 63043890 --userId 1095837550
 *   
 * Com credenciais:
 *   ROBLOX_BEARER="seu_token" node transfer.js --assetId 63043890 --userId 1095837550
 */

const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
require('dotenv').config();

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('assetId', { type: 'string', demandOption: true, describe: 'ID do asset a transferir' })
    .option('userId', { type: 'string', demandOption: true, describe: 'ID do usuário para transferir' })
    .option('transferUrl', { type: 'string', describe: 'URL de transferência (override env)' })
    .help().argv;

  const assetId = argv.assetId;
  const userId = argv.userId;
  
  // URL padrão para transferência (pode variar conforme Roblox)
  const transferUrl = argv.transferUrl || process.env.TRANSFER_API_URL || 
    `https://apis.roblox.com/assets/v1/assets/${assetId}/transfer`;
  
  const bearer = process.env.ROBLOX_BEARER;
  const apiKey = process.env.ROBLOX_API_KEY;

  console.log(`\n[Asset Transfer]`);
  console.log(`Asset ID: ${assetId}`);
  console.log(`User ID: ${userId}`);
  console.log(`Transfer URL: ${transferUrl}`);
  console.log(`Credenciais: ${bearer ? 'Bearer (configurado)' : (apiKey ? 'API Key (configurado)' : 'NÃO CONFIGURADAS - modo mock')}\n`);

  // Se não houver credenciais, simular localmente
  if (!bearer && !apiKey) {
    console.warn('⚠️  Credenciais não configuradas. Modo MOCK ativado.');
    console.log('   O sistema irá simular a transferência localmente.\n');
    
    const mockResult = {
      assetId: Number(assetId),
      userId: Number(userId),
      transferredAt: new Date().toISOString(),
      status: 'transferred_mock',
      message: 'Asset transferido localmente (modo mock). Use credenciais válidas para transferência real.'
    };
    
    console.log('✅ Resultado (MOCK):');
    console.log(JSON.stringify(mockResult, null, 2));
    
    // Salvar resultado em arquivo local
    const fs = require('fs');
    const path = require('path');
    const outDir = process.env.OUT_DIR || './out';
    try {
      fs.mkdirSync(path.join(outDir, 'transfers'), { recursive: true });
      const filepath = path.join(outDir, 'transfers', `transfer-${assetId}-${userId}-${Date.now()}.json`);
      fs.writeFileSync(filepath, JSON.stringify(mockResult, null, 2), 'utf8');
      console.log(`\n📁 Resultado salvo em: ${filepath}`);
    } catch (e) {
      console.warn(`Aviso ao salvar arquivo: ${e.message}`);
    }
    
    return;
  }

  // Com credenciais, tentar transferência real
  try {
    console.log('🔄 Tentando transferência real...\n');
    
    const headers = { 'Content-Type': 'application/json' };
    let authSet = false;
    
    if (bearer) {
      let token = bearer.trim();
      if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
        token = token.slice(1, -1);
      }
      if (token.startsWith('RBX-')) {
        headers['x-api-key'] = token;
      } else {
        headers['Authorization'] = `Bearer ${token}`;
      }
      authSet = true;
    }
    
    if (apiKey) {
      let key = apiKey.trim();
      if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
        key = key.slice(1, -1);
      }
      headers['x-api-key'] = key;
      authSet = true;
    }

    if (!authSet) {
      throw new Error('Nenhuma credencial configurada corretamente');
    }

    // Tentar diferentes formatos de payload conforme API Roblox
    const payloads = [
      { userId: Number(userId) },
      { userId, assetId },
      { transferTo: Number(userId) },
      { ownerUserId: Number(userId) }
    ];

    let lastError = null;
    for (let i = 0; i < payloads.length; i++) {
      try {
        console.log(`Tentativa ${i + 1}/${payloads.length} com payload:`, payloads[i]);
        const res = await axios.post(transferUrl, payloads[i], {
          headers,
          timeout: 10000
        });
        
        console.log('✅ Transferência bem-sucedida!');
        console.log(`Status: ${res.status}`);
        console.log('Resposta:', res.data);
        
        // Salvar resultado
        const fs = require('fs');
        const path = require('path');
        const outDir = process.env.OUT_DIR || './out';
        try {
          fs.mkdirSync(path.join(outDir, 'transfers'), { recursive: true });
          const filepath = path.join(outDir, 'transfers', `transfer-${assetId}-${userId}-${Date.now()}.json`);
          fs.writeFileSync(filepath, JSON.stringify({ assetId, userId, response: res.data, transferredAt: new Date().toISOString() }, null, 2), 'utf8');
          console.log(`\n📁 Resultado salvo em: ${filepath}`);
        } catch (e) {
          console.warn(`Aviso ao salvar arquivo: ${e.message}`);
        }
        
        process.exit(0);
      } catch (e) {
        lastError = e;
        const status = e.response?.status;
        const errMsg = e.response?.data?.message || e.message;
        console.log(`❌ Tentativa ${i + 1} falhou: ${status || 'erro'} - ${errMsg}\n`);
      }
    }

    // Se chegou aqui, todas as tentativas falharam - ativar mock fallback
    console.warn('\n⚠️  Todas as tentativas de transferência falharam. Ativando modo MOCK...\n');
    
    const mockResult = {
      assetId: Number(assetId),
      userId: Number(userId),
      transferredAt: new Date().toISOString(),
      status: 'transferred_mock',
      message: 'Asset transferido localmente em modo mock. Use credenciais válidas para transferência real.'
    };
    
    console.log('✅ Resultado (MOCK):');
    console.log(JSON.stringify(mockResult, null, 2));
    
    // Salvar resultado
    const fs = require('fs');
    const path = require('path');
    const outDir = process.env.OUT_DIR || './out';
    try {
      fs.mkdirSync(path.join(outDir, 'transfers'), { recursive: true });
      const filepath = path.join(outDir, 'transfers', `transfer-${assetId}-${userId}-${Date.now()}.json`);
      fs.writeFileSync(filepath, JSON.stringify(mockResult, null, 2), 'utf8');
      console.log(`\n📁 Resultado salvo em: ${filepath}`);
    } catch (e) {
      console.warn(`Aviso ao salvar arquivo: ${e.message}`);
    }

  } catch (e) {
    console.error('❌ Erro na transferência:');
    console.error(`Status: ${e.response?.status || 'N/A'}`);
    console.error(`Mensagem: ${e.response?.data?.message || e.message}`);
    
    if (e.response?.data) {
      console.error('Resposta completa:', e.response.data);
    }
    
    console.error('\n💡 Dicas:');
    console.error('1. Verifique se ROBLOX_BEARER/ROBLOX_API_KEY são válidos');
    console.error('2. Confirme que a conta tem permissão para transferir assets');
    console.error('3. Verifique se o assetId existe e pertence à sua conta');
    console.error('4. Consulte a documentação Roblox para o endpoint correto de transferência');
    
    process.exit(1);
  }
}

main();

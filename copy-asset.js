#!/usr/bin/env node
/**
 * Script para copiar um asset pelo ID
 * Baixa o asset, converte para .rbxm, envia ao webhook e faz upload como novo asset
 * 
 * Uso:
 *   node copy-asset.js --assetId 63043890 --userId 1095837550
 *   
 * Com credenciais:
 *   ROBLOX_BEARER="seu_token" node copy-asset.js --assetId 63043890 --userId 1095837550
 */

const axios = require('axios');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
require('dotenv').config();

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('assetId', { type: 'string', demandOption: true, describe: 'ID do asset a copiar' })
    .option('userId', { type: 'string', demandOption: true, describe: 'ID do usuário destino' })
    .option('name', { type: 'string', describe: 'Name of the new asset (padrão: original + [Copy])' })
    .help().argv;

  const sourceAssetId = argv.assetId;
  const userId = argv.userId;
  let assetName = argv.name || `Asset-${sourceAssetId}-Copy`;

  const bearer = process.env.ROBLOX_BEARER;
  const apiKey = process.env.ROBLOX_API_KEY;
  const outDir = process.env.OUT_DIR || './out';

  console.log(`\n[Copy Asset]`);
  console.log(`Source Asset ID: ${sourceAssetId}`);
  console.log(`User ID (destination): ${userId}`);
  console.log(`Asset Name: ${assetName}`);
  console.log(`Credenciais: ${bearer ? 'Bearer (configurado)' : (apiKey ? 'API Key (configurado)' : 'NÃO CONFIGURADAS')}\n`);

  try {
    const Webhook = require('./webhook');
    let rbxmPath;
    
    // 1. Baixar asset via Asset Delivery API
    console.log(`📥 Baixando asset ${sourceAssetId}...`);
    const assetDeliveryUrl = process.env.ASSET_DELIVERY_URL || 
      `https://assetdelivery.roblox.com/v1/asset?id=${sourceAssetId}`;
    
    let downloadRes;
    try {
      downloadRes = await axios.get(assetDeliveryUrl, {
        responseType: 'arraybuffer',
        timeout: 15000
      });

      if (downloadRes.status !== 200) {
        throw new Error(`Asset download failed: ${downloadRes.status}`);
      }
      console.log(`✅ Asset downloaded ${sourceAssetId} via asset delivery API`);
    } catch (e) {
      console.error(`❌ Asset download failed: ${e.message}`);
      await Webhook.send('asset_copy_process_status', {
        sourceAssetId,
        userId,
        name: assetName,
        status: 'failed',
        message: `❌ Asset download failed (${e.message})`,
        steps: {
          download: '❌ Asset download failed',
          conversion: '⏭️  Skipped',
          upload: '⏭️  Skipped'
        }
      });
      throw e;
    }

    // 2. Salvar como .rbxm
    const timestamp = Date.now();
    const filename = `${sourceAssetId}-${assetName}-${timestamp}.rbxm`;
    rbxmPath = path.join(outDir, filename);
    
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(rbxmPath, downloadRes.data);
      console.log(`✅ Successfully converted to .rbxm`);
      console.log(`📁 Asset salvo em: ${rbxmPath}`);
    } catch (e) {
      console.error(`❌ Conversion failed: ${e.message}`);
      await Webhook.send('asset_copy_process_status', {
        sourceAssetId,
        userId,
        name: assetName,
        status: 'failed',
        message: `❌ Conversion to .rbxm failed (${e.message})`,
        steps: {
          download: '✅ Asset downloaded',
          conversion: '❌ Conversion failed',
          upload: '⏭️  Skipped'
        }
      });
      throw e;
    }

    // 3. Enviar webhook com arquivo anexado + informações
    try {
      await Webhook.sendFile('copy_initiated', rbxmPath, { 
        sourceAssetId, 
        userId, 
        name: assetName,
        filePath: rbxmPath,
        fileSize: downloadRes.data.length,
        content: `📄 The .rbxm asset file has been copied and is ready to be uploaded as a new asset.`
      });
      console.log(`✅ Sent webhook with attached file and asset information`);
    } catch (e) {
      console.warn(`⚠️  Failed to send webhook: ${e.message}`);
    }

    // 4. Fazer upload como novo asset
    if (!bearer && !apiKey) {
      console.warn('\n⚠️  Credenciais não configuradas. Pulando upload do novo asset.');
      console.log(`📁 Arquivo .rbxm disponível em: ${rbxmPath}\n`);
      return;
    }

    console.log(`\n📤 Fazendo upload como novo asset...`);
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

    const form = new FormData();
    form.append('file', fs.createReadStream(rbxmPath), { 
      filename: path.basename(rbxmPath), 
      contentType: 'application/xml' 
    });
    form.append('assetType', '13'); // Model type
    form.append('name', assetName);
    form.append('description', `Cópia do asset ${sourceAssetId}`);

    const formHeaders = form.getHeaders();
    const mergedHeaders = { ...headers, ...formHeaders };

    // Determine Content-Length
    try {
      const len = await new Promise((resolve, reject) => 
        form.getLength((err, l) => err ? reject(err) : resolve(l))
      );
      mergedHeaders['Content-Length'] = len;
    } catch (e) {
      // Continue without Content-Length
    }

    const assetsApiUrl = process.env.ASSETS_API_URL || 
      'https://apis.roblox.com/assets/v1/assets';

    let uploadRes;
    try {
      uploadRes = await axios.post(assetsApiUrl, form, { 
        headers: mergedHeaders,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 15000
      });

      console.log(`✅ Upload iniciado para Assets API`);
      console.log(`Status: ${uploadRes.status}`);
      console.log(`Response:`, JSON.stringify(uploadRes.data, null, 2));
      
      await Webhook.send('asset_upload_status', {
        sourceAssetId,
        status: 'initiated',
        message: `✅ Upload initiated for Assets API`,
        uploadStatus: uploadRes.status,
        operationId: uploadRes.data?.operationId || uploadRes.data?.operation_id
      });
    } catch (uploadError) {
      const errorCode = uploadError.response?.status;
      const errorMsg = uploadError.response?.data?.errors?.[0]?.message || 
                       uploadError.response?.data?.message || 
                       uploadError.message;
      
      console.error(`❌ Upload failed (${errorCode})`);
      
      await Webhook.send('asset_upload_status', {
        sourceAssetId,
        status: 'failed',
        message: `❌ Upload failed (invalid credentials ${errorCode})`,
        errorCode,
        errorMessage: errorMsg
      });
      
      throw uploadError;
    }

      // 5. Se houver operationId, fazer polling
      const operationId = uploadRes.data?.operationId || uploadRes.data?.operation_id;
      if (operationId) {
        console.log(`\n⏳ Aguardando conclusão da operação (${operationId})...`);
        const operationsBase = process.env.ASSETS_OPERATIONS_URL || 
          (process.env.ASSETS_API_URL ? process.env.ASSETS_API_URL.replace(/\/$/, '') + '/operations' 
          : 'https://apis.roblox.com/assets/v1/operations');
        const opUrl = `${operationsBase}/${operationId}`;

        let attempts = 0;
        const maxPolls = Number(process.env.MAX_OPERATION_POLLS || 40);
        const pollInterval = Number(process.env.OPERATION_POLL_INTERVAL_MS || 3000);

        while (attempts < maxPolls) {
          attempts++;
          try {
            const opRes = await axios.get(opUrl, { headers: mergedHeaders });
            const data = opRes.data;

            if (data?.assetId || data?.asset_id) {
              const newAssetId = data?.assetId || data?.asset_id;
              console.log(`✅ Novo asset criado com sucesso!`);
              console.log(`New Asset ID: ${newAssetId}`);

              // Salvar resultado
              try {
                fs.mkdirSync(path.join(outDir, 'copies'), { recursive: true });
                const resultPath = path.join(outDir, 'copies', `copy-${sourceAssetId}-${timestamp}.json`);
                const result = {
                  sourceAssetId,
                  newAssetId,
                  userId,
                  name: assetName,
                  rbxmPath,
                  createdAt: new Date().toISOString()
                };
                fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
                console.log(`\n📁 Resultado salvo em: ${resultPath}`);
              } catch (e) {
                console.warn(`Aviso ao salvar resultado: ${e.message}`);
              }

              // Enviar webhook de conclusão
              try {
                await Webhook.send('asset_copy_completed', {
                  sourceAssetId,
                  newAssetId,
                  userId,
                  name: assetName,
                  status: 'success',
                  message: `✅ Asset copy completed successfully (${sourceAssetId} → ${newAssetId})`
                });
              } catch (e) {
                console.warn(`Aviso ao enviar webhook final: ${e.message}`);
              }

              return;
            }

            if (data?.status && String(data.status).toLowerCase() === 'failed') {
              throw new Error('Operação reportou falha');
            }

            console.log(`  Tentativa ${attempts}/${maxPolls}: operação ainda em processamento...`);
          } catch (e) {
            console.warn(`  Poll error: ${String(e?.message || e)}`);
          }

          await new Promise(r => setTimeout(r, pollInterval));
        }

        throw new Error('Operação não completou no tempo limite');
      }

      // Salvar resultado
      try {
        fs.mkdirSync(path.join(outDir, 'copies'), { recursive: true });
        const resultPath = path.join(outDir, 'copies', `copy-${sourceAssetId}-${timestamp}.json`);
        const result = {
          sourceAssetId,
          userId,
          name: assetName,
          rbxmPath,
          response: uploadRes.data,
          createdAt: new Date().toISOString()
        };
        fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
        console.log(`\n📁 Resultado salvo em: ${resultPath}`);
      } catch (e) {
        console.warn(`Aviso ao salvar resultado: ${e.message}`);
      }

  } catch (e) {
    console.error('❌ Erro ao copiar asset:');
    console.error(`Status: ${e.response?.status || 'N/A'}`);
    console.error(`Mensagem: ${e.response?.data?.message || e.message}`);

    if (e.response?.data) {
      console.error('Resposta completa:', JSON.stringify(e.response.data, null, 2));
    };

   // try {
    //  const Webhook = require('./webhook');
     // await Webhook.send('asset_copy_failed', {
     //   sourceAssetId,
     //   status: 'failed',
      //  message: `❌ Asset copy process failed`,
       // errorCode: e.response?.status || 'unknown',
       // errorMessage: e.response?.data?.message || e.message
     // };);
    //} catch (webhookErr) {
    //  console.warn(`Aviso ao enviar webhook de erro: ${webhookErr.message}`);
   // }

    console.error('\n💡 Dicas:');
    console.error('1. Verifique se ROBLOX_BEARER/ROBLOX_API_KEY são válidos');
    console.error('2. Confirme que o assetId existe (teste em https://www.roblox.com/catalog/');
    console.error('3. Verifique permissões da conta para fazer upload');
    console.error('4. Observe o arquivo .rbxm mesmo se o upload falhar');

    process.exit(1);
  }
}

main();

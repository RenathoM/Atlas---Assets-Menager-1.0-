# Asset Transfer Guide

## Visão Geral

O sistema suporta transferência de assets Roblox para usuários específicos de duas formas:

1. **Via HTTP Endpoint** (`POST /transfer`) - para integração com Roblox
2. **Via CLI Script** (`node transfer.js`) - para uso direto/automação

Ambas suportam **fallback automático para modo mock** quando credenciais não estão disponíveis.

## Uso via HTTP Endpoint

### Transferir um asset para um usuário

```bash
curl -X POST 'http://localhost:3000/transfer' \
  -H 'Content-Type: application/json' \
  -H 'x-bridge-secret: SEU_EXPERIENCE_SECRET' \
  -d '{
    "assetId": "792330",
    "userId": "1095837550"
  }'
```

**Resposta (modo mock):**
```json
{
  "assetId": 792330,
  "userId": 1095837550,
  "transferredAt": "2025-12-25T21:05:54.699Z",
  "status": "transferred_mock",
  "message": "Asset transferido em modo mock (credenciais inválidas ou não configuradas)"
}
```

**Resposta (com credenciais válidas):**
```json
{
  "assetId": 792330,
  "userId": 1095837550,
  "transferredAt": "2025-12-25T21:05:54.699Z",
  "status": "transferred",
  "response": { /* resposta da API Roblox */ }
}
```

### Parâmetros

| Parâmetro | Tipo | Requerido | Descrição |
|-----------|------|----------|-----------|
| `assetId` | string/number | ✅ | ID do asset a transferir |
| `userId` | string/number | ✅ | ID do usuário para transferir |

### Headers

| Header | Valor |
|--------|-------|
| `Content-Type` | `application/json` |
| `x-bridge-secret` | `SEU_EXPERIENCE_SECRET` |

## Uso via CLI Script

### Transferir um asset (com credenciais)

```bash
ROBLOX_BEARER="seu_token" node transfer.js --assetId 792330 --userId 1095837550
```

### Transferir um asset (sem credenciais - modo mock)

```bash
node transfer.js --assetId 792330 --userId 1095837550
```

### Opções

```bash
node transfer.js --help

Opções:
  --assetId       ID do asset (requerido)
  --userId        ID do usuário (requerido)
  --transferUrl   URL de transferência customizada (opcional)
  --help          Mostrar ajuda
```

### Exemplos

**Exemplo 1: Transferir com credenciais**
```bash
export ROBLOX_BEARER="RBX-abc123..."
node transfer.js --assetId 259423244 --userId 1095837550
```

**Exemplo 2: Transferir em lote (via shell)**
```bash
for userId in 1095837550 2345678901 3456789012; do
  node transfer.js --assetId 259423244 --userId $userId
done
```

**Exemplo 3: Usar em script Node.js**
```javascript
const axios = require('axios');

async function transferAsset(assetId, userId) {
  const response = await axios.post('http://localhost:3000/transfer', 
    { assetId, userId },
    { headers: { 'x-bridge-secret': process.env.EXPERIENCE_SECRET } }
  );
  return response.data;
}

// Usar
transferAsset(792330, 1095837550).then(result => {
  console.log('Status:', result.status);
});
```

## Fluxo Completo: Upload + Transfer

### 1. Fazer upload de um asset

```bash
# Upload do asset 259423244
curl -X POST 'http://localhost:3000/upload' \
  -H 'Content-Type: application/json' \
  -H 'x-bridge-secret: 0132794856147' \
  -d '{"baseAssetId": 259423244}'
```

Resposta:
```json
{
  "status": "queued",
  "jobId": 17,
  "_localPath": "out/BlackSparkleTimeFedora-Asset259423244.rbxm"
}
```

### 2. Aguardar conclusão e obter novo assetId

```bash
# Aguardar processamento
sleep 2

# Obter novo assetId
curl -s http://localhost:3000/queue/17 | jq '.response.assetId'
# Retorna: 791110
```

### 3. Transferir para usuário

```bash
curl -X POST 'http://localhost:3000/transfer' \
  -H 'Content-Type: application/json' \
  -H 'x-bridge-secret: 0132794856147' \
  -d '{
    "assetId": 791110,
    "userId": 1095837550
  }'
```

## Persistência

Todos os resultados de transferência são salvos em:

```
OUT_DIR/transfers/
├── transfer-<assetId>-<userId>-<timestamp>.json      # Sucesso
├── transfer-<assetId>-<userId>-error-<timestamp>.json # Erro
```

Exemplo:
```json
{
  "assetId": 792330,
  "userId": 1095837550,
  "transferredAt": "2025-12-25T21:05:54.699Z",
  "status": "transferred_mock",
  "message": "Asset transferido em modo mock..."
}
```

## Modo Mock Automático

O sistema **ativa automaticamente o modo mock** quando:

- ✅ Credenciais não estão configuradas (`ROBLOX_BEARER` ou `ROBLOX_API_KEY`)
- ✅ Credenciais são inválidas (401/403/404)
- ✅ API Roblox não está acessível

No modo mock:
- ✅ Asset é "transferido" localmente
- ✅ Resultado é persistido em arquivo
- ✅ Webhook é notificado com status `transferred_mock`
- ✅ Aplicação continua funcionando

## Com Credenciais Válidas

Para usar transferências reais, configure:

```bash
export ROBLOX_BEARER="seu_token_aqui"
# ou
export ROBLOX_API_KEY="seu_api_key_aqui"
```

Em `.env`:
```env
ROBLOX_BEARER=seu_token_aqui
# ou
ROBLOX_API_KEY=seu_api_key_aqui
```

O sistema tentará diferentes formatos de payload automaticamente:
1. `{ userId: <id> }`
2. `{ userId, assetId }`
3. `{ transferTo: <id> }`
4. `{ ownerUserId: <id> }`

## Webhook Notifications

Eventos enviados ao webhook:

| Evento | Quando |
|--------|--------|
| `transfer_requested` | Requisição de transferência recebida |
| `transfer_completed` | Transferência real bem-sucedida |
| `transfer_completed_mock` | Transferência em modo mock |
| `transfer_failed` | Erro na transferência |

Exemplo de evento:
```json
{
  "event": "transfer_completed_mock",
  "data": {
    "assetId": 792330,
    "userId": 1095837550,
    "transferredAt": "2025-12-25T21:05:54.699Z",
    "status": "transferred_mock"
  }
}
```

## Troubleshooting

| Problema | Causa | Solução |
|----------|-------|---------|
| Status `transferred_mock` | Credenciais inválidas/não configuradas | Atualizar `.env` com credenciais válidas |
| Status `transfer_failed` | API Roblox retorna erro | Verificar assetId, userId e permissões |
| 401 Unauthorized | Token expirado | Renovar `ROBLOX_BEARER` |
| 403 Forbidden | Sem permissão | Verificar escopos da conta |
| 404 Not Found | AssetId não existe | Confirmar que o asset pertence à conta |

## Integração com Roblox (Lua)

```lua
local HttpService = game:GetService("HttpService")

local function transferAsset(assetId, userId)
  local url = "https://seu-bridge-url/transfer"
  local payload = {
    assetId = tostring(assetId),
    userId = tostring(userId)
  }
  
  local response = HttpService:RequestAsync({
    Url = url,
    Method = "POST",
    Headers = {
      ["Content-Type"] = "application/json",
      ["x-bridge-secret"] = "SEU_EXPERIENCE_SECRET"
    },
    Body = HttpService:JSONEncode(payload)
  })
  
  if response.Success then
    local result = HttpService:JSONDecode(response.Body)
    print("Transferência:", result.status)
  else
    warn("Erro na transferência:", response.StatusCode)
  end
end

-- Usar
transferAsset(792330, 1095837550)
```

## Segurança

⚠️ **Importante:**
- ✅ Credenciais são mascaradas em logs
- ✅ `.env` nunca deve ser comitado
- ✅ `EXPERIENCE_SECRET` é obrigatório em produção
- ✅ Use HTTPS em produção
- ✅ Webhook URLs devem ser protegidas

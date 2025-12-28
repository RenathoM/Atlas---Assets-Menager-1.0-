# Roblox Assets Bridge

Servidor simples que atua como ponte para receber um JSON do jogo, converter para o formato `.rbxm` e enviar para a Assets API do Roblox.

## Uso rápido

- Instale dependências:

```bash
npm install
```

- Variáveis de ambiente esperadas em `.env`:

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `ROBLOX_BEARER` | Token ou API Key (RBX-*) para autenticação | — |
| `ROBLOX_API_KEY` | Chave de API alternativa (header `x-api-key`) | — |
| `ASSET_TYPE` | Tipo de asset (ex: 13 para models) | `13` |
| `PORT` | Porta do servidor | `3000` |
| `OUT_DIR` | Diretório para salvar `.rbxm` gerados | `./out` |
| `EXPERIENCE_SECRET` | Segredo compartilhado com a experiência Roblox | — |
| `EXPERIENCE_ID` | ID da experiência Roblox (opcional, usado para validação/exibição) | `94319257727040` |
| `DISCORD_WEBHOOK_URL` | Webhook para notificações | — |
| `AUTO_PUBLISH` | Publicar asset automaticamente após upload | `false` |

- Rodar servidor:

```bash
npm start
```

## Autenticação

O bridge suporta dois tipos de autenticação:

1. **Bearer Token**: tokens que começam com algo diferente de `RBX-` (ex: JWT, OAuth)
   - Usado no header: `Authorization: Bearer <token>`

2. **API Key (RBX-*)**: tokens Roblox que começam com `RBX-`
   - Usado no header: `x-api-key: <token>`

**Fallback automático**: Se as credenciais forem inválidas (401/403), o bridge ativa automaticamente o **modo mock** e retorna um `assetId` simulado. Isso permite que você desenvolva/teste sem credenciais reais.

## Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/upload` | Recebe JSON e enfileira conversão/upload para Assets API |
| `GET` | `/upload?dry=true` | Retorna `.rbxm` gerado (sem upload) |
| `POST` | `/upload?mock=true` | Enfileira job em modo mock (simula upload bem-sucedido) |
| `GET` | `/` | Checagem simples do serviço |
| `GET` | `/health` | Status da fila, credenciais (mascaradas) e configuração |
| `GET` | `/queue` | Lista todos os jobs em fila |
| `GET` | `/queue/:id` | Detalhes de um job específico |

## Modos de Upload

### 1. Conversão JSON → .rbxm (padrão)

```bash
curl -X POST http://localhost:3000/upload \
  -H "Content-Type: application/json" \
  -H "x-bridge-secret: SEU_EXPERIENCE_SECRET" \
  -d '{
    "name": "MeuModelo",
    "properties": { "Name": "MeuModelo" }
  }'
```

Resposta:
```json
{
  "status": "queued",
  "jobId": 1,
  "_localPath": "out/1766696145092-MeuModelo.rbxm"
}
```

### 2. Usar asset existente como base (baseAssetId)

```bash
curl -X POST http://localhost:3000/upload \
  -H "Content-Type: application/json" \
  -H "x-bridge-secret: SEU_EXPERIENCE_SECRET" \
  -d '{"baseAssetId": 3087133362}'
```

O bridge baixará o `.rbxm` original, renomeará para `<AssetName>-Model-<ts>.rbxm` e enfileirará o upload.

### 3. Teste seco (retorna .rbxm sem upload)

```bash
curl "http://localhost:3000/upload?dry=true" \
  -H "Content-Type: application/json" \
  -H "x-bridge-secret: SEU_EXPERIENCE_SECRET" \
  -d '{"name": "Teste"}' \
  > teste.rbxm
```

### 4. Modo mock (testes sem credenciais reais)

```bash
curl "http://localhost:3000/upload?mock=true" \
  -H "Content-Type: application/json" \
  -H "x-bridge-secret: SEU_EXPERIENCE_SECRET" \
  -d '{"name": "TesteMock"}'
```

Resposta (com assetId gerado localmente):
```json
{
  "status": "mocked",
  "jobId": 13,
  "assetId": 374292
}
```

## Fluxo completo de upload

1. **Enfileiramento** (`POST /upload`) → arquivo `.rbxm` é salvo em `OUT_DIR`
2. **Webhook**: evento `job_enqueued` + arquivo anexado
3. **Upload para Assets API** → polling de `operationId` até obter `assetId`
4. **Webhook**: evento `job_succeeded` + arquivo anexado + `asset_summary`
5. **Persistência**: resposta salva em `OUT_DIR/success/job-<id>-response.json`
6. **(Opcional) Publicação automática** → se `AUTO_PUBLISH=true` e `PUBLISH_API_URL` configurada

## Webhook e Auditoria

Eventos enviados ao webhook:

- `request_received` — requisição chegou
- `dry_run` — teste seco completado + arquivo anexado
- `job_enqueued` — job na fila + arquivo anexado
- `base_asset_downloaded` — asset base baixado com sucesso
- `base_asset_failed` — falha ao baixar asset base
- `operation_update` — progresso do polling
- `job_succeeded` — upload bem-sucedido + arquivo anexado + `asset_summary`
- `job_succeeded_mock` — mock ativado automaticamente (credenciais inválidas)
- `job_failed` — upload falhou + arquivo anexado + `asset_summary`
- `publish_started` / `publish_succeeded` / `publish_failed` — status da publicação automática

## Persistência e Auditoria

O bridge salva automaticamente:

| Caminho | Conteúdo |
|---------|----------|
| `OUT_DIR/<name>-<ts>.rbxm` | Arquivo `.rbxm` gerado |
| `OUT_DIR/success/job-<id>-response.json` | Resposta da Assets API |
| `OUT_DIR/errors/job-<id>-error.json` | Corpo do erro (403, 408, etc) |
| `OUT_DIR/webhook_logs/webhook-<ts>.json` | Log de eventos enviados ao webhook |
| `queue.json` | Estado persistido da fila (survives restarts) |

## Retry e Tratamento de Erros

- **Retentativas exponenciais**: 5s → 10s → 20s (máximo 3 tentativas por padrão)
- **408 (Timeout)**: causado por FormData com reuso de streams; resolvido reconstruindo FormData por tentativa
- **401/403 (Autenticação)**: ativa **fallback automático para modo mock**
- **Polling de operação**: até 40 polls (máximo 120s de espera por padrão)

## Publicação Automática

Se `AUTO_PUBLISH=true`, após o polling obter um `assetId`, o bridge automaticamente:

1. (Opcional) Verifica `ALLOWLIST_ASSET_IDS` se configurada
2. Faz POST para `PUBLISH_API_URL` com `{ assetId, makePublic: true }`
3. Envia webhooks de status

Exemplo de setup:

```bash
export AUTO_PUBLISH=true
export PUBLISH_API_URL="https://apis.roblox.com/marketplace/v1/assets/{assetId}/publish"
export ALLOWLIST_ASSET_IDS="123456,789012"
export ROBLOX_BEARER="seu_token_ou_rbx_api_key"
```

## Conectar a Experiência Roblox

No servidor Roblox (Server Script):

```lua
local HttpService = game:GetService("HttpService")

local function uploadModel()
  local payload = {
    name = "MeuModelo",
    properties = { Name = "MeuModelo" },
    children = {
      -- parts, models, etc
    }
  }
  
  local response = HttpService:RequestAsync({
    Url = "https://seu-bridge-url/upload", -- HTTPS obrigatório em produção
    Method = "POST",
    Headers = {
      ["Content-Type"] = "application/json",
      ["x-bridge-secret"] = "SEU_EXPERIENCE_SECRET",
      ["x-experience-id"] = "94319257727040" -- (opcional) enviar o ID da experiência
    },
    Body = HttpService:JSONEncode(payload)
  })
  
  if response.Success then
    local result = HttpService:JSONDecode(response.Body)
    print("Job enfileirado:", result.jobId)
  else
    warn("Erro no bridge:", response.StatusCode)
  end
end

uploadModel()
```

## Receber sinal da experiência (asset callback)

Se sua experiência precisa notificar o bridge informando apenas um `assetId`, use o endpoint `/experience_signal`.

Exemplo de chamada da experiência (Server Script):

```lua
local HttpService = game:GetService("HttpService")

local payload = {
  assetId = 3087133362,
  callbackUrl = "https://your-experience-endpoint/receive-asset-response" -- opcional
}

local response = HttpService:RequestAsync({
  Url = "https://seu-bridge-url/experience_signal",
  Method = "POST",
  Headers = {
    ["Content-Type"] = "application/json",
    ["x-bridge-secret"] = "SEU_EXPERIENCE_SECRET",
    ["x-experience-id"] = "94319257727040"
  },
  Body = HttpService:JSONEncode(payload)
})

if response.Success then
  print("Bridge response:", response.Body)
else
  warn("Erro ao notificar bridge:", response.StatusCode, response.Body)
end
```

Comportamento do bridge:

- Baixa o `.rbxm` do `assetId` informado (usando `ASSET_DELIVERY_URL`).
- Salva o `.rbxm` em `OUT_DIR` e anexa o arquivo ao webhook (`experience_asset_saved`).
- Se `callbackUrl` for fornecido, o bridge fará um `POST` para essa URL com JSON contendo `assetId`, `localPath` e `rbxmBase64` (conteúdo do arquivo codificado em base64).
- Se `callbackUrl` não for informado, o bridge responde diretamente com o conteúdo `.rbxm` (Content-Type: `application/xml`).


## Health Check

```bash
curl http://localhost:3000/health | jq .
```

Retorna:
```json
{
  "status": "ok",
  "timestamp": "2025-12-25T20:53:21.308Z",
  "queue": [
    { "id": 1, "status": "done", "attempts": 1, ... },
    { "id": 2, "status": "queued", "attempts": 0, ... }
  ],
  "credentials": {
    "bearer": "***OWB_p",
    "apiKey": "not set"
  },
  "config": {
    "outDir": "./out",
    "assetsApiUrl": "https://apis.roblox.com/assets/v1/assets",
    "autoPublish": true
  }
}
```

## Troubleshooting

| Erro | Causa | Solução |
|------|-------|---------|
| `401 Unauthorized` | Token inválido/expirado | Atualizar `ROBLOX_BEARER`; system auto-mocks em fallback |
| `403 Forbidden` | Credenciais sem permissão | Verificar escopos da conta Roblox |
| `408 Request Timeout` | Upload incompleto | Renovar tentativa (sistema já trata) |
| `/health` mostra `apiKey: undefined` | Variável não definida | Adicionar em `.env` se necessário |
| Webhook não recebe eventos | URL incorreta ou rate-limited | Verificar `DISCORD_WEBHOOK_URL`; aguardar reset |

## Variáveis Avançadas

```bash
# Polling de operação
OPERATION_POLL_INTERVAL_MS=3000    # intervalo entre polls
MAX_OPERATION_POLLS=40             # máximo de tentativas

# Assets API
ASSETS_API_URL=https://apis.roblox.com/assets/v1/assets
ASSET_DELIVERY_URL=https://assetdelivery.roblox.com/v1/asset?id=
ASSETS_OPERATIONS_URL=https://apis.roblox.com/assets/v1/operations

# Fila
QUEUE_PERSIST_PATH=./queue.json
MAX_RETRIES=3
RETRY_DELAY_MS=5000
```

## Segurança

- ✅ Credenciais mascaradas em `/health` (mostra apenas `***suffix`)
- ✅ Arquivo `.env` deve ter permissões restritas (`chmod 600`)
- ✅ Sempre use HTTPS em produção (webhook + experiência)
- ✅ `EXPERIENCE_SECRET` obrigatório para validar requests
- ⚠️ Não comite `.env` ou tokens no Git

## Notas Finais

- O bridge suporta desenvolvimento local (localhost) e produção (HTTPS com domínio)
- Em modo mock (fallback automático), o job é marcado como `done` com `assetId` simulado
- Todos os arquivos gerados são salvos em `OUT_DIR` para auditoria/debug
- Webhooks retentam automaticamente se a URL estiver temporariamente indisponível

  "children": [
    {
      "class": "Part",
      "properties": { "Name": "Parte1", "Position": { "x": 0, "y": 5, "z": 0 } }
    }
  ]
}
```

O conversor é simples: converte `properties` para tags XML conforme o tipo (string, number, bool, Vector3). Ajuste `rbxmConverter.js` conforme suas necessidades de formato mais avançado.

# Roblox Assets Bridge

Servidor simples que atua como ponte para receber um JSON do jogo, converter para o formato `.rbxm` e enviar para a Assets API do Roblox.

Uso rápido

- Instale dependências:

```bash
npm install
```

- Variáveis de ambiente esperadas:

- `ROBLOX_BEARER` — token Bearer (opcional, usado para `Authorization: Bearer ...`).
- `ROBLOX_API_KEY` — chave de API (opcional, enviada em `x-api-key`).
- `ASSET_TYPE` — tipo de asset a enviar (padrão `13`).
- `PORT` — porta do servidor (padrão `3000`).
 - `OUT_DIR` — diretório onde os .rbxm gerados serão salvos (padrão `./out`).

Modos

- `?dry=true` no endpoint `/upload` — retorna o `.rbxm` gerado no corpo da resposta (Content-Type: application/xml) e não faz upload.

O servidor sempre salvará o `.rbxm` gerado em `OUT_DIR` para auditoria/debug.

- Rodar servidor:

```bash
npm start
```

Endpoint

- `POST /upload` — recebe JSON no corpo e tenta enviar para `https://apis.roblox.com/assets/v1/assets`.

- `GET /` — checagem simples do serviço.

Enfileiramento e retries

O servidor implementa um enfileirador simples que reenvia uploads com falhas transientes.

- `MAX_RETRIES` — número máximo de tentativas (padrão `3`).
- `RETRY_DELAY_MS` — atraso entre tentativas em ms (padrão `5000`).

Conectar a experiência Roblox

1. Defina um segredo compartilhado no servidor:

- `EXPERIENCE_SECRET` — segredo que a experiência usará para autenticar requests (env).

2. Na experiência Roblox (server-side Script), use `HttpService:RequestAsync` para enviar o JSON ao bridge. Exemplo:

```lua
local HttpService = game:GetService("HttpService")
local url = "https://SEU_BRIDGE/upload" -- substitua pelo endpoint público
local payload = {
  name = "MeuModelo",
  class = "Model",
  properties = { Name = "MeuModelo" },
}

local body = HttpService:JSONEncode(payload)

local response = HttpService:RequestAsync({
  Url = url,
  Method = "POST",
  Headers = {
    ["Content-Type"] = "application/json",
    ["x-bridge-secret"] = "SEU_EXPERIENCE_SECRET"
  },
  Body = body,
})

if response.Success then
  print("Bridge response:", response.StatusCode, response.Body)
else
  warn("Erro ao chamar bridge:", response.StatusCode, response.Body)
end
```

3. Em desenvolvimento, exponha seu servidor com HTTPS (ngrok ou similar) e use o URL público na experiência. Em produção, hospede o bridge em um servidor HTTPS confiável.

4. O bridge grava sempre o `.rbxm` gerado em `OUT_DIR` e enfileira uploads reais para a Assets API. Garanta que `ROBLOX_BEARER` ou `ROBLOX_API_KEY` estejam configurados no bridge para autenticar chamadas à Assets API.

Inspeção da fila

Endpoints adicionais para monitorar a fila de uploads:

- `GET /queue` — lista jobs em fila (id, status, attempts, createdAt, serialized).
- `GET /queue/:id` — detalhes de um job (inclui resposta do upload se já realizado).

O bridge persiste a fila em `queue.json` por padrão (`QUEUE_PERSIST_PATH` para customizar), permitindo que jobs sobrevivam a reinícios.

Webhook Discord

O bridge pode enviar notificações detalhadas para um webhook do Discord sobre eventos:

- `request_received` — quando uma requisição é recebida (inclui `name`, `assetType` e `payload` truncado).
- `request_rejected` — quando uma requisição é rejeitada por autenticação inválida.
- `dry_run` — quando `?dry=true` é usado (inclui trecho do `.rbxm`).
 - `dry_run` — quando `?dry=true` é usado (inclui trecho do `.rbxm`).

Envio de arquivo `.rbxm` ao webhook

O bridge agora anexa o arquivo `.rbxm` gerado ao webhook (multipart/form-data) nos eventos de enfileiramento, sucesso e falha (`job_enqueued_file`, `job_succeeded_file`, `job_failed_file`). Isso permite auditoria/segurança centralizada. Os arquivos também são persistidos localmente em `OUT_DIR`:

- Arquivos gerados: `OUT_DIR/<timestamp>-<name>.rbxm`
- Erros: `OUT_DIR/errors/job-<id>-error.json` (conteúdo do corpo de resposta da API)
- Sucessos: `OUT_DIR/success/job-<id>-response.json` (resposta do upload)

Garanta que o webhook aceite anexos e que suas credenciais/URL estejam protegidas.
- `job_enqueued` — quando um job é colocado na fila.
- `job_succeeded` / `job_failed` — resultados do processamento do job.

Defina `DISCORD_WEBHOOK_URL` para alterar o webhook (por padrão o bridge usa o webhook fornecido pelo administrador). O webhook truncará automaticamente campos muito grandes.

Fluxo completo de criação de modelo

1. A experiência envia `POST /upload` ao bridge com um JSON. O payload pode incluir `baseAssetId` (um asset .rbxm existente) ou o conteúdo para gerar um `.rbxm` via `properties` e `children`.
2. Se `baseAssetId` for fornecido, o bridge baixa o `.rbxm` original da Asset Delivery API (`ASSET_DELIVERY_URL`), salva em `OUT_DIR` e usa esse arquivo como fonte.
3. O bridge então envia o arquivo para a Assets API (`ASSETS_API_URL`) via `POST` multipart/form-data. A resposta inicial frequentemente contém um `operationId`.
4. Quando `operationId` é retornado, o bridge faz polling no endpoint de operações (`ASSETS_OPERATIONS_URL`) até receber o `assetId` final (ou até expirar). Você pode configurar `OPERATION_POLL_INTERVAL_MS` e `MAX_OPERATION_POLLS`.
5. O novo asset geralmente nasce como privado. Para disponibilizar o modelo para jogadores permanentemente, é necessário publicar o asset / criar um pacote ou usar APIs adicionais da Roblox que promovam/compartilhem o asset (não coberto automaticamente por este bridge). O bridge reportará o `assetId` via webhook quando estiver pronto.

Variáveis de ambiente adicionais

- `ASSET_DELIVERY_URL` — template para baixar assets, padrão `https://assetdelivery.roblox.com/v1/asset?id=`.
- `ASSETS_OPERATIONS_URL` — base para checar operações (padrão derivado de `ASSETS_API_URL` + `/operations`).
- `OPERATION_POLL_INTERVAL_MS` — intervalo entre polls de operação (padrão `3000`).
- `MAX_OPERATION_POLLS` — número máximo de polls antes de considerar falha (padrão `40`).

Publicação automática (opcional)

Se desejar que o bridge publique automaticamente o asset assim que `assetId` estiver disponível, configure:

- `AUTO_PUBLISH=true` — habilita publicação automática.
- `PUBLISH_API_URL` — URL template para publicação, deve incluir `{assetId}`. Ex: `https://apis.roblox.com/marketplace/v1/assets/{assetId}/publish` (substitua pelo endpoint correto da sua conta).

Allowlist e controle de publicação

Você pode limitar quais assets são automaticamente publicados definindo `ALLOWLIST_ASSET_IDS` (ou `ASSET_ALLOWLIST`) como uma lista separada por vírgulas de `assetId` permitidos. Se a allowlist estiver configurada e o `assetId` não estiver nela, o bridge pulará a publicação automática e registrará no job que foi pulado.

Exemplo:

```bash
export ALLOWLIST_ASSET_IDS="123456,987654"
export AUTO_PUBLISH=true
export PUBLISH_API_URL="https://apis.roblox.com/marketplace/v1/assets/{assetId}/publish"
```

O `queue.json` armazenará campos relacionados à publicação no job, incluindo `publishStartedAt`, `publishCompletedAt`, `published` (resposta), e `publishError` quando ocorrer.

O bridge fará POST para `PUBLISH_API_URL` com um corpo JSON `{ "assetId": "...", "makePublic": true }` e enviará webhooks `publish_started`, `publish_succeeded` ou `publish_failed` conforme o resultado.

Importante: publicar automaticamente requer permissões apropriadas (credenciais com escopo/privilegios). Use `ROBLOX_BEARER` ou `ROBLOX_API_KEY` com cautela.

Publicar asset em um passo separado

Depois que o bridge obtiver um `assetId` final via polling, você pode publicar/compartilhar o asset para que ele fique disponível permanentemente para jogadores. O Roblox possui endpoints específicos e permissões requeridas para isso; estes endpoints podem variar conforme sua conta/escopo. A abordagem segura aqui é usar um script separado que você execute com credenciais administrativas.

Incluí um script de exemplo `publish.js` que realiza uma requisição configurável para um endpoint de publicação. Ele não assume um endpoint rígido — você deve fornecer a URL correta (via `PUBLISH_API_URL` env ou `--publishUrl`) e as credenciais (`ROBLOX_BEARER` ou `ROBLOX_API_KEY`).

Exemplo: executar localmente

```bash
export ROBLOX_BEARER="seu_token"
export PUBLISH_API_URL="https://apis.roblox.com/marketplace/v1/assets/{assetId}/publish" # exemplo, substitua pela URL correta
node publish.js --assetId 123456
```

Observações importantes

- Os detalhes (método HTTP, payload) dependem do endpoint real que sua organização/conta possui — consulte a documentação da Roblox ou o suporte para saber qual endpoint usar para publicar um asset para inventário.
- O script `publish.js` é um utilitário genérico: modifica `publishUrl` ou o corpo conforme necessário para o endpoint específico.
- Para automação total dentro do bridge, posso integrar uma chamada automática para `publish.js` após o polling bem-sucedido, mas isso implica escopos/credenciais com maior privilégio — confirme se deseja essa automação.

Configurar `ROBLOX_BEARER` (modo guiado)

Você pode configurar o token localmente usando o script seguro `set-secret.sh` que grava `.env` com permissão restrita:

```bash
chmod +x set-secret.sh
./set-secret.sh
# Depois, reinicie o bridge ou carregue as variáveis com:
export $(cat .env | sed -E 's/^([^=]+)=(.*)$/\1=\2/' )
```

Também existe `.env.example` com todas as variáveis mostradas para referência.




Formato JSON esperado (exemplo mínimo):

```json
{
  "name": "MeuModelo",
  "class": "Model",
  "properties": { "Name": "MeuModelo" },
  "children": [
    {
      "class": "Part",
      "properties": { "Name": "Parte1", "Position": { "x": 0, "y": 5, "z": 0 } }
    }
  ]
}
```

O conversor é simples: converte `properties` para tags XML conforme o tipo (string, number, bool, Vector3). Ajuste `rbxmConverter.js` conforme suas necessidades de formato mais avançado.

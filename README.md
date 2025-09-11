# Here are your Instructions

 codex/replace-origin-configuration-with-allowed_origins
## Configuração do `ALLOWED_ORIGINS`

O serviço `baileys_service` permite definir origens autorizadas para requisições CORS através da variável de ambiente `ALLOWED_ORIGINS`.

- Para especificar origens, defina `ALLOWED_ORIGINS` como uma lista separada por vírgulas:

```bash
export ALLOWED_ORIGINS="http://localhost:3000,http://example.com"
node baileys_service/server.js
```

- Se `ALLOWED_ORIGINS` não for definida, todas as origens serão aceitas.


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

## Definição do `API_BASE_URL`

Quando o frontend e o serviço estiverem em máquinas diferentes,
defina a variável global `window.API_BASE_URL` **antes** de
chamar `loadInstanceGroups` para que o frontend saiba onde encontrar o
serviço.

```html
<script>
  window.API_BASE_URL = "http://meu-servidor:3002";
</script>
```

Se `window.API_BASE_URL` não for definida, o frontend tentará se conectar
a `http://${window.location.hostname}:3002` por padrão.

Alternativamente, o servidor pode injetar esse valor definindo a variável de
ambiente `API_BASE_URL`. Quando presente, o frontend recebe
automaticamente `window.API_BASE_URL` com o valor informado.

```bash
export API_BASE_URL="http://meu-servidor:3002"
python3 whatsflow-real.py
```


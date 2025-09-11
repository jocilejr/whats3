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

## Definição do `window.BAILEYS_URL`

Quando o frontend e o serviço Baileys estiverem em máquinas diferentes,
é obrigatório definir a variável global `window.BAILEYS_URL` **antes** de
chamar `loadInstanceGroups` para que o frontend saiba onde encontrar o
serviço.

```html
<script>
  window.BAILEYS_URL = "http://meu-servidor-de-baileys:3002";
</script>
```

Se `window.BAILEYS_URL` não for definida, o frontend tentará se conectar
a `http://${window.location.hostname}:3002` por padrão.


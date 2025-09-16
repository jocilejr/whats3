# Here are your Instructions

## Dependências Python (WhatsFlow Real)

A versão real do WhatsFlow requer a biblioteca [`minio`](https://pypi.org/project/minio/)
para realizar uploads ao servidor de arquivos. Antes de executar
`whatsflow-real.py`, instale essa dependência manualmente:

```bash
python3 -m pip install minio
```

Se o pacote não estiver disponível, o aplicativo exibirá um erro orientando a
instalação manual.

## CORS liberado

O serviço `baileys_service` e os demais servidores utilizam `cors` com
`"*"` em todas as permissões. Assim, qualquer domínio pode realizar
requisições sem necessidade de configurar variáveis de ambiente ou
ajustes adicionais.

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


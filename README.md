# Here are your Instructions

## Configuração da URL do Baileys

Para utilizar um serviço Baileys externo em produção, defina a variável de ambiente `BAILEYS_URL` antes de iniciar o servidor:

```bash
export BAILEYS_URL="http://seu-servidor-baileys:3002"
python3 whatsflow-real.py
```

Se a variável não for informada, o endereço padrão será construído a partir de `window.location.hostname` usando a porta `3002`.

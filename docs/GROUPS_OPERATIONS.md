# Gerenciamento de Grupos via Baileys Service

Este documento descreve como utilizar os novos recursos de grupos expostos pelo
serviço Node (`baileys_service`). Todas as rotas estão protegidas por validações
de conexão e de permissão para garantir que apenas instâncias conectadas e com
privilegios de administrador executem ações sensíveis.

## Cache de metadados

- Cada instância mantém um cache em memória com os metadados de grupos
  (`subject`, `description`, `participants`, configurações etc.).
- O cache é preenchido automaticamente após a conexão e mantido atualizado pelos
  eventos `groups.update` e `group-participants.update` do Baileys.
- Quando necessário, utilize `GET /groups/{instanceId}?refresh=true` para forçar
  uma sincronização completa diretamente com o WhatsApp.

## Endpoints disponíveis

### Listar grupos

`GET /groups/{instanceId}`

- Retorna a lista de grupos conhecidos para a instância.
- Query `refresh=true` força recarga a partir da API do WhatsApp.
- Resposta padrão:
  ```json
  {
    "success": true,
    "instanceId": "whatsapp_1",
    "groups": [
      {
        "jid": "1234567890-123@g.us",
        "name": "Meu Grupo",
        "description": "Descrição atual",
        "participantCount": 32,
        "permissions": {
          "isAdmin": true,
          "canManageParticipants": true,
          "canEditInfo": true
        },
        "settings": {
          "announcement": false,
          "locked": true
        }
      }
    ],
    "cache": {
      "initialized": true,
      "lastSyncedAt": "2025-01-01T12:00:00.000Z",
      "source": "cache"
    }
  }
  ```
- Erros comuns: `400 Instância não conectada`.

### Criar grupo

`POST /groups/{instanceId}`

Body:
```json
{
  "subject": "Novo grupo",
  "participants": ["5511999999999", "558199999999"]
}
```
- `participants` é opcional. Telefones podem ser enviados sem domínio
  (`@s.whatsapp.net` é completado pelo serviço).
- Respostas de erro: `400` para assunto ausente ou participante inválido.

### Gerenciar participantes

`POST /groups/{instanceId}/{groupId}/participants`

Body:
```json
{
  "action": "add | remove | promote | demote",
  "participants": ["5511999999999@s.whatsapp.net"]
}
```
- Requer que a instância seja administradora do grupo (senão retorna `403`).
- A resposta inclui o status retornado pelo WhatsApp e o metadado atualizado.

### Atualizar assunto

`PATCH /groups/{instanceId}/{groupId}/subject`

Body: `{ "subject": "Novo nome" }`

- Necessita privilégio de administrador.
- Erros: `400` para assunto vazio, `403` quando o usuário não é admin.

### Atualizar descrição

`PATCH /groups/{instanceId}/{groupId}/description`

Body: `{ "description": "Nova descrição" }`

- Aceita string vazia para limpar a descrição.
- Requer permissão de administrador.

### Ajustar configurações

`PATCH /groups/{instanceId}/{groupId}/settings`

Body de exemplo:
```json
{
  "announcement": true,
  "locked": false
}
```
- Campos aceitos:
  - `announcement` (boolean): ativa/desativa modo "somente administradores".
  - `locked` (boolean): controla se apenas admins podem alterar dados do grupo.
  - `setting`: aceita valores diretos do Baileys (`announcement`,
    `not_announcement`, `locked`, `unlocked`).
- Retorna a lista de alterações aplicadas.
- Erros: `400` quando nenhum campo é enviado, `403` quando a instância não é
  administradora.

### Sair do grupo

`POST /groups/{instanceId}/{groupId}/leave`

- Remove a instância do grupo e limpa o cache local.
- Não exige privilégios de admin (o usuário pode sair a qualquer momento).

### Código de convite

`GET /groups/{instanceId}/{groupId}/invite-code`

- Retorna o código atual do grupo. Exige permissão de administrador (`403` caso
  contrário).

### Revogar convite

`POST /groups/{instanceId}/{groupId}/revoke-invite`

- Gera um novo código de convite, invalidando o anterior. Também exige permissão
  de administrador.

## Tratamento de erros

- `400 Bad Request`: parâmetros inválidos, instância desconectada ou lista de
  participantes vazia.
- `403 Forbidden`: a instância conectada não possui privilégios de administrador
  para executar a operação.
- `500 Internal Server Error`: erros inesperados devolvidos pelo Baileys ou pela
  própria API do WhatsApp.

Sempre valide as respostas e trate mensagens de erro exibidas no campo
`error` para orientar corretamente o usuário final.

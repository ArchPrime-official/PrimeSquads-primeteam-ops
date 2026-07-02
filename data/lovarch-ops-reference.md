# Lovarch Ops Gateway — Reference

> Como o time da ArchPrime consulta dados operacionais da **Lovarch** (produto SaaS,
> projeto Supabase separado) pelo terminal, sem conta Lovarch e sem service role.
> Consumido pelo agente `@lovarch-ops-specialist`.

## O que é

A Lovarch expõe uma Edge Function **`ops-gateway`** que aceita o **token do PrimeTeam**
do membro (o mesmo `access_token` de `~/.primeteam/session.json`), valida quem é e qual
o papel dele, executa uma operação **read-only** com o service role da Lovarch (só no
servidor) e **audita tudo** em `ops_audit_log`. Nenhum dado sensível-fiscal é retornado.

- **Endpoint:** `POST https://cuxbydmyahjaplzkthkr.supabase.co/functions/v1/ops-gateway`
- **Header:** `Authorization: Bearer <access_token do ~/.primeteam/session.json>`
- **Body:** `{ "operation": "<op>", "params": { ... } }`
- **Auth:** o gateway valida o token contra o projeto PrimeTeam (`/auth/v1/user`) e lê os
  roles do chamador. Token inválido/expirado → `401`. Sem role de time → `403`.

## Papel → operações permitidas

| Papel | whoami | lookup_user | user_tickets | recent_errors |
|-------|:------:|:-----------:|:------------:|:-------------:|
| owner / admin / cs | ✓ | ✓ | ✓ | ✓ |
| marketing / comercial | ✓ | ✓ | ✓ | — |
| financeiro | ✓ | ✓ | — | — |

## Operações (Fase 1 — read-only)

### `whoami`
Sem params. Retorna `{ email, roles, allowed_operations }`. Use como self-test / descoberta
de capacidade antes de qualquer consulta.

### `lookup_user`
`params: { email }` **ou** `{ user_id }`. Retorna resumo da conta Lovarch:
`{ found, profile: { id, email, full_name, status, user_type, is_admin, created_at },
credits_balance, feedbacks_count, errors_count }`. `found:false` se não existir.

### `user_tickets`
`params: { email | user_id, limit? (default 20, max 100) }`. Retorna os feedbacks/tickets
in-app do usuário: `{ found, user, tickets: [{ id, subject, category, status, created_at, updated_at }] }`.

### `recent_errors`
`params: { limit? }` (globais) **ou** `{ email | user_id, limit? }` (de um usuário).
Retorna `{ found, target, errors: [{ id, error_message, function_name, severity, source, http_status, created_at, user_id }] }`.

## Exemplo (curl)

```bash
TOKEN=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.primeteam/session.json')))['access_token'])")
curl -s -X POST "https://cuxbydmyahjaplzkthkr.supabase.co/functions/v1/ops-gateway" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"operation":"lookup_user","params":{"email":"cliente@studio.com"}}' | python3 -m json.tool
```

Se o token estiver expirado (`401 invalid_token`), rode `pto refresh` (ou `pto login`) e tente de novo.

## Limites / próximas fases

- **Fase 1 (esta):** somente leitura. Não altera nada na Lovarch.
- **Fase 2 (planejada):** operações de escrita controladas — ex.: **criar/editar aulas** da
  Central de Aulas (Tutorial & Guide) quando o catálogo estiver no banco. Serão adicionadas
  como novas `operation`s no mesmo gateway, gated por papel e auditadas.

## Dependências de infra (uma vez, lado Lovarch — feito pelo @devops/Pablo)

O `ops-gateway` precisa de duas envs no projeto Lovarch: `PRIMETEAM_SUPABASE_URL` (já existe)
e `PRIMETEAM_ANON_KEY` (anon pública do PrimeTeam). Sem elas → `500 gateway_misconfigured`.

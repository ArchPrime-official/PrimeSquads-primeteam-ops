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

- **Fase 1:** somente leitura (whoami/lookup_user/user_tickets/recent_errors).
- **Fase 2 (NO AR desde 2026-07-04):** o `ops-gateway` ganhou `list_users`/`user_progress` (read,
  owner/admin/cs) e `update_user_status`/`set_user_plan` (write, owner/admin) — auditadas em
  `ops_audit_log`. Tasks pto: `list-lovarch-students` (read) e `manage-lovarch-user` (suspend/
  reactivate/set_plan). **Acesso/entitlement** (dar/tirar produto) NÃO passa pelo gateway — usa
  `archprime-access-proxy` (task `manage-lovarch-access`).
- **Fase 2b (PENDENTE):** `adjust_credits` e `respond_ticket` — ficam nas EFs admin dedicadas do
  Lovarch (`admin-adjust-credits`, `manage-user-thread`) por causa da lógica sensível de
  paid_credits/thread. Exigem expor essas EFs ao gateway ou modo shared-secret — trabalho no repo
  Lovarch (@devops/Pablo).

### Contrato Fase 2 — `operation`s de escrita a implementar no `ops-gateway`

Mesmo envelope (`{ operation, params }`, token do operador, gated por papel, auditado em
`ops_audit_log`). Sugestão de gate: owner/admin (acesso/crédito), owner/admin/cs (ticket).

| operation | params | efeito no projeto Lovarch | gate |
|---|---|---|---|
| `grant_access` | `{ email\|user_id, product, access_until }` | concede/estende entitlement do aluno | owner/admin |
| `revoke_access` | `{ email\|user_id, product }` | revoga entitlement | owner/admin |
| `respond_ticket` | `{ ticket_id, message, status? }` | responde/atualiza feedback in-app | owner/admin/cs |
| `adjust_credits` | `{ email\|user_id, delta, reason }` | ajusta saldo de créditos (auditado) | owner/admin |
| `upsert_lesson` | `{ lesson: {...} }` | cria/edita aula da Central de Aulas **se o catálogo estiver em tabela** (hoje pode ser código no repo — confirmar antes) | owner/admin |

Regras invioláveis da Fase 2: (1) o gateway usa o service role da Lovarch **só no servidor**; o pto
nunca toca o banco `cuxbydmyahjaplzkthkr` direto. (2) Toda escrita é auditada em `ops_audit_log`.
(3) `upsert_lesson` só é viável se as aulas forem DB-driven — se forem hard-coded no repo
`ByPabloRuanL/lovarch`, criar/editar aula exige PR de código, não passa pelo gateway.

## Dependências de infra (uma vez, lado Lovarch — feito pelo @devops/Pablo)

O `ops-gateway` precisa de duas envs no projeto Lovarch: `PRIMETEAM_SUPABASE_URL` (já existe)
e `PRIMETEAM_ANON_KEY` (anon pública do PrimeTeam). Sem elas → `500 gateway_misconfigured`.

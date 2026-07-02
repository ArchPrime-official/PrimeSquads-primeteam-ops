# Task: lovarch-lookup-user

> Procurar um usuário da Lovarch por email (ou user_id) e retornar um resumo da
> conta: nome, status, tipo/plano, saldo de créditos e contagem de tickets/erros.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001)

### task_name
`Lovarch Lookup User`

### status
`pending`

### responsible_executor
`lovarch-ops-specialist` (Sprint 24, Lovarch read bridge)

### execution_type
`Agent` — chamada HTTP autenticada ao ops-gateway da Lovarch.

### input
- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **Operator token**: `~/.primeteam/session.json .access_token`
- **Request payload**:
  - `email` (string) **OU** `user_id` (uuid) — pelo menos um obrigatório.

### output
- `found` (bool).
- `profile`: `{ id, email, full_name, status, user_type, is_admin, created_at }`.
- `credits_balance` (int | null).
- `feedbacks_count`, `errors_count` (int).

### action_items
1. `TOKEN` = access_token de `~/.primeteam/session.json`.
2. `POST .../functions/v1/ops-gateway` com `{"operation":"lookup_user","params":{"email":"<email>"}}`
   (ou `{"user_id":"<uuid>"}`).
3. Tratar 401/403/500 conforme a receita do agente.
4. 200 + `found:true` → apresentar o resumo em PT (bullets). `found:false` → "Usuário não encontrado na Lovarch."

### acceptance_criteria
- `found:true` → todos os campos do `profile` reportados sem invenção.
- `found:false` reportado como tal (não inventar dados).
- Nada além do que o gateway retornou é exposto.

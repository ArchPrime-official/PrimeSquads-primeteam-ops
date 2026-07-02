# Task: lovarch-user-tickets

> Listar os tickets/feedbacks in-app de um usuário Lovarch (problemas que ele
> reportou), com status e categoria.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001)

### task_name
`Lovarch User Tickets`

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
  - `limit` (int opcional, default 20, máx 100).

### output
- `found` (bool), `user: { id, email }`.
- `tickets`: array de `{ id, subject, category, status, created_at, updated_at }` (mais recentes primeiro).

### action_items
1. `TOKEN` = access_token de `~/.primeteam/session.json`.
2. `POST .../functions/v1/ops-gateway` com `{"operation":"user_tickets","params":{"email":"<email>","limit":20}}`.
3. Tratar 401/403/500 conforme a receita do agente. Nota: papel `financeiro` NÃO tem esta operação (403) — reporte.
4. 200 → apresentar os tickets em tabela PT (assunto · categoria · status · data). Sem tickets → "Nenhum ticket."

### acceptance_criteria
- Lista reportada exatamente como retornada (ordem, status, categoria).
- 403 para papel sem permissão reportado, não contornado.

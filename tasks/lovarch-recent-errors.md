# Task: lovarch-recent-errors

> Listar erros recentes da plataforma Lovarch — globais ou filtrados por um
> usuário. Útil para investigar "o que quebrou para este cliente".

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001)

### task_name
`Lovarch Recent Errors`

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
  - `email` **OU** `user_id` (opcional — se ausente, retorna erros globais recentes).
  - `limit` (int opcional, default 20, máx 100).

### output
- `found` (bool), `target` ({id,email} | null).
- `errors`: array de `{ id, error_message, function_name, severity, source, http_status, created_at, user_id }` (mais recentes primeiro).

### action_items
1. `TOKEN` = access_token de `~/.primeteam/session.json`.
2. `POST .../functions/v1/ops-gateway` com `{"operation":"recent_errors","params":{"email":"<email>","limit":20}}`
   (ou sem `email`/`user_id` para erros globais).
3. Tratar 401/403/500 conforme a receita do agente. Operação restrita a `owner/admin/cs` (403 p/ demais).
4. 200 → apresentar em tabela PT (mensagem · função · severidade · data). Vazio → "Sem erros no período."

### acceptance_criteria
- Erros reportados como retornados (mensagem/função/severidade preservadas).
- Filtro por usuário aplicado quando `email`/`user_id` presentes.
- 403 para papel sem permissão reportado, não contornado.

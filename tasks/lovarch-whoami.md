# Task: lovarch-whoami

> Self-test do acesso à Lovarch: confirma que o token do operador é válido lá e
> mostra quais operações o papel dele permite. Rode isto antes de qualquer consulta.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001)

### task_name
`Lovarch Whoami`

### status
`pending`

### responsible_executor
`lovarch-ops-specialist` (Sprint 24, Lovarch read bridge)

### execution_type
`Agent` — chamada HTTP autenticada ao ops-gateway da Lovarch. Sem intervenção humana.

### input
- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **Operator token**: `~/.primeteam/session.json .access_token`
- **Request payload**: nenhum.

### output
- `email` — email do operador (como a Lovarch o vê).
- `roles` — papéis do operador no PrimeTeam.
- `allowed_operations` — subconjunto de `{whoami, lookup_user, user_tickets, recent_errors}`.

### action_items
1. `TOKEN` = access_token de `~/.primeteam/session.json`.
2. `POST https://cuxbydmyahjaplzkthkr.supabase.co/functions/v1/ops-gateway`
   com header `Authorization: Bearer $TOKEN` e body `{"operation":"whoami"}`.
3. 401 → orientar `pto refresh` (ou `pto login`) e reexecutar. 403 → operador não é membro do time (reporte). 500 `gateway_misconfigured` → escalar @devops.
4. 200 → reportar `email`, `roles`, `allowed_operations` em PT.

### acceptance_criteria
- Resposta 200 com `allowed_operations` não-vazio → operador habilitado.
- Erro reportado verbatim (nunca mascarar 401/403).

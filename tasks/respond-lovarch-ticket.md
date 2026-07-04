# Task: respond-lovarch-ticket

> Responder um ticket/feedback in-app de um usuário do app Lovarch via a op `respond_ticket` da **Fase 2b do `ops-gateway`** — insere em `feedback_messages` (`is_admin=true`) e marca o ticket `in_progress`. O pto NUNCA toca o banco Lovarch direto.

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

---

## Task anatomy

### task_name
`Respond Lovarch Ticket`

### status
`pending`

### responsible_executor
`lovarch-ops-specialist` — auth **owner/admin** (write do gateway).

### execution_type
`Agent` — confirmação (a resposta fica visível ao usuário no app).

### input
- **Cycle ID**, **User JWT**
- `feedback_id` (uuid do ticket) — **ELICITAR** (obtido via `user_tickets`)
- `message` (string) — **ELICITAR sempre** (a resposta ao usuário; nunca defaultar/vazia)

### action_items
1. **Auth** — owner/admin. Demais → BLOCKED.
2. **`user_tickets`** (read) para achar o `feedback_id` do ticket alvo, se não fornecido.
3. **Elicitar** `feedback_id` + `message` (não-vazia).
4. **Confirmação** (echo): "responder o ticket {feedback_id} com: «{message}» (fica visível ao usuário). Confirma?".
5. **Write via gateway:**
   ```
   { "operation":"respond_ticket", "params":{ feedback_id, message } }
   ```
   Guards: `feedback_id_required`, `message_required`, `ticket_not_found` → corrigir/ESCALATE.
6. **Verificação PÓS-AÇÃO** (obrigatória): re-`user_tickets` (ou a resposta `replied:true`) confirmando que a mensagem entrou e o status virou `in_progress`.
7. **Auditoria:** `ops_audit_log` + log PT.

### acceptance_criteria
- **[A1]** Auth owner/admin.
- **[A2]** `feedback_id` e `message` elicitados; mensagem nunca vazia.
- **[A3]** Via gateway — NUNCA toca o banco Lovarch direto.
- **[A4]** Verificação pós-ação confirma a resposta.

---

## Exemplos
### Exemplo 1 — Responder dúvida de um usuário (respond_ticket) → mensagem aparece no app.
### Exemplo 2 — message vazia (ELICITAR).
### Exemplo 3 — feedback_id inexistente (ticket_not_found → ESCALATE).

## Notas
- Ver os tickets de um usuário = `lovarch-user-tickets` (read). Créditos = `adjust-lovarch-credits`.
- Referências: `data/lovarch-ops-reference.md` (§Fase 2b), op `respond_ticket`.

---

**Mantido por:** lovarch-ops-specialist

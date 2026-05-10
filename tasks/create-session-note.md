# Task: create-session-note

> Registrar nota de sessão CS (call, email, check-in) em `cs_session_notes`. CS usa diariamente. Implementa F-05.2 do PRD.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Create CS Session Note`

### responsible_executor
`platform-specialist` (CS module scope)

### execution_type
`Agent` — confirmation simples (single-row INSERT).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `customer_id` (uuid, obrigatório) OR `customer_email` para resolver
  - `summary` (string, obrigatório, 10..5000 chars)
  - `next_steps` (string opcional)
  - `session_date` (ISO timestamp, default NOW)
  - `opportunity_id` (uuid opcional — se nota é sobre opp específica)
  - `lead_id` (uuid opcional)
  - `calendar_event_id` (uuid opcional — link a meeting agendada)

### output

- **`note_id`** (uuid)
- **`customer_id`** (echo)
- **`session_date`** (UTC + Europe/Rome)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** cs/admin/owner. Outros (comercial, marketing, financeiro) → BLOCKED:
   ```
   Notas CS são acessíveis apenas para roles cs/admin/owner.
   Sua role: {role}.
   ```
2. **Resolver customer_id** se passou email:
   ```sql
   SELECT id, name FROM customers WHERE email={email};
   ```
   0 match → ESCALATE com sugestão de criar customer primeiro.
3. **Validar summary:** 10..5000 chars, UTF-8.
4. **Validar opcionais:** se opportunity_id passado, MUST belong to customer (FK check).
5. **Confirmation:**
   ```
   Nota CS:
     Customer: {customer_name}
     Session date: {session_date_local} (Europe/Rome)
     Summary ({chars} chars):
       «{summary preview 200 chars}»
     {next_steps ? 'Próximos passos: ' + next_steps : ''}
     {opportunity_id ? 'Vinculado à opp: ' + opp_name : ''}
     {calendar_event_id ? 'Vinculado ao evento Calendar: ' + cal_summary : ''}
   Confirma?
   ```
6. **INSERT:**
   ```sql
   INSERT INTO cs_session_notes
     (customer_id, opportunity_id, lead_id, calendar_event_id,
      session_date, summary, next_steps, conducted_by)
   VALUES (...) RETURNING id;
   ```
7. **Activity log:** `action='platform-specialist.create_session_note'`, details com note_id + customer_id (sem PII content em log).
8. **Echo:**
   ```
   ✓ Nota CS criada
   Note ID: {note_id}
   Customer: {customer_name}
   Session: {session_date_local}
   {next_steps ? 'Próximos passos registrados.' : ''}
   ```

### acceptance_criteria

- **[A1] Role gating:** cs/admin/owner.
- **[A2] Summary required + length validation:** 10..5000 chars.
- **[A3] FK integrity:** opportunity_id/lead_id MUST link to customer se passados.
- **[A4] Confirmation simple:** preview do summary visível.
- **[A5] conducted_by = auth.uid():** automatic.
- **[A6] No PII em activity_log:** apenas IDs (summary content é privado).
- **[A7] UTC + Europe/Rome:** echo mostra ambos para clarity.

---

## Exemplos

### Exemplo 1 — Andrea registra check-in semanal

**Input:** `customer_id`, `summary='Cliente reportou bom progresso na fase 2 do programa. Mencionou interesse em upsell para coaching individual.'`, `next_steps='Enviar proposta de coaching até sexta'`

**Specialist:** confirmation → "sim" → INSERT → DONE.

### Exemplo 2 — Comercial tenta criar nota → BLOCKED

**Input:** Daniel (comercial) → BLOCKED imediato.

### Exemplo 3 — Customer não existe → ESCALATE

**Input:** `customer_email='novo@cliente.com'` (não cadastrado)

**Specialist:** ESCALATE:
```
Customer 'novo@cliente.com' não encontrado.
Crie customer primeiro via UI CS Hub ou peça à Sandra (Marketing) para
verificar se há lead/opportunity associado.
```

---

## Notas

- **Schema:** `cs_session_notes` (migration 20260420190000) — confirmed columns.
- **AI integration:** Sprint futuro pode auto-gerar summary a partir de transcript Vapi/Ringover via edge.
- **Bulk create:** task é single-row. Para batch (muitas notas), usar import-csv (Tier 3).

---

**Mantido por:** platform-specialist

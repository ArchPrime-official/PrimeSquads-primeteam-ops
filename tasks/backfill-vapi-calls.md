# Task: backfill-vapi-calls

> Recuperar chamadas Vapi perdidas via webhook replay. Incident response. admin/owner only.

**✅ SCHEMA ADAPTED (2026-06-12):** Tabela canonical de registros Vapi = `call_executions` (UNIQUE via `vapi_call_id`). Decision tree das 4 EFs reais:
- `call-backfill` — bulk backfill de período (Vapi API list → INSERT em call_executions, ON CONFLICT DO NOTHING)
- `call-backfill-single` — backfill de 1 call específica por vapi_call_id
- `vapi-bulk-call` — disparar N calls novas (outbound batch, NÃO é backfill)
- `vapi-retroactive-enqueue` — re-enfileirar calls que falharam sem serem processadas pelo webhook

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Backfill Vapi Calls`

### responsible_executor `integration-specialist` com gate admin/owner

### execution_type `Agent` — DUPLA confirmation (operação cara em quota).

### input
- `period_from`, `period_to` (ISO datetime — max 30 dias)
- `account_id` (Vapi account)
- `dry_run` (default true)

### output
- `discovered_calls` (count na Vapi API)
- `existing_in_db` (count já registrados)
- `imported_count` (após persist)
- `cost_usd` (custo backfill)
- `verdict`: `DONE | PARTIAL | BLOCKED`

### action_items

1. **Auth gate:** admin/owner only (operação cara + sensível).
2. Validar período max 30 dias.
3. **Dry-run default:** lista calls da Vapi API (`list_calls`) vs DB. Diff.
4. Apresentar:
   ```
   Backfill Vapi {period}:
     API discovered: {N} calls
     Already in DB: {M}
     Diff (will import): {N-M}
     Estimated cost: $0 (Vapi list é free; custos foram já cobrados)
   ```
5. Se `dry_run=false`: confirmation literal "BACKFILL VAPI" uppercase.
6. **Invoke edge** `call-backfill` com period.
7. Activity log STRICT: action='integration-specialist.backfill_telephony_calls', details com counts.
8. Echo: imported_count + warnings.

### acceptance_criteria
- A1 admin/owner
- A2 Period max 30d
- A3 Dry-run default
- A4 Tripla "BACKFILL VAPI"
- A5 Diff calculation antes de persist
- A6 Audit STRICT
- A7 Idempotency: ON CONFLICT(vapi_call_id) DO NOTHING em call_executions

---

**Mantido por:** integration-specialist

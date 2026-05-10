# Task: toggle-campaign-status

> Toggle campaign status (active/paused). Sandra usa diariamente para ajustes táticos. Implementa F-04.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Toggle Campaign Status`

### responsible_executor
`content-builder` (or sales-specialist se campanha=opp pipeline)

### execution_type
`Agent` — confirmation simples.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `campaign_id` (uuid)
  - `new_status` (`'active' | 'paused' | 'archived'`)
  - `reason` (string opcional)

### output

- **`campaign_id`**, **`old_status`**, **`new_status`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** marketing/admin/owner.
2. **Resolver campaign:** id, name, current_status, lp_count, leads_count.
3. **Validar transition:**
   - active → paused: OK
   - paused → active: OK
   - * → archived: warning (irreversível visual)
4. **Confirmation:**
   ```
   Toggle campaign «{name}»:
     Status: {old} → {new}
     Active LPs: {N} | Leads in queue: {M}
     {pause_warning ? 'LPs continuam visíveis (publish-cms-page para mudar)' : ''}
     {archive_warning ? 'Archive ESCONDE da listagem default (irreversível visual)' : ''}
     Reason: {reason or '(sem reason)'}
   Confirma?
   ```
5. **UPDATE:**
   ```sql
   UPDATE campaigns SET status={new_status}, updated_by=auth.uid(), updated_at=NOW(),
     status_change_reason={reason}, status_changed_at=NOW()
   WHERE id={campaign_id};
   ```
6. **Side-effect:** se paused, automation queue paginação respeita status (já feito por edge).
7. **Activity log:** action='content-builder.toggle_campaign_status', diff details.
8. **Echo:** "✓ Campaign {name} {new_status}. {N LPs ativas, M leads na queue}"

### acceptance_criteria

- **[A1] Role marketing/admin/owner.**
- **[A2] Transition válida.**
- **[A3] Confirmation com counts (LPs/leads).**
- **[A4] Audit diff.**

---

## Exemplos

### Exemplo 1 — Sandra pausa campanha underperforming

**Input:** `new_status='paused'`, reason='CTR baixo, refazer creative'

**Specialist:** confirmation → UPDATE → echo "Campaign pausada".

### Exemplo 2 — Marketing user → DONE.

---

**Mantido por:** content-builder

# Task: update-lead

> Atualizar lead (name, email, phone, status, owner, tags, notes). Comercial usa diariamente. Implementa F-02.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Update Lead`

### responsible_executor
`sales-specialist`

### execution_type
`Agent` — confirmation simples.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `lead_id` (uuid) OR `email` (resolver)
  - `updates` (object subset):
    - `name`, `email`, `phone` (E.164)
    - `status` (enum lead — `'new' | 'qualified' | 'contacted' | 'converted' | 'rejected' | 'unqualified'`)
    - `owner_id` (uuid sellers)
    - `tags_add`/`tags_remove` (array)
    - `notes_append` (string)
    - `lead_score` (int 0..100)
    - `opted_out` (bool — compliance LGPD/GDPR)

### output

- **`lead_id`**, **`updated_fields`**, **`row_snapshot_after`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** comercial/cs/admin/owner.
2. **Resolver lead:**
   ```sql
   SELECT id, name, email, phone, status, owner_id, opted_out, tags
   FROM leads WHERE id={lead_id} OR email={email};
   ```
3. **Validar updates:**
   - `email` regex válido + uniqueness check (se mudou)
   - `phone` E.164 (se mudou)
   - `status` ∈ enum válido
   - `owner_id` existe + role comercial
   - `lead_score` 0..100
4. **Status transition validation:**
   - `converted` → `*`: BLOCKED (terminal — ver memory: stripe-opp-matching)
   - `rejected` → `qualified`: warning (raro, pede reason)
5. **Confirmation:**
   ```
   Update lead {name} ({email}):
     Diff:
       {field}: {old} → {new}
       ...
     {opted_out_change ? '⚠️ Mudança em opt-out: ' + old + ' → ' + new : ''}
     {status_change ? 'Status: ' + old + ' → ' + new : ''}
   Confirma?
   ```
6. **UPDATE atomic:**
   ```sql
   UPDATE leads SET {fields}, updated_by=auth.uid(), updated_at=NOW()
   WHERE id={lead_id} RETURNING ...;
   ```
7. **Side-effect:** se `opted_out=true` agora, edge function ou trigger marca cancelamento em sequences ativas (compliance).
8. **Activity log:** action='sales-specialist.update_lead', details com diff (PII redacted: email mascarado em log).
9. **Echo:** "✓ Lead atualizado: {N} fields. {opted_out_warning}"

### acceptance_criteria

- **[A1] Role gating:** comercial/cs/admin/owner.
- **[A2] Email/phone validation** se mudou.
- **[A3] Status enum + transition guards.**
- **[A4] PII redaction em logs:** email mascarado, phone last 4.
- **[A5] Opt-out enforcement:** trigger cancela sequences ativas.
- **[A6] Audit:** activity_log com diff.

---

## Exemplos

### Exemplo 1 — Daniel atualiza phone do lead

**Input:** `lead_id`, `updates={phone='+5511999998888'}`

**Specialist:** validate E.164 ✓ → confirmation → UPDATE → DONE.

### Exemplo 2 — Tentativa de reverter converted → BLOCKED

**Input:** lead status=converted, tentativa status=qualified

**Specialist:** BLOCKED — converted é terminal (1 venda = 1 opp).

### Exemplo 3 — Set opted_out=true

**Input:** updates={opted_out=true}, reason GDPR request

**Specialist:** UPDATE + side-effect cancela sequences ativas → echo "Lead opt-out registrado. {N} sequences canceladas."

---

## Notas

- **Memory:** `stripe-opp-matching-fix-2026-05-04` — leads converted são imutáveis em status (1 venda = 1 opp).
- **Opt-out compliance:** flag respected globally (Vapi calls, WhatsApp, email sequences).

---

**Mantido por:** sales-specialist

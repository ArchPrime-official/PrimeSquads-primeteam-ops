# Task: update-onboarding-form

> Atualizar metadata de form template (name, description, target_customer, status). NÃO publica (publish é task separada).

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Update Onboarding Form`

### responsible_executor
`content-builder`

### execution_type
`Agent` — confirmation simples.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `form_id` (uuid)
  - `updates` (object subset):
    - `title`, `description`, `slug`
    - `form_type` (string — ex: `onboarding | nps | satisfaction | feedback`)
    - `active` (bool)
  - `updated_at_expected` (ISO timestamp opcional — optimistic lock via updated_at; coluna `version` NÃO existe em `evaluation_forms`)

### output

- **`form_id`**, **`updated_fields`**, **`updated_at`** (timestamp pós-update)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role:** cs/marketing/admin/owner.
2. **Resolver form** + status atual.
3. **Validar updates:**
   - `slug` uniqueness (se mudou)
   - `name` 3..200 chars
   - Mudança em `slug` se status=published → warning (URL pública mudará — links externos quebram)
4. **Confirmation:**
   ```
   Update form «{name}»:
     Diff: {fields}
     {published_warning ? 'Status=published — URL pública mudará' : ''}
   Confirma?
   ```
5. **UPDATE atomic** (coluna `version` NÃO existe em `evaluation_forms`; usar `updated_at` como lock se necessário):
   ```sql
   UPDATE evaluation_forms SET {fields}, updated_at=NOW()
   WHERE id={form_id}
     AND ({updated_at_expected} IS NULL OR updated_at = {updated_at_expected})
   RETURNING id, title, slug, form_type, active, updated_at;
   ```
6. **Activity log:** diff in details.
7. **Echo:** "✓ Form atualizado. {warning_if_url_change}"

### acceptance_criteria

- **[A1] Role gating.**
- **[A2] Slug uniqueness.**
- **[A3] URL warning** se publish + slug change.
- **[A4] Optimistic lock via updated_at** (coluna version não existe — usar timestamp).
- **[A5] Audit diff.**

---

## Notas

- Para gerenciar fields/questions: tasks separadas `delete-form-field` + `reorder-form-fields`.
- Para publish/unpublish: `publish-onboarding-form`.

---

**Mantido por:** content-builder

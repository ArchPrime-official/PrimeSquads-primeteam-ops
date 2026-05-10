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
    - `name`, `description`, `slug`
    - `target_customer_id` (mudar específico/genérico)
    - `form_type` (`onboarding | nps | satisfaction | feedback`)
  - `version` (int — optimistic lock)

### output

- **`form_id`**, **`updated_fields`**, **`new_version`**
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
5. **UPDATE atomic com version lock:**
   ```sql
   UPDATE evaluation_forms SET {fields}, updated_by=auth.uid(), updated_at=NOW()
   WHERE id={form_id} AND version={expected_version} RETURNING ...;
   ```
6. **Activity log:** diff in details.
7. **Echo:** "✓ Form atualizado. {warning_if_url_change}"

### acceptance_criteria

- **[A1] Role gating.**
- **[A2] Slug uniqueness.**
- **[A3] URL warning** se publish + slug change.
- **[A4] Optimistic lock via version.**
- **[A5] Audit diff.**

---

## Notas

- Para gerenciar fields/questions: tasks separadas `delete-form-field` + `reorder-form-fields`.
- Para publish/unpublish: `publish-onboarding-form`.

---

**Mantido por:** content-builder

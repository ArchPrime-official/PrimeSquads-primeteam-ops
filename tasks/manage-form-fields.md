# Task: manage-form-fields

> CRUD granular de form fields (questions). Inclui add/update/delete/reorder. CS usa para refinar onboarding forms. Implementa F-05.3.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Manage Form Fields`

### responsible_executor
`content-builder`

### execution_type
`Agent` — confirmation se delete/reorder em form published.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `form_id` (uuid)
  - `action` (`'add' | 'update' | 'delete' | 'reorder'`)
  - **Para `add`:** `field` (object — label, type, required, options)
  - **Para `update`:** `field_id`, `updates`
  - **Para `delete`:** `field_id`
  - **Para `reorder`:** `field_order` (array uuid em nova ordem)

### output

- **`form_id`**, **`action`**, **`field_id`** (relevant)
- **`new_field_count`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** cs/marketing/admin/owner.
2. **Resolver form** + status (draft/published).
3. **Action-specific validation:**

   **`add`:**
   - field.label 3..500 chars
   - field.type ∈ enum
   - Se multiple_choice: options array min 2
   - Form max 50 fields total

   **`update`:**
   - field_id existe no form
   - Não mudar `type` em form com submissions existentes (BLOCKED — quebra schema)

   **`delete`:**
   - field_id existe
   - Form com submissões: warning "submissões orfãs" (preserva responses sem display)

   **`reorder`:**
   - field_order contém EXATAMENTE todos field_ids do form
   - Sem duplicates

4. **Conditional confirmation:**
   - Form draft + add/update simples: skip confirm
   - Form published OR delete OR reorder: confirmation com preview
5. **Mutation per action:**
   ```sql
   -- add
   INSERT INTO form_fields (form_id, label, type, required, options, position)
   VALUES (...);

   -- update
   UPDATE form_fields SET {updates} WHERE id={field_id};

   -- delete
   DELETE FROM form_fields WHERE id={field_id};

   -- reorder (atomic)
   BEGIN;
   FOR each (field_id, new_position) in field_order:
     UPDATE form_fields SET position={new_position} WHERE id={field_id};
   COMMIT;
   ```
6. **Activity log:** action='content-builder.manage_form_fields_{action}', details com diff.
7. **Echo:**
   ```
   ✓ Field {action}d
   Form «{name}» now has {N} fields.
   {published_warning ? 'Form publicado — URL pública reflete mudança em ~60s' : ''}
   ```

### acceptance_criteria

- **[A1] Role gating.**
- **[A2] Type-immutable** se form tem submissions.
- **[A3] Field count cap:** max 50 per form.
- **[A4] Reorder atomic** — todos OR nenhum.
- **[A5] Confirmation** se published OR destrutivo (delete/reorder).
- **[A6] Audit per action** com diff.
- **[A7] Submissions preservation:** delete field NÃO deleta responses (preserva audit).

---

## Exemplos

### Exemplo 1 — Jessica add NPS field em form draft

**Input:** action=add, field={label:'Nota 1-10', type:'rating_1_10', required:true}

**Specialist:** validate ✓, draft form, skip confirm → INSERT → DONE.

### Exemplo 2 — Reorder em form published

**Input:** action=reorder, field_order=[id3, id1, id2]

**Specialist:** validate (todos ids included), confirmation (published warning) → atomic UPDATE positions → DONE.

### Exemplo 3 — Tenta mudar type em form com submissions → BLOCKED

**Input:** action=update, field type 'text' → 'rating_1_10', form has 47 responses

**Specialist:** BLOCKED:
```
Não posso mudar field.type em form com 47 submissions existentes.
Schema mismatch quebraria responses históricas.
Alternativas:
- Delete field + add novo com type correto (responses do field antigo viram orphan, preservadas)
- Crie novo form via clone para iniciar nova coleta com type correto
```

---

## Notas

- **Single task em vez de 4 (add/update/delete/reorder):** consolidação para reuso de validação + confirmation flow.
- **form_fields schema:** referência via FK form_id; position int para ordem visual.
- **Submissions preservation:** delete field não cascade DELETE em responses (FK ON DELETE SET NULL ou similar).

---

**Mantido por:** content-builder

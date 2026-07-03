# Task: manage-form-fields

> CRUD granular de campos de formulário (`form_fields`, FK → `form_templates`). Inclui add/update/delete/reorder + i18n. Implementa F-05.3.
>
> ⛔ **DÉBITO DE SCHEMA CONHECIDO — esta task opera em `form_templates`, NÃO em `evaluation_forms`.** `form_fields.form_template_id` → `form_templates.id`. Um form criado por `create-onboarding-form` (que grava em `evaluation_forms`) NÃO tem ligação direta com estes `form_fields` — a cadeia "criar onboarding-form → adicionar campos" não fecha ponta a ponta. **Solução proposta (decisão @data-engineer):** coluna-ponte `evaluation_forms.form_template_id`. Até lá, exija `form_template_id` explícito e AVISE que não há resolução automática a partir de um `evaluation_forms.id`. Ver `create-onboarding-form.md` (mesmo débito).

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Manage Form Fields`

### responsible_executor
`content-builder`

### execution_type
`Agent` — confirmation se delete/reorder ou se o `form_template` estiver `is_active=true`.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `form_template_id` (uuid, obrigatório — FK real de `form_fields`; referencia `form_templates.id`, **não** `evaluation_forms.id`)
  - `action` (`'add' | 'update' | 'delete' | 'reorder'`)
  - **Para `add`:** `field` (object):
    - `label` (string, obrigatório, 3..500 chars)
    - `type` (enum `form_field_type`, obrigatório: `text | textarea | email | phone | select | radio | checkbox | file`)
    - `display_order` (int, obrigatório)
    - `required` (bool, opcional, default false)
    - `options` (jsonb, obrigatório se `type` ∈ `select|radio|checkbox`, min 2 itens)
    - `placeholder` (string, opcional)
    - `section` (string, opcional — agrupamento visual)
    - `validation` (jsonb, opcional — regras extra ex: regex/min/max)
    - `translations` (jsonb, **obrigatório** — traduções IT+PT do `label`/`placeholder`, ex: `{it: {label: "..."}, pt: {label: "..."}}`)
  - **Para `update`:** `field_id`, `updates` (subset dos campos acima)
  - **Para `delete`:** `field_id`
  - **Para `reorder`:** `field_order` (array de `{field_id, display_order}` em nova ordem)

### output

- **`form_template_id`**, **`action`**, **`field_id`** (relevante)
- **`new_field_count`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** cs/marketing/admin/owner.
2. **Resolver `form_templates`** por `form_template_id` + status `is_active`.
3. **Action-specific validation:**

   **`add`:**
   - `label` 3..500 chars
   - `type` ∈ enum `form_field_type` real (`text|textarea|email|phone|select|radio|checkbox|file`)
   - Se `type` ∈ `select|radio|checkbox`: `options` array min 2
   - `translations` presente com pelo menos IT e PT
   - Form template com no máx. 50 fields totais

   **`update`:**
   - `field_id` existe em `form_fields` (FK `form_template_id`)
   - Não mudar `type` em template com submissões existentes vinculadas (BLOCKED — quebra schema de leitura)

   **`delete`:**
   - `field_id` existe
   - Template com submissões: warning "submissões podem referenciar este campo por label/id — preserve o histórico ao ler respostas antigas"

   **`reorder`:**
   - `field_order` contém EXATAMENTE todos os `field_id` do template, cada um com novo `display_order`
   - Sem duplicates

4. **Conditional confirmation:**
   - Template `is_active=false` + add/update simples: skip confirm
   - Template `is_active=true` OU delete OU reorder: confirmation com preview
5. **Mutation per action:**
   ```sql
   -- add
   INSERT INTO form_fields
     (form_template_id, label, type, required, options, display_order, placeholder, section, validation, translations)
   VALUES (...);

   -- update
   UPDATE form_fields SET {updates} WHERE id = {field_id};

   -- delete
   DELETE FROM form_fields WHERE id = {field_id};

   -- reorder (atomic)
   BEGIN;
   FOR each (field_id, new_display_order) in field_order:
     UPDATE form_fields SET display_order = {new_display_order} WHERE id = {field_id};
   COMMIT;
   ```
6. **Activity log:** action='content-builder.manage_form_fields_{action}', details com diff.
7. **Echo:**
   ```
   ✓ Field {action}d
   Form template «{name}» now has {N} fields.
   {active_warning ? 'Template ativo — reflete em consumidores em ~60s' : ''}
   ```

### acceptance_criteria

- **[A1] Role gating.**
- **[A2] Type-immutable** se template tem submissões vinculadas.
- **[A3] Field count cap:** max 50 por `form_template_id`.
- **[A4] Reorder atomic** — todos OR nenhum, por `display_order`.
- **[A5] Confirmation** se template ativo OU ação destrutiva (delete/reorder).
- **[A6] i18n obrigatório:** `translations` (IT+PT) presente em todo `add`.
- **[A7] Audit per action** com diff.
- **[A8] Submissions preservation:** delete field não deleta respostas já submetidas.

---

## Exemplos

### Exemplo 1 — Jessica add campo de e-mail em template inativo

**Input:** `action=add`, `field={label:'E-mail de contato', type:'email', display_order:1, required:true, translations:{it:{label:'E-mail di contatto'}, pt:{label:'E-mail de contato'}}}`

**Specialist:** valida ✓, template inativo, skip confirm → INSERT → DONE.

### Exemplo 2 — Reorder em template ativo

**Input:** `action=reorder`, `field_order=[{field_id:id3, display_order:1}, {field_id:id1, display_order:2}, {field_id:id2, display_order:3}]`

**Specialist:** valida (todos ids incluídos), confirmation (template ativo) → UPDATE atomic de `display_order` → DONE.

### Exemplo 3 — Tenta mudar `type` em field com submissões vinculadas → BLOCKED

**Input:** `action=update`, `type` de `'text'` → `'select'`

**Specialist:** BLOCKED:
```
Não posso mudar field.type em template com submissões vinculadas.
Alternativas:
- Delete field + add novo com type correto
- Clone o form_template para iniciar nova coleta com type correto
```

---

## Notas

- **Single task em vez de 4 (add/update/delete/reorder):** consolidação para reuso de validação + confirmation flow.
- **FK real:** `form_fields.form_template_id → form_templates.id`. Esta task NÃO opera sobre `evaluation_forms` — se o objetivo é anexar campos a um form de onboarding específico (`evaluation_forms`), confirme com @data-engineer se existe (ou falta) uma coluna-ponte entre as duas tabelas antes de assumir o fluxo fechado.
- **i18n:** `translations` é jsonb livre — convenção mínima: `{it: {label, placeholder?}, pt: {label, placeholder?}}`. Sempre popular os dois idiomas.
- **Enum real de `type`:** `form_field_type` = `text | textarea | email | phone | select | radio | checkbox | file`. Não existem `long_text`, `rating_1_10`, `multiple_choice` ou `date` como valores de enum — usar `textarea`, `select`/`radio` (com `options`) ou `text` conforme o caso mais próximo.

---

**Mantido por:** content-builder

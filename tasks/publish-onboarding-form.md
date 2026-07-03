# Task: publish-onboarding-form

> Toggle `evaluation_forms.active` entre `false` e `true`. Após publish (`active=true`), form aceita submissões via link público. Reversível via unpublish. Implementa F-05.3 publish flow.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Publish Onboarding Form`

### responsible_executor
`content-builder`

### execution_type
`Agent` — confirmation OBRIGATÓRIO (publish é destrutivo — link vai público).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `form_id` (uuid OR slug para resolver)
  - `action` (`'publish' | 'unpublish'`)

### output

- **`form_id`**, **`slug`**, **`active`**, **`public_url`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** cs/marketing/admin/owner.
2. **Resolver form** por id ou slug. 0 match → ESCALATE.
3. **Validar action** ∈ `('publish', 'unpublish')`.
4. **Validar estado atual vs action:**
   - `publish` + `active=true` → ESCALATE (`already_published`)
   - `publish` + `active=false` → OK
   - `unpublish` + `active=false` → ESCALATE (`already_unpublished`)
   - `unpublish` + `active=true` → OK
5. **Confirmation:**
   ```
   ATENÇÃO: vou {publish | unpublish} form «{title}»
   Slug: {slug}
   {publish ?
     'URL pública: https://forms.archprime.io/' + slug +
     '\nLink aceita submissões anônimas após publish.' :
     'Form ficará indisponível em URL pública.\nSubmissões existentes preservadas.'}

   Confirma?
   ```
6. **Aguardar "sim"**.
7. **UPDATE atomic:**
   ```sql
   UPDATE evaluation_forms
   SET active = ({action} = 'publish'),
       public_url = CASE WHEN {action} = 'publish'
                    THEN 'https://forms.archprime.io/' || slug
                    ELSE public_url END,
       updated_at = NOW()
   WHERE id = {form_id}
   RETURNING id, slug, active, public_url;
   ```
   0 rows → ESCALATE (`form_not_found`).
8. **Tratar erros:** 42501 → BLOCKED (RLS).
9. **Activity log:** `action='content-builder.publish_onboarding_form'` ou `unpublish_onboarding_form`, details com form_id + slug + active_before/after.
10. **Echo:**
    - publish: "✓ Form publicado. URL: {public_url}. Compartilhe o link manualmente com o cliente/lead."
    - unpublish: "✓ Form despublicado. URL retorna 404/indisponível. Submissões existentes em DB preservadas."

### acceptance_criteria

- **[A1] Role gating:** cs/marketing/admin/owner.
- **[A2] Transition validation:** já publicado/despublicado = ESCALATE.
- **[A3] Confirmation OBRIGATÓRIO:** publish = público, muda visibilidade do link.
- **[A4] Audit log:** before/after `active`.
- **[A5] Unpublish preserva submissões:** apenas link público deixa de servir; linhas em `evaluation_responses` não são tocadas.

---

## Exemplos

### Exemplo 1 — Jessica publica onboarding genérico

**Input:** `form_id`, `action='publish'`

**Specialist:** `active=false` ✓ → confirmation → "sim" → UPDATE `active=true` → DONE com URL pública.

### Exemplo 2 — Já publicado → ESCALATE

**Input:** `action='publish'` mas form já `active=true`

**Specialist:** ESCALATE com:
```
Form «{title}» já está ativo/publicado.
Para alterações: edite os campos via manage-form-fields; para reset, unpublish primeiro.
```

### Exemplo 3 — Unpublish

**Input:** `action='unpublish'`, form `active=true`

**Specialist:** confirmation → UPDATE `active=false` → DONE.

---

## Notas

- **Sem `status`/`published_at`/`updated_by`/`version`:** `evaluation_forms` só tem `active boolean` + `public_url text`. Não há optimistic lock (coluna `version` não existe nesta tabela) nem trigger de versionamento — ambos removidos desta task.
- **Public URL:** `forms.archprime.io/{slug}` (subdomain dedicado para forms), persistido em `evaluation_forms.public_url` no momento do publish.
- **Submission:** público pode INSERT em `evaluation_responses` (**não** `evaluation_form_responses`) quando `evaluation_forms.active=true` (RLS policy).
- **Notificação ao cliente:** a Edge Function `send-form-notification` **não existe** no projeto — removida desta task. Se for necessário notificar por e-mail, isso deve ser feito por outro canal (ex: `manage-email-sequence`) ou compartilhamento manual do link; não há `target_customer_id` em `evaluation_forms` para automatizar isso hoje.

---

**Mantido por:** content-builder

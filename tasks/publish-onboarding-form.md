# Task: publish-onboarding-form

> Toggle status de `evaluation_forms` entre `'draft'` e `'published'`. Após publish, form aceita submissões via link público. Reversível via unpublish. Implementa F-05.3 publish flow.

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
  - `notify_customer` (bool, opcional default false — se true e form tem target_customer_id, envia email com link)
  - `version` (int — optimistic lock)

### output

- **`form_id`**, **`slug`**, **`status`**, **`published_at`**, **`public_url`**
- **`notification_status`** (`'sent' | 'skipped' | 'failed'`)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** cs/marketing/admin/owner.
2. **Resolver form** por id ou slug. 0 match → ESCALATE.
3. **Validar action** ∈ `('publish', 'unpublish')`.
4. **Validar status atual vs action:**
   - `publish` + atual='published' → ESCALATE (`already_published`)
   - `publish` + atual='draft' → OK
   - `unpublish` + atual='published' → OK
   - `unpublish` + atual='draft' → ESCALATE (`already_unpublished`)
5. **Validar conteúdo (apenas publish):**
   - questions array length > 0
   - Sem questions inválidas
6. **Confirmation:**
   ```
   ATENÇÃO: vou {publish | unpublish} form «{name}»
   Slug: {slug}
   {publish ?
     'URL pública: https://forms.archprime.io/' + slug +
     '\nLink aceita submissões anônimas após publish.' +
     '\nQuestions: ' + N +
     (target_customer_id ? '\nEspecífico para: ' + customer_name : '\nGenérico (qualquer pessoa pode submeter)') :
     'Form ficará indisponível em URL pública.\nSubmissões existentes preservadas.'}
   {notify_customer ? '\n📧 Customer ' + customer_email + ' será notificado com link.' : ''}

   Confirma?
   ```
7. **Aguardar "sim"**.
8. **UPDATE atomic com optimistic lock:**
   ```sql
   UPDATE evaluation_forms
   SET status = CASE WHEN {action}='publish' THEN 'published' ELSE 'draft' END,
       published_at = CASE WHEN {action}='publish' THEN NOW() ELSE NULL END,
       updated_by = auth.uid(),
       updated_at = NOW()
   WHERE id = {form_id} AND version = {expected_version}
   RETURNING id, slug, status, published_at, version;
   ```
9. **Tratar erros:**
   - 0 rows → CONFLICT (version mismatch)
   - 42501 → BLOCKED
10. **Notify customer (se publish + flag + target_customer):**
    - Invoke edge `send-form-notification` com customer_email + public_url
    - Falha não bloqueia — log warning
11. **Activity log:** `action='content-builder.publish_onboarding_form'` ou `unpublish_onboarding_form`, details com form_id + slug + status_change + notify_status.
12. **Echo:**
    - publish: "✓ Form publicado. URL: {public_url}. {notify ? 'Email enviado para customer.' : 'Compartilhe o link manualmente.'}"
    - unpublish: "✓ Form despublicado. URL retorna 404. Submissões existentes em DB preservadas."

### acceptance_criteria

- **[A1] Role gating:** cs/marketing/admin/owner.
- **[A2] Status transition validation:** já publicado/despublicado = ESCALATE.
- **[A3] Content validation publish:** zero questions = BLOCKED.
- **[A4] Optimistic lock via version:** evita race entre 2 publishers.
- **[A5] Confirmation OBRIGATÓRIO:** publish = público, irreversível link visibility.
- **[A6] Notification opt-in:** notify_customer só dispara se flag + target_customer_id.
- **[A7] Audit log:** before/after status + notification result.
- **[A8] Unpublish preserva submissões:** apenas link público desaparece.

---

## Exemplos

### Exemplo 1 — Jessica publica onboarding genérico

**Input:** `form_id`, `action='publish'`, sem notify

**Specialist:** atual=draft ✓ → confirmation → "sim" → UPDATE → DONE com URL pública.

### Exemplo 2 — Publish + notify para target customer

**Input:** form com `target_customer_id=Marco`, `notify_customer=true`

**Specialist:** publish ✓ + invoke send-form-notification → email enviado → echo "Form publicado + Marco notificado por email."

### Exemplo 3 — Já publicado → ESCALATE

**Input:** action='publish' mas form já published

**Specialist:** ESCALATE com:
```
Form «{name}» já está published (desde {published_at}).
Para alterações: edite via UI editor + re-publish criará nova version
(Sprint futuro). Para reset: unpublish primeiro.
```

---

## Notas

- **Public URL:** `forms.archprime.io/{slug}` (subdomain dedicado para forms).
- **Submission RLS:** público pode INSERT em `evaluation_form_responses` se form.status='published' (RLS policy).
- **Notification edge:** `send-form-notification` usa Resend transacional. Templates por form_type (onboarding, nps, satisfaction).
- **Version increment:** trigger BEFORE UPDATE incrementa `version` automaticamente.

---

**Mantido por:** content-builder

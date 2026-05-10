# Task: create-onboarding-form

> Criar template de formulário de onboarding (NPS, satisfação, checklist pós-venda) em `evaluation_forms`. CS configura por cliente novo. Implementa F-05.3.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Create Onboarding Form`

### responsible_executor
`content-builder` (mesmo agent que cria LPs/forms)

### execution_type
`Agent` — confirmation simples (template é editável depois).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `name` (string, obrigatório — ex: "Onboarding Pós-Venda Q3")
  - `slug` (string opcional, derivado do name)
  - `form_type` (`'onboarding' | 'nps' | 'satisfaction' | 'feedback'`)
  - `questions` (array de `{label, type, required, options?}`):
    - `type`: `'text' | 'long_text' | 'rating_1_10' | 'multiple_choice' | 'date' | 'checkbox'`
  - `target_customer_id` (uuid opcional — form específico para 1 cliente)
  - `template_from` (uuid opcional — clonar form existente)

### output

- **`form_id`** (uuid)
- **`slug`**, **`status`** (`'draft'` inicialmente)
- **`public_url_preview`** (URL que ficará disponível após publish)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** cs/marketing/admin/owner. Outros → BLOCKED.
2. **Validar name** 3..200 chars + slug uniqueness em `evaluation_forms`.
3. **Validar questions:**
   - Min 1, max 50
   - Cada question: `label` (3..500 chars), `type` válido
   - Se `multiple_choice`: `options` array obrigatório, min 2
   - Se `rating_1_10`: range válido
4. **Resolver `template_from`** (se passado):
   - SELECT questions do form template + clonar
5. **Confirmation:**
   ```
   Vou criar onboarding form «{name}»:
     Type: {form_type}
     Slug: {slug}
     Questions: {N}
       {preview 5 questions: label + type}
     {target_customer_id ? 'Específico para customer: ' + customer_name : 'Genérico (público)'}
     Status inicial: draft (não público até publish-onboarding-form)
   Confirma?
   ```
6. **INSERT:**
   ```sql
   INSERT INTO evaluation_forms
     (name, slug, form_type, questions, target_customer_id,
      status, created_by)
   VALUES (..., 'draft', auth.uid()) RETURNING id;
   ```
7. **Activity log:** action='content-builder.create_onboarding_form', details com form_id + question_count + form_type.
8. **Echo:**
   ```
   ✓ Form criado (status=draft)
   Form ID: {form_id}
   Preview URL (após publish): https://forms.archprime.io/{slug}
   {N} questions registradas

   Próximos passos:
   1. Edit via UI EvaluationFormBuilderPage (se quiser refinar)
   2. Publish via publish-onboarding-form quando pronto
   3. Após publish, link público + envio para customer
   ```

### acceptance_criteria

- **[A1] Role gating:** cs/marketing/admin/owner.
- **[A2] Slug uniqueness:** UNIQUE constraint.
- **[A3] Question validation:** types/options/labels.
- **[A4] Status starts draft:** never public until explicit publish.
- **[A5] Template clone:** se passado template_from, copia questions exact.
- **[A6] Confirmation:** mostra preview de 5 questions + N total.
- **[A7] Audit:** activity_log com counts.
- **[A8] No silent publish:** task NUNCA muda status para published.

---

## Exemplos

### Exemplo 1 — Jessica cria onboarding genérico

**Input:** `name='Onboarding Q3 2026'`, `form_type='onboarding'`, `questions=[{label:'Como conheceu a Arch Prime?', type:'long_text', required:true}, {label:'Nota inicial 1-10', type:'rating_1_10', required:true}, ...]`

**Specialist:** valid → confirmation → INSERT → DONE com slug `onboarding-q3-2026`.

### Exemplo 2 — Clone de template

**Input:** `name='Onboarding Marco Rossi'`, `template_from={uuid_template_genérico}`, `target_customer_id={marco_id}`

**Specialist:** clona questions do template + linka ao customer → DONE.

### Exemplo 3 — Comercial tenta → BLOCKED

**Input:** Daniel → BLOCKED com mensagem.

---

## Notas

- **`evaluation_forms`:** schema compartilhado com módulos CRM (lead qualification) + CS (onboarding) + Eventos (pré-qualificação).
- **Public submission:** após publish, link `forms.archprime.io/{slug}` aceita submissões anônimas (RLS-bypassed via token).
- **AI generation (Sprint futuro):** `generate-onboarding-form-ai` poderia gerar questions baseado em customer profile + product.
- **Versioning:** updates em form publicado criam nova version (Sprint futuro).

---

**Mantido por:** content-builder

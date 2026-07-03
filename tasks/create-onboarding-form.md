# Task: create-onboarding-form

> Criar form (onboarding/NPS/satisfação/feedback) em `evaluation_forms`. CS configura por cliente novo. Implementa F-05.3.
>
> ⛔ **DÉBITO DE SCHEMA CONHECIDO — a cadeia form → campos NÃO fecha hoje.** `form_fields` referencia `form_templates.id`, **não** `evaluation_forms.id`. Criar o form aqui e depois "adicionar campos" via `manage-form-fields` (que opera em `form_templates`) NÃO conecta ponta a ponta. **Encaminhamento:** ESCALATE para @data-engineer — solução proposta é a coluna-ponte `evaluation_forms.form_template_id uuid REFERENCES form_templates(id)` (migration idempotente + RLS). Enquanto não existir, AVISE o user que os campos ficam órfãos do form. Mesmo débito em `manage-form-fields.md`.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Create Onboarding Form`

### responsible_executor
`content-builder` (mesmo agent que cria LPs/forms)

### execution_type
`Agent` — confirmation simples (form nasce inativo; campos são adicionados depois via task própria).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `title` (string, obrigatório, 3..200 chars — ex: "Onboarding Pós-Venda Q3")
  - `slug` (string, obrigatório — derivar do title se omitido; UNIQUE em `evaluation_forms`)
  - `form_type` (string, obrigatório — convenção de negócio: `'onboarding' | 'nps' | 'satisfaction' | 'feedback'`; é coluna `text` livre no banco, **não** um enum de DB)
  - `description` (string, opcional)
  - `brand_id` (uuid, **obrigatório** — multi-empresa, FK → `editorial_brands`). **SEMPRE perguntar explicitamente, nunca assumir/defaultar.**

> **Campos/perguntas do form NÃO entram nesta task.** `evaluation_forms` não tem coluna `questions`. Depois de criado o form (inativo), adicione os campos via task `manage-form-fields` (grava em `form_fields`, com `translations` IT+PT por campo).

### output

- **`form_id`** (uuid)
- **`slug`**, **`active`** (`false` inicialmente)
- **`public_url_preview`** (URL que ficará disponível após publish — via `publish-onboarding-form`)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** cs/marketing/admin/owner. Outros → BLOCKED.
2. **Validar title** 3..200 chars + slug uniqueness em `evaluation_forms`.
3. **brand_id obrigatório:** perguntar explicitamente ("Qual empresa?") — NUNCA defaultar. Confirmar que `brand_id` existe em `editorial_brands`.
4. **Confirmation:**
   ```
   Vou criar form «{title}»:
     Type: {form_type}
     Slug: {slug}
     Brand: {brand_name}
     Status inicial: inativo (active=false — não público até publish-onboarding-form)
   Confirma?
   ```
5. **INSERT:**
   ```sql
   INSERT INTO evaluation_forms
     (title, slug, form_type, description, brand_id, active, created_by)
   VALUES ({title}, {slug}, {form_type}, {description}, {brand_id}, false, auth.uid())
   RETURNING id;
   ```
6. **Activity log:** action='content-builder.create_onboarding_form', details com form_id + form_type + brand_id.
7. **Echo:**
   ```
   ✓ Form criado (active=false)
   Form ID: {form_id}
   Preview URL (após publish): https://forms.archprime.io/{slug}

   Próximos passos:
   1. Adicionar campos via manage-form-fields (form_fields, translations IT+PT)
   2. Publish via publish-onboarding-form quando pronto (active=true)
   ```

### acceptance_criteria

- **[A1] Role gating:** cs/marketing/admin/owner.
- **[A2] Slug uniqueness:** UNIQUE constraint em `evaluation_forms`.
- **[A3] brand_id obrigatório:** nunca defaultar (forbidden_defaults).
- **[A4] Status starts inactive:** `active=false`, nunca público sem publish explícito.
- **[A5] Confirmation:** mostra title/type/slug/brand antes de gravar.
- **[A6] Audit:** activity_log com form_id + brand_id.
- **[A7] No silent publish:** task NUNCA seta `active=true`.
- **[A8] Fields à parte:** task NÃO grava perguntas/campos — delega a `manage-form-fields`.
- **[A9] Débito de schema explicitado:** a task AVISA que a ligação form→campos não fecha hoje (falta ponte `evaluation_forms.form_template_id`) — não afirma fluxo completo.

---

## Exemplos

### Exemplo 1 — Jessica cria onboarding genérico

**Input:** `title='Onboarding Q3 2026'`, `form_type='onboarding'`, `brand_id={archprime_brand_id}`

**Specialist:** valida → confirmation → INSERT → DONE com slug `onboarding-q3-2026`, `active=false`.

### Exemplo 2 — brand_id omitido → pergunta obrigatória

**Input:** `title='Onboarding Lovarch'` sem brand_id

**Specialist:** NÃO assume — pergunta "Qual empresa? (ArchPrime / Lovarch / ...)" antes de prosseguir.

### Exemplo 3 — Comercial tenta → BLOCKED

**Input:** Daniel → BLOCKED com mensagem.

---

## Notas

- **`evaluation_forms` — NOT NULL reais (schema):** `slug`, `title`. `brand_id` é nullable no schema mas **obrigatório por regra de negócio** (multi-empresa) — sempre perguntar, nunca defaultar.
- **Sem coluna `name`/`status`/`questions`/`target_customer_id`/`published_at`/`version`** — a tabela só tem `active boolean`. O ciclo draft→published vira `active=false→true` (ver `publish-onboarding-form`).
- **Campos/perguntas — CADEIA ABERTA (ver callout no topo):** `form_fields.form_template_id` → `form_templates.id`, **não** → `evaluation_forms.id`. Hoje NÃO há caminho "evaluation_forms → seus form_fields". **Solução proposta (decisão @data-engineer):** coluna-ponte `evaluation_forms.form_template_id uuid REFERENCES form_templates(id)` + `manage-form-fields` resolve o template pelo form; migration idempotente (`DO $$ IF NOT EXISTS`) + RLS. Até lá, o fluxo "criar onboarding-form → adicionar perguntas" é INCOMPLETO — não prometer ao user que fecha.
- **Public submission:** após publish (`active=true`), respostas chegam em `evaluation_responses` (**não** `evaluation_form_responses`).
- **Versioning/AI generation de questions:** fora do escopo desta task (sprint futuro).

---

**Mantido por:** content-builder

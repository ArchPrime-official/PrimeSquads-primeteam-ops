# Task: create-cms-page

> Task atômica para criar uma nova linha em `cms_pages` (CMS multi-domain — lovarch.com + archprime.io). **SEMPRE status='draft'** na criação — publicação é operação separada (`publish-cms-page`). Valida slug kebab-case + uniqueness por (target_domain, slug). Não confundir com `landing_pages` (legacy lp.archprime.io) — `cms_pages` é o novo CMS visual de Fase 0+1+2 (PRs PrimeTeam #1181, #1182, #1188, #1191, #1195).

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Create CMS Page`

### status
`pending`

### responsible_executor
`content-builder` (CMS Pages module — adicionado pós-Sprint 17 quando Fase 2 do CMS shippou)

### execution_type
`Agent` — LLM + Supabase. Human intervention apenas no confirmation step antes do INSERT.

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `slug` (string, obrigatório — kebab-case, único por target_domain)
  - `target_domain` (`'lovarch.com'` | `'archprime.io'`, obrigatório)
  - `locale` (`'it'` | `'en'` | `'pt'` | `'es'`, default `'it'`)
  - `blocks` (array opcional — se ausente, cria com `[]`. Editor visual em /admin/cms preenche via UI depois)
  - `seo` (objeto opcional — `{ title?, description?, og_image?, canonical?, robots? }`)

### output

- **`cms_page_id`** — uuid da row criada
- **`slug`** — slug final validado
- **`target_domain`** — domínio alvo
- **`status`** — sempre `'draft'`
- **`version`** — `0` (incrementa a cada save)
- **`public_url_when_published`** — `https://{target_domain}/page/{slug}` (válido apenas após publicação)
- **`admin_edit_url`** — `https://primeteam.archprime.io/admin/cms?id={cms_page_id}` (UI visual editor)
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`next_step_suggestion`** — "Use admin /cms editor visual para adicionar blocos OU publish-cms-page para publicar"
- **`convention_check`**:
  - Slug kebab-case: ✓
  - Slug unique por target_domain: ✓
  - status=draft (safe default): ✓
  - RLS respected (cms_can_edit): ✓
  - JWT scoped: ✓

### action_items

1. **Parse input** — extrair slug + target_domain + locale + optional blocks/seo.
2. **Validar slug regex** `^[a-z0-9]+(-[a-z0-9]+)*$`. Se inválido, tentar conversion (lowercase + replace spaces/underscores com `-` + strip accents) e ECHOAR: "Vou usar slug 'X' (convertido de 'Y'). Confirma?"
3. **Validar target_domain** ∈ `{'lovarch.com', 'archprime.io'}`. Se outro: BLOCKED com explicação.
4. **Validar locale** ∈ `{'it', 'en', 'pt', 'es'}`. Default `'it'` se ausente.
5. **Check uniqueness** — `SELECT id FROM cms_pages WHERE target_domain = ? AND slug = ?`.
   - 0 matches: OK, prosseguir.
   - 1+ match: ESCALATE com 3 options:
     a) Usar slug alternativo (sugestão: `{slug}-v2`, `{slug}-{ano}`)
     b) Editar a existente: `https://primeteam.archprime.io/admin/cms?id={existing_id}`
     c) Trocar target_domain (se semantically faz sentido — ex. mesma promo, dois domínios)
6. **Validar blocks** — se fornecido, deve ser `Array<unknown>`, length 0..40. Se vazio array: warning "Página criada vazia — use admin UI para adicionar blocos."
7. **Validar seo** — se fornecido, deve ser objeto plain (não array). Campos opcionais validados shallow (urls válidas se presentes). Default `{}`.
8. **Auto-set campos**:
   - `created_by = auth.uid()`
   - `status = 'draft'` (NUNCA publish na criação)
   - `version = 0`
   - `published_at = NULL`
9. **Confirmation message** — mostrar campos resolvidos:
   ```
   Vou criar página CMS:
   slug: {slug}
   domínio: {target_domain}
   idioma: {locale}
   blocos: {blocks.length} (use admin UI para editar)
   SEO: {seo.title or "—"}
   status: DRAFT
   URL pública (quando publicar): https://{target_domain}/page/{slug}
   Editor: https://primeteam.archprime.io/admin/cms (selecione esta página)
   Confirma?
   ```
10. **Aguardar confirmação** — "sim" prossegue, "não" ESCALATE.
11. **Executar INSERT** via Supabase (user JWT):
    ```sql
    INSERT INTO cms_pages
      (slug, target_domain, locale, blocks, seo, status, version, created_by)
    VALUES
      ({slug}, {target_domain}, {locale}, {blocks::jsonb}, {seo::jsonb},
       'draft', 0, auth.uid())
    RETURNING id, slug, target_domain, locale, status, version;
    ```
12. **Tratar erros**:
    - 42501 (RLS) → BLOCKED com role explanation: "INSERT em cms_pages exige owner+admin+marketing. Sua role atual: {role}. Peça a Sandra (marketing) ou Pablo (owner) para criar."
    - 23505 (unique violation em (target_domain, slug)) → ESCALATE com retry sugestion (race condition rara)
    - 23514 (CHECK constraint) → BLOCKED indicando qual constraint violou (slug regex / blocks size / seo type)
    - 5xx → retry 1x → ESCALATE
13. **Registrar activity_log** — INSERT em `activity_logs` com `action='content-builder.create_cms_page'`, `details={slug, target_domain, cycle_id, before:null, after:{id,status:'draft'}}`. Failure tolerante.
14. **Populate next_step_suggestion**:
    - Se blocks vazio: "Abra https://primeteam.archprime.io/admin/cms, selecione a página, use o editor visual (palette + drag-drop) para adicionar Hero/CTA/FeatureGrid/Testimonials/Pricing. Depois use publish-cms-page."
    - Se blocks fornecidos: "Use publish-cms-page para tornar a página acessível em https://{target_domain}/page/{slug}."
15. **Retornar ao chief** — V10 + V11 + V18 com cms_page_id + URLs.

### acceptance_criteria

- **[A1] Slug + target_domain required:** ambos obrigatórios. Falta = ESCALATE.
- **[A2] Slug regex validation:** kebab-case enforced. Conversion attempt echoed antes de prosseguir.
- **[A3] Slug uniqueness por target_domain:** SELECT prévio obrigatório. Collision = ESCALATE com 3 options, nunca overwrite silencioso.
- **[A4] Status=draft forced:** NUNCA `'published'` na criação. Publicação = separate cycle via publish-cms-page.
- **[A5] target_domain restricted:** apenas `lovarch.com` ou `archprime.io`. Outros = BLOCKED.
- **[A6] locale restricted:** apenas `it`, `en`, `pt`, `es`. Default `it`.
- **[A7] JWT scoping:** INSERT usa user JWT. `created_by = auth.uid()`. Helper `cms_can_edit(auth.uid())` na RLS valida (owner+admin+marketing).
- **[A8] Activity log:** INSERT em `activity_logs` após mutation, fail-tolerant.

---

## Exemplos de execução

### Exemplo 1 — Happy path com blocks vazio (DONE)

**Input:** `"criar página CMS slug 'promo-italia-jun26' em archprime.io, idioma it, vazia"`

**Specialist:**
1. slug regex ✓, target_domain `archprime.io` ✓, locale `it` ✓
2. SELECT WHERE target_domain='archprime.io' AND slug='promo-italia-jun26' → 0 matches ✓
3. blocks=[], seo={}
4. Confirmation echoed (user confirma)
5. INSERT → cms_page_id=cms-a1b2... status=draft

**Return:**
```
[content-builder → ops-chief] Cycle cyc-... — DONE.

cms_page_id: cms-a1b2...
slug: promo-italia-jun26
target_domain: archprime.io
locale: it
status: draft
version: 0
public_url_when_published: https://archprime.io/page/promo-italia-jun26
admin_edit_url: https://primeteam.archprime.io/admin/cms
next_step_suggestion: |
  "Página criada vazia. Abra o admin /cms, selecione 'promo-italia-jun26',
   use o editor visual para adicionar Hero/CTA/FeatureGrid/Testimonials/Pricing.
   Depois use publish-cms-page para publicar."
convention_check: slug kebab-case ✓ | unique ✓ | draft ✓ | RLS ✓
```

### Exemplo 2 — Slug colisão (ESCALATE)

**Input:** `"criar página slug 'home' em lovarch.com"`

**Specialist:** SELECT WHERE target_domain='lovarch.com' AND slug='home' → 1 match (existing).

**Return:**
```
[content-builder → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Já existe página 'home' em lovarch.com (id=cms-x1y2..., status=published,
  versão 7). Opções:
  1. Editar a existente: https://primeteam.archprime.io/admin/cms?id=cms-x1y2...
  2. Usar slug alternativo: 'home-v2', 'home-promo-jun26', 'home-italia'
  3. Criar em archprime.io (mesma slug pode coexistir entre domínios)
  Qual?"
context_for_retry:
  existing_id: cms-x1y2...
  existing_status: published
  existing_version: 7
```

### Exemplo 3 — RLS denial (BLOCKED)

**Input:** user role=cs tentando criar página CMS.

**Specialist:** INSERT → 42501 (cms_pages RLS exige `cms_can_edit` = owner+admin+marketing).

**Return:**
```
[content-builder → ops-chief] Cycle cyc-... — BLOCKED.

verdict: BLOCKED
error: { code: 42501, detail: "row-level security policy denied" }
warnings: |
  Sua role (cs) não tem permissão para criar cms_pages. Helper cms_can_edit
  permite apenas owner, admin e marketing.
suggested_user_message: |
  "Criação de CMS pages é restrita a roles owner/admin/marketing. Sua role
   atual é cs. Peça a Sandra (marketing) ou Pablo (owner) para criar a página."
```

---

## Notas de implementação

- **CMS vs Landing Pages legacy:** `cms_pages` é o NOVO CMS visual (Fase 0+1+2 shippadas em 2026-05-03). Renderiza em `lovarch.com/page/:slug` e `archprime.io/page/:slug`. **NÃO confundir com `landing_pages`** (sistema legacy em `lp.archprime.io/{slug}`, criado por `create-landing-page` task). Os dois coexistem indefinidamente.
- **Block-based content:** O conteúdo da página é o array `blocks` (JSONB). Tipos suportados v0.1.x: `hero`, `cta`, `feature-grid`, `testimonials`, `pricing`. Schemas Zod em `supabase/functions/_shared/cms-schemas.ts`. CLI **não gera blocks** — apenas cria a página vazia/com blocks fornecidos. Edição visual = admin UI `/admin/cms`.
- **Optimistic locking:** `version` incrementa a cada save. Tasks de edit (futuro) deverão passar `version` esperada para detectar conflitos concorrentes.
- **Slug é único por (target_domain, slug):** mesma slug pode existir em lovarch.com E archprime.io independentemente.
- **Safe by default:** página sempre nasce em `status='draft'`. Exige separate cycle (`publish-cms-page`) para tornar pública.

---

**Mantido por:** content-builder.

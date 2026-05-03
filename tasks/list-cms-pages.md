# Task: list-cms-pages

> Task atômica para listar páginas em `cms_pages` com filtros opcionais. Read-only — não muta. Não confundir com `list-landing-pages` (legacy `landing_pages` em lp.archprime.io).

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`List CMS Pages`

### status
`pending`

### responsible_executor
`content-builder` (CMS Pages module)

### execution_type
`Agent` — LLM + Supabase. Read-only, sem confirmation.

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Filters opcionais**:
  - `target_domain` (`'lovarch.com'` | `'archprime.io'`)
  - `locale` (`'it'` | `'en'` | `'pt'` | `'es'`)
  - `status` (`'draft'` | `'published'` | `'archived'`)
  - `q` (string — search ILIKE em slug)
  - `created_by` (uuid — pages criadas por user específico)
  - `updated_after` (ISO date — `updated_at >= ?`)
  - `limit` (int, default 50, max 200)

### output

- **`pages`**: array de `{ id, slug, target_domain, locale, status, version, updated_at, published_at, created_by, blocks_count }` (NÃO retorna `blocks` completo — payload pode ser grande; use admin UI para ver)
- **`count`**: total de páginas (sem aplicar limit)
- **`filters_applied`**: echo dos filtros usados
- **`verdict`**: DONE | BLOCKED
- **`next_step_suggestion`**: contextual ("Use create-cms-page para criar nova" se vazio, "Use publish-cms-page para publicar drafts" se há drafts)

### action_items

1. **Parse filters** — extrair filtros opcionais do input. Sem filtros = list all (limited).
2. **Validar valores enum** — se `target_domain`, `locale`, `status` fornecidos, validar enum. Inválido = BLOCKED.
3. **Validar limit** — clamp entre 1 e 200. Default 50.
4. **Construir query** com WHERE conditional:
   ```sql
   SELECT id, slug, target_domain, locale, status, version,
          updated_at, published_at, created_by,
          jsonb_array_length(blocks) AS blocks_count
   FROM cms_pages
   WHERE
     (target_domain = ? OR ? IS NULL) AND
     (locale = ? OR ? IS NULL) AND
     (status = ? OR ? IS NULL) AND
     (slug ILIKE '%' || ? || '%' OR ? IS NULL) AND
     (created_by = ? OR ? IS NULL) AND
     (updated_at >= ? OR ? IS NULL)
   ORDER BY updated_at DESC
   LIMIT {limit};
   ```
5. **Count separado** (sem limit) para `count`:
   ```sql
   SELECT count(*) FROM cms_pages WHERE {same filters};
   ```
6. **Tratar erros**:
   - 42501 (RLS) → BLOCKED. CMS pages têm RLS read public para `status='published'`, mas drafts/archived só para `cms_can_edit`. Se user não tem perm, retornará apenas published.
   - 5xx → retry 1x → ESCALATE
7. **Format table output** para o chief mostrar ao user:
   ```
   | # | Domínio | Slug | Lang | Status | v | Blocos | Atualizado |
   |---|---------|------|------|--------|---|--------|------------|
   | 1 | lovarch.com | promo-italia-jun26 | it | published | 3 | 5 | 2026-05-03 21:00 |
   ```
8. **Populate next_step_suggestion**:
   - Se 0 results: "Use create-cms-page para criar a primeira."
   - Se há drafts: "Há N drafts. Use publish-cms-page para publicar quando estiver pronto."
   - Se filtros não retornaram: sugerir afrouxar (ex. tirar status=published, ampliar updated_after)
9. **Retornar ao chief** — V10 + V11 com pages array + table-formatted markdown.

### acceptance_criteria

- **[A1] Filtros enum validados:** target_domain, locale, status restringidos ao enum. Inválido = BLOCKED.
- **[A2] Limit clamped:** 1 ≤ limit ≤ 200. Default 50.
- **[A3] Read-only:** zero mutations. Apenas SELECT.
- **[A4] RLS-aware:** anonymous reads veem apenas `status='published'`. Authenticated com cms_can_edit veem tudo. Esta task usa user JWT, então perfis editores veem drafts.
- **[A5] Blocks NOT returned:** retorna apenas `blocks_count` (size). Payload completo é grande — para edit, usuário usa admin UI.
- **[A6] Output sortable:** ORDER BY updated_at DESC. Mais recente primeiro.

---

## Exemplos de execução

### Exemplo 1 — Listar todos publicados em lovarch.com (DONE)

**Input:** `"listar páginas publicadas no lovarch"`

**Specialist:** filters = `{ target_domain: 'lovarch.com', status: 'published' }`. SELECT → 4 rows.

**Return:**
```
[content-builder → ops-chief] Cycle cyc-... — DONE.

count: 4
pages: [
  { id: cms-1..., slug: home, target_domain: lovarch.com, locale: it, status: published, version: 7, blocks_count: 8, updated_at: 2026-05-03T21:00:00Z, published_at: 2026-05-03T20:55:00Z },
  { id: cms-2..., slug: cms-fase-0-smoke, ... },
  ...
]
table_view: |
  | # | Domínio | Slug | Lang | Status | v | Blocos | Atualizado |
  |---|---------|------|------|--------|---|--------|------------|
  | 1 | lovarch.com | home | it | published | 7 | 8 | 2026-05-03 21:00 |
  | 2 | lovarch.com | cms-fase-0-smoke | it | published | 1 | 3 | 2026-05-03 17:30 |
  | 3 | lovarch.com | promo-aprile | it | published | 2 | 5 | 2026-04-15 10:22 |
  | 4 | lovarch.com | metodo | pt | published | 4 | 6 | 2026-04-10 14:11 |
filters_applied: { target_domain: lovarch.com, status: published }
next_step_suggestion: "Para editar qualquer uma, abra https://primeteam.archprime.io/admin/cms"
```

### Exemplo 2 — Search por slug (DONE)

**Input:** `"procura páginas com 'italia' no slug"`

**Specialist:** filters = `{ q: 'italia' }`. ILIKE %italia% → 2 results.

**Return:**
```
table_view: |
  | # | Domínio | Slug | Lang | Status | v | Blocos | Atualizado |
  | 1 | archprime.io | promo-italia-jun26 | it | draft | 0 | 0 | 2026-05-03 21:30 |
  | 2 | lovarch.com | italia-1k-signups | it | draft | 1 | 4 | 2026-04-28 16:10 |
next_step_suggestion: "Há 2 drafts com 'italia'. Use publish-cms-page para publicar."
```

### Exemplo 3 — Filtro inválido (BLOCKED)

**Input:** `"listar páginas com target_domain='loverch.com'"` (typo)

**Specialist:** target_domain inválido (não está no enum).

**Return:**
```
verdict: BLOCKED
error: { code: 'invalid_filter', field: 'target_domain', value: 'loverch.com' }
suggested_user_message: |
  "target_domain inválido: 'loverch.com'. Valores aceitos: 'lovarch.com' ou 'archprime.io'.
   Você quis dizer 'lovarch.com'?"
```

---

## Notas de implementação

- **Read RLS:** Policy de SELECT em `cms_pages` permite anonymous reads para `status='published'`. Para drafts/archived, o JWT do user deve passar em `cms_can_edit(auth.uid())`. Essa task usa user JWT, então marketing/admin/owner veem tudo; outros veem apenas published.
- **Performance:** índices em `(target_domain, slug)` (UNIQUE) + `(target_domain, status, locale)` cobrem os filtros mais comuns. Sem precisar otimizar pra Sprint 23.
- **`blocks_count` via jsonb_array_length:** evita devolver `blocks` cheio (que pode ser ~50-200KB por página). Para inspecionar conteúdo, usuário abre admin UI.

---

**Mantido por:** content-builder.

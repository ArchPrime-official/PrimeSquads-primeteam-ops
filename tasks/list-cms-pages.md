# Task: list-cms-pages

> Task atômica para listar páginas em `landing_pages` com filtros opcionais. Read-only — não muta. Pós-convergência 2026-05-04 (PrimeTeam PR #1226), `cms_pages` foi consolidada em `landing_pages` (tabela única para `lp.archprime.io` + `lovarch.com` + `archprime.io`).
>
> Nota: como é read-only, não há débito Lovarch dual-renderer aqui (não muta nada). Mas vale lembrar: páginas em `lovarch.com`/`archprime.io` são renderizadas pelo Next.js no repo `ByPabloRuanL/lovarch`. Ver `data/cms-vs-landing-pages.md`.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy

### task_name
`List Landing Pages`

### status
`pending`

### responsible_executor
`content-builder`

### execution_type
`Agent` — read-only, sem confirmation.

### input

- **Cycle ID**, **User JWT**
- **Filters opcionais**:
  - `target_domain` (`'lp.archprime.io'` | `'lovarch.com'` | `'archprime.io'`)
  - `locale` (`'it'` | `'en'` | `'pt'` | `'es'`)
  - `status` (`'draft'` | `'published'` | `'archived'`)
  - `active` (`true` | `false`) — filtra pelo flag de runtime
  - `q` (string — search ILIKE em slug)
  - `campaign_id` (uuid — pages de uma campanha específica)
  - `created_by` (uuid)
  - `updated_after` (ISO date)
  - `limit` (int, default 50, max 200)

### output

- **`pages`**: array de `{ id, slug, target_domain, locale, title, status, active, version, updated_at, published_at, campaign_id, redirect_to, redirect_to_slug, views, submissions, html_size }` (NÃO retorna `html_content` completo — payload pode ser ~MB)
- **`count`**: total
- **`filters_applied`**: echo
- **`verdict`**: DONE | BLOCKED
- **`next_step_suggestion`**

### action_items

1. **Parse filters** — extrair filtros opcionais. Sem filtros = list all (limited).
2. **Validar enums** — target_domain, locale, status. Inválido = BLOCKED.
3. **Validar limit** — clamp 1..200. Default 50.
4. **Construir query**:
   ```sql
   SELECT id, slug, target_domain, locale, title, status, active, version,
          updated_at, published_at, campaign_id, redirect_to, redirect_to_slug,
          views, submissions,
          coalesce(length(html_content), 0) AS html_size
   FROM landing_pages
   WHERE
     (target_domain = ? OR ? IS NULL) AND
     (locale = ? OR ? IS NULL) AND
     (status = ? OR ? IS NULL) AND
     (active = ? OR ? IS NULL) AND
     (slug ILIKE '%' || ? || '%' OR ? IS NULL) AND
     (campaign_id = ? OR ? IS NULL) AND
     (created_by = ? OR ? IS NULL) AND
     (updated_at >= ? OR ? IS NULL)
   ORDER BY updated_at DESC
   LIMIT {limit};
   ```
5. **Count separado** (sem limit).
6. **Tratar erros**: `42501` → BLOCKED (RLS). `5xx` → retry 1x → ESCALATE.
7. **Format table output**:
   ```
   | # | Domínio | Slug | Lang | Status | Active | v | HTML | Visite | Atualizado |
   |---|---------|------|------|--------|--------|---|------|--------|------------|
   | 1 | lp.archprime.io | offerta | it | published | ON | 3 | 12KB | 142 | 2026-05-04 12:15 |
   ```
8. **next_step_suggestion**:
   - Se 0 results: "Use create-cms-page para criar."
   - Se há drafts: "Há N drafts. Use publish-cms-page para publicar."
   - Se há páginas inativas sem redirect: warn "Páginas com active=false e sem redirect retornam 404."

### acceptance_criteria

- **[A1]** Filtros enum validados.
- **[A2]** Limit clamped (1..200).
- **[A3]** Read-only.
- **[A4]** RLS-aware: anonymous veem apenas `status='published' AND active=true`. Editores (qualquer role atribuída — owner/admin/marketing/comercial/cs/financeiro desde 2026-05-09) veem tudo.
- **[A5]** `html_content` NÃO retornado — apenas `html_size`.
- **[A6]** Sort by `updated_at DESC`.

---

## Exemplos

### Exemplo 1 — Listar publicadas em lp.archprime.io (DONE)

**Input:** `"listar páginas publicadas em lp.archprime.io"`

**Specialist:** filters = `{ target_domain: 'lp.archprime.io', status: 'published' }`. SELECT → 12 rows.

### Exemplo 2 — Páginas inativas (DONE)

**Input:** `"listar páginas desativadas"`

**Specialist:** filters = `{ active: false }`. SELECT → 3 rows. Warn quais não têm redirect.

### Exemplo 3 — Filtro inválido (BLOCKED)

**Input:** `"target_domain='loverch.com'"` (typo).

**Return:** BLOCKED com sugestão de typo.

---

## Notas

- **Read RLS:** anonymous reads veem `status='published' AND active=true`. Drafts/archived/inactive exigem role editora.
- **`html_size` em vez de `html_content`:** evita transferir MBs. Para ver conteúdo, abrir editor admin (preview iframe).
- **Performance:** índices `landing_pages_domain_status_idx` (partial WHERE published) e `(target_domain, slug, locale)` UNIQUE cobrem os filtros mais comuns.

---

**Mantido por:** content-builder.

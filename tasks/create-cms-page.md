# Task: create-cms-page

> Task atômica para criar uma nova linha em `landing_pages` (tabela única para todas as landing pages multi-domain — `lp.archprime.io`, `lovarch.com`, `archprime.io`). Pós-convergência 2026-05-04 (PrimeTeam PR #1226), `cms_pages` foi consolidada em `landing_pages`. Conteúdo é `html_content` (HTML raw self-contained com pixel + form embutidos), não mais `blocks`. **SEMPRE status='draft'** + **campaign_id obrigatório** (sem ele attribution quebra).

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy

### task_name
`Create Landing Page (CMS)`

### status
`pending`

### responsible_executor
`content-builder`

### execution_type
`Agent` — LLM + Supabase. Human confirma antes do INSERT.

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `slug` (string, kebab-case, único por `(target_domain, locale)`)
  - `target_domain` (`'lp.archprime.io'` | `'lovarch.com'` | `'archprime.io'`)
  - `locale` (`'it'` | `'en'` | `'pt'` | `'es'`, default `'it'`)
  - `title` (string, obrigatório)
  - `html_content` (string, HTML raw — pode ser fornecido na criação OU adicionado depois via update)
  - `css_content` (string opcional)
  - `campaign_id` **(uuid, obrigatório)** — campanha existente em `campaigns`. Sem ele, `lead.campaign_id` e `opportunity.campaign_id` ficam NULL para visitantes sem UTM
  - `meta_pixel_id`, `google_ads_id`, `tiktok_pixel_id`, `capi_enabled` (opcionais)
  - `seo` (jsonb opcional — `{ title?, description?, og_image?, canonical?, robots? }`)
  - `form_fields` (jsonb array opcional — definição dos campos do form embutido no HTML)

### output

- **`landing_page_id`** — uuid da row criada
- **`slug`** — slug final validado
- **`target_domain`**, **`locale`**, **`status`** (sempre `'draft'`), **`active`** (sempre `true` por default), **`version`** (`1`)
- **`public_url_when_published`** — `https://{target_domain}/{slug}`
- **`admin_edit_url`** — `https://primeteam.archprime.io/landing-pages?tab=cms-pages`
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`next_step_suggestion`**
- **`convention_check`**

### action_items

1. **Parse input** — extrair slug + target_domain + locale + title + html_content + campaign_id + opcionais.
2. **Validar slug regex** `^[a-z0-9]+(-[a-z0-9]+)*$`. Se inválido, conversion attempt + echo.
3. **Validar target_domain** ∈ `{'lp.archprime.io', 'lovarch.com', 'archprime.io'}`. Outros → BLOCKED.
4. **Validar locale** ∈ `{'it', 'en', 'pt', 'es'}`. Default `'it'`.
5. **Validar campaign_id obrigatório** — se ausente, ESCALATE com lista de campanhas ativas: `SELECT id, name FROM campaigns WHERE status='active' ORDER BY created_at DESC`. User escolhe uma OU cria nova via task `create-campaign`.
6. **Check uniqueness** — `SELECT id FROM landing_pages WHERE target_domain = ? AND slug = ? AND locale = ?`. Collision → ESCALATE com 3 options.
7. **Validar html_content** — se fornecido, deve ser string (max 2MB). Pode ser vazio (`''`) e adicionado depois.
8. **Validar campos opcionais** (pixel regex, seo objeto, form_fields array).
9. **Auto-set**:
   - `created_by = auth.uid()`
   - `status = 'draft'`
   - `active = true`
   - `version = 1`
   - `published_at = NULL`
10. **Confirmation message**:
    ```
    Vou criar landing page:
    slug: {slug}
    domínio: {target_domain}
    idioma: {locale}
    título: {title}
    campanha: {campaign_name} ({campaign_id})
    html_content: {len} chars (raw HTML)
    pixel Meta: {meta_pixel_id or "default Mariana"}
    status: DRAFT (use publish-cms-page para tornar pública)
    URL pública: https://{target_domain}/{slug}
    Confirma?
    ```
11. **Aguardar confirmação**.
12. **Executar INSERT** via Supabase (user JWT):
    ```sql
    INSERT INTO landing_pages
      (slug, target_domain, locale, title, html_content, css_content,
       campaign_id, meta_pixel_id, google_ads_id, tiktok_pixel_id,
       capi_enabled, seo, form_fields, status, active, version, created_by)
    VALUES
      ({slug}, {target_domain}, {locale}, {title}, {html_content},
       {css_content}, {campaign_id}, {meta_pixel_id}, {google_ads_id},
       {tiktok_pixel_id}, {capi_enabled or false}, {seo::jsonb},
       {form_fields::jsonb}, 'draft', true, 1, auth.uid())
    RETURNING id, slug, target_domain, locale, status, version;
    ```
13. **Tratar erros**:
    - `42501` (RLS) → BLOCKED. RLS de `landing_pages` exige owner/admin/marketing via `user_roles`. Sua role: `{role}`.
    - `23505` (unique violation `(target_domain, slug, locale)`) → ESCALATE.
    - `23503` (FK violation em `campaign_id`) → BLOCKED — campanha não existe.
    - `23514` (CHECK) → BLOCKED indicando constraint violada.
    - `5xx` → retry 1x → ESCALATE.
14. **Activity log** — INSERT em `activity_logs` com `action='content-builder.create_landing_page'`, `details={slug, target_domain, campaign_id, cycle_id, before:null, after:{id, status:'draft', active:true}}`.
15. **next_step_suggestion**:
    - Se html_content vazio: "Use update-cms-page para adicionar html_content. Depois publish-cms-page."
    - Se html_content fornecido: "Use publish-cms-page para tornar a página acessível em https://{target_domain}/{slug}."
16. **Retornar ao chief** com `landing_page_id` + URLs.

### acceptance_criteria

- **[A1]** slug + target_domain + title + campaign_id obrigatórios. Falta = ESCALATE.
- **[A2]** Slug regex kebab-case enforced.
- **[A3]** Slug uniqueness por `(target_domain, slug, locale)`.
- **[A4]** status='draft' + active=true forçados na criação.
- **[A5]** target_domain restrito aos 3 valores.
- **[A6]** locale restrito aos 4 valores.
- **[A7]** campaign_id deve referenciar campanha existente (FK validada).
- **[A8]** html_content validado (string, max 2MB) — pode ser vazio.
- **[A9]** Activity log fail-tolerant.

---

## Exemplos

### Exemplo 1 — Happy path com html_content (DONE)

**Input:** `"criar landing 'promo-italia-jun26' em archprime.io, italiano, campanha PROMO_ITALIA_2026, com este HTML: <html>...</html>"`

**Specialist:**
1. slug ✓, domain ✓, locale ✓, title ✓
2. Resolve campaign: `SELECT id FROM campaigns WHERE name='PROMO_ITALIA_2026'` → uuid
3. SELECT uniqueness → 0 matches ✓
4. Confirmation (user confirma)
5. INSERT → landing_page_id=lp-a1b2... status=draft active=true

**Return:** `landing_page_id: lp-a1b2... | URL: https://archprime.io/promo-italia-jun26`

### Exemplo 2 — Sem campaign_id (ESCALATE)

**Input:** `"criar página 'evento-milano' em archprime.io"`

**Specialist:** ESCALATE com lista das 5 campanhas ativas mais recentes.

### Exemplo 3 — RLS denial (BLOCKED)

**Input:** user role=cs.

**Specialist:** INSERT → 42501. BLOCKED — peça a Sandra (marketing) ou Pablo (owner).

---

## Notas

- **Conteúdo é raw HTML self-contained.** Pixel scripts, form handlers, estilos inline ou em `<style>` — tudo dentro de `html_content`. UI admin não edita HTML — apenas meta-config (slug, domínio, campanha, pixel/CAPI, redirect, SEO, toggle Attiva).
- **Renderer público:** `/page/:slug` carrega via cms-pages-api EF e renderiza em iframe srcDoc sandbox.
- **Form handlers no HTML:** o HTML deve fazer `fetch('https://xmqmuxwlecjbpubjdkoj.supabase.co/functions/v1/cms-form-submit', { method:'POST', body: JSON.stringify({ page_id, slug, target_domain, locale, form_data, tracking }) })`.
- **Active toggle:** `active=false` faz o renderer redirecionar para `redirect_to` ou `/<redirect_to_slug>`. Admin precisa configurar destino antes de desativar.
- **Optimistic locking:** `version` incrementa a cada update. Tasks de edit passam `version` esperada.

---

**Mantido por:** content-builder.

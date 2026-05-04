# Task: publish-cms-page

> Task atômica para publicar/despublicar uma `landing_pages`. Toggle `status` entre `'draft'`/`'archived'` e `'published'`. Pós-convergência 2026-05-04 (PrimeTeam PR #1226), `cms_pages` foi consolidada em `landing_pages`. Conteúdo é `html_content` raw — valida que não está vazio antes de publicar. Webhook automático (`cms-revalidate` EF) bypass cache em `lovarch.com` / `archprime.io` (lp.archprime.io é SPA, sem ISR).

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy

### task_name
`Publish Landing Page`

### status
`pending`

### responsible_executor
`content-builder`

### execution_type
`Agent` — LLM + Supabase + EF webhook side-effect. Confirmation step obrigatório (publica conteúdo PÚBLICO).

### input

- **Cycle ID**, **User JWT**
- **Request payload**:
  - `landing_page_id` (uuid) OR `slug` + `target_domain` (resolver via list-cms-pages)
  - `action` (`'publish'` | `'unpublish'`, default `'publish'`)
  - `version` (int, optional — optimistic lock)

### output

- **`landing_page_id`**, **`slug`**, **`target_domain`**
- **`status_before`**, **`status_after`**, **`version`** (incrementada), **`published_at`**
- **`public_url`** — `https://{target_domain}/{slug}`
- **`webhook_status`** — `'sent'` | `'failed'` | `'skipped'`
- **`verdict`**, **`next_step_suggestion`**, **`convention_check`**

### action_items

1. **Resolver target page**: SELECT por `landing_page_id` ou `(slug, target_domain, locale)`. 0 = ESCALATE com create-cms-page.
2. **Validar action** ∈ `{'publish', 'unpublish'}`.
3. **Validar status atual vs action**:
   - `publish` + status `'published'` → ESCALATE (force republish?)
   - `publish` + `'draft'`/`'archived'` → OK
   - `unpublish` + `'published'` → OK
   - `unpublish` + `'draft'` → ESCALATE
4. **Para `publish`: validar conteúdo**:
   - `length(html_content) > 0` — se vazio, ESCALATE: "Página sem conteúdo. Use create-cms-page com html_content ou update-cms-page para adicionar."
5. **Validar `active`** — se `active=false`, warn que após publish o renderer ainda redirecionará via `redirect_to`/`redirect_to_slug`. Sugerir habilitar `active=true` antes ou em conjunto.
6. **Resolver version** — input ou current.
7. **Confirmation message**:
   ```
   ATENÇÃO: vou publicar https://{target_domain}/{slug}
   Conteúdo público (qualquer pessoa na internet pode acessar):
     - HTML: {html_size} bytes
     - SEO title: «{seo.title or "—"}»
     - Pixel Meta: {meta_pixel_id or "default Mariana"}
     - CAPI: {capi_enabled ? "ON" : "OFF"}
     - Campanha: {campaign_name}
     - Active: {active ? "ON (renderiza)" : "OFF (redirect)"}
   Status: {current_status} → published
   Version: v{N} → v{N+1}
   Cache: até 60s para cache antigo expirar (Supabase EF s-maxage=60)
   Confirma publicação?
   ```
8. **Aguardar confirmação**.
9. **UPDATE atomic** com optimistic lock:
   ```sql
   UPDATE landing_pages
   SET
     status = CASE WHEN {action} = 'publish' THEN 'published' ELSE 'draft' END,
     published_at = CASE WHEN {action} = 'publish' THEN now() ELSE NULL END,
     updated_by = auth.uid(),
     updated_at = now()
     -- version bump e auto-stamp published_at sao feitos por trigger
   WHERE id = {landing_page_id}
     AND version = {expected_version}
   RETURNING id, slug, target_domain, status, version, published_at;
   ```
10. **Tratar erros**:
    - `0 rows` → CONFLICT (version mismatch). ESCALATE: re-listar.
    - `42501` (RLS) → BLOCKED: role exige owner/admin/marketing.
    - `5xx` → retry 1x → ESCALATE.
11. **Webhook side-effect** (não-blocking):
    - Para `lovarch.com` / `archprime.io`: chama EF `cms-revalidate` para invalidar Vercel ISR.
    - Para `lp.archprime.io`: webhook retorna `null` na resolução do domain — webhook_status='skipped' (SPA, sem ISR).
    - Falha não bloqueia a task — UPDATE foi aceito, cache expira em 60s natural.
12. **Activity log** — INSERT em `activity_logs` com `action='content-builder.publish_landing_page'` ou `unpublish_landing_page`. `details={landing_page_id, slug, target_domain, before:{status,version}, after:{status,version,published_at}, side_effect:'public_url_changes'}`.
13. **next_step_suggestion**:
    - Publish OK + active=true: "Página publicada. Abra https://{target_domain}/{slug} para validar."
    - Publish OK + active=false: "Publicada mas inativa — redirect para {redirect_target} ativo. Toggle Attiva no admin para renderizar."
    - Unpublish: "URL volta a 404 imediatamente após cache TTL."
14. **Retornar ao chief**.

### acceptance_criteria

- **[A1]** Action restrito a `'publish'`/`'unpublish'`.
- **[A2]** Status transitions enforced.
- **[A3]** Empty html_content bloqueia publish.
- **[A4]** Confirmação obrigatória (publish é high-impact).
- **[A5]** Optimistic lock via `WHERE version = {expected}`.
- **[A6]** CHECK constraint `(status='published' AND published_at IS NOT NULL)` respeitado pelo trigger.
- **[A7]** Webhook non-blocking — falha não falha a task.
- **[A8]** RLS via user_roles (owner/admin/marketing).
- **[A9]** Activity log fail-tolerant.

---

## Exemplos

### Exemplo 1 — Publish happy path (DONE)

**Input:** `"publica 'promo-italia-jun26' em archprime.io"`

**Specialist:**
1. SELECT → lp-a1b2... status=draft v=2 html_size=18KB
2. Confirmation (user confirma)
3. UPDATE → status=published v=3 published_at=now()
4. Webhook archprime.io → 202 sent

**Return:** DONE com URL pública.

### Exemplo 2 — html_content vazio (ESCALATE)

**Specialist:** SELECT → html_content='' → ESCALATE: "Adicione html_content via update-cms-page antes de publicar."

### Exemplo 3 — Version conflict (ESCALATE)

**Specialist:** UPDATE WHERE version=5 → 0 rows. ESCALATE: re-list para ver versão atual.

---

## Notas

- **Trigger faz bump version + stamp published_at:** `trg_landing_pages_set_updated_at` (BEFORE UPDATE) auto-incrementa version + auto-stampa published_at na transição para `'published'`. CLI não precisa setar manualmente — apenas WHERE version = expected.
- **Snapshot automático:** `trg_landing_pages_snapshot_on_publish` (AFTER INSERT/UPDATE) grava em `landing_page_versions` quando status muda para `'published'`. Audit trail automático.
- **Cache TTL 60s:** EF GET retorna `Cache-Control: public, s-maxage=60`. Webhook é optimization, não correctness.
- **lp.archprime.io = SPA:** webhook retorna null. Cache é client-side via TanStack Query (1min staleTime) — flush via reload.
- **Active vs status:** ortogonais. `status='published'` (publicada editorialmente) + `active=true` (acessível runtime) → renderiza. `published` + `active=false` → redireciona via redirect_to. `draft`/`archived` → 404 (não acessível para anonymous).

---

**Mantido por:** content-builder.

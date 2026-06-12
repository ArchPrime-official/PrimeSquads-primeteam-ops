# Task: update-landing-page

> Atualizar campos de `landing_pages` (blocks, html_content, title, target_domain, redirect, etc.). NÃO publica — apenas edita. Implementa F-09.1.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Update Landing Page`

### responsible_executor
`content-builder`

### execution_type
`Agent` — confirmation OBRIGATÓRIO se LP está published (mudança visível ao público).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `landing_page_id` (uuid OR `slug + target_domain + locale`)
  - `updates` (object — qualquer subset):
    - `title`, `seo` (object), `html_content` (string), `blocks` (jsonb)
    - `target_domain`, `locale`, `campaign_id`, `redirect_to`, `redirect_to_slug`
    - `meta_pixel_id`, `capi_enabled`, `active`
  - `version` (int — optimistic lock)
  - `reason` (string opcional, recomendado se LP published)

### output

- **`landing_page_id`**, **`updated_fields`**, **`new_version`**
- **`row_snapshot_before`** + **`row_snapshot_after`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** marketing/admin/owner. cs/comercial/financeiro → BLOCKED.
2. **Resolver LP** + atual status/version.
3. **Validar updates:**
   - target_domain ∈ enum válido
   - locale ∈ ISO 639-1 + região
   - html_content NÃO vazio se passado
   - blocks JSONB válido
4. **Lovarch obligation check (se html_content mudou):**
   - Surface warning se LP é em `lovarch.com` ou `archprime.io`:
     ```
     ⚠️ LOVARCH DUAL-RENDERER: esta LP renderiza em frontend separado
     (ByPabloRuanL/lovarch). Mudanças em html_content/schema PODEM
     exigir PR companion no repo Lovarch. Ver docs/tech-debt/cms-dual-renderer.md
     ```
5. **Conditional confirmation:**
   - Se status=`published`: dupla confirmation obrigatória ("CONFIRMO UPDATE LIVE" uppercase)
   - Se status=`draft`: confirmation simples
   ```
   {published ? 'ATENÇÃO: LP está PUBLICADA — mudança visível em ~60s' : 'LP em draft, edição segura'}
   Updates:
     {field}: {old} → {new}
     ...
   Version: v{N} → v{N+1}
   {published ? 'Digite "CONFIRMO UPDATE LIVE" uppercase' : 'Confirma?'}
   ```
6. **UPDATE atomic com optimistic lock:**
   ```sql
   UPDATE landing_pages
   SET {fields}, updated_by=auth.uid(), updated_at=NOW()
   WHERE id={lp_id} AND version={expected_version}
   RETURNING id, version, updated_at;
   ```
   0 rows = CONFLICT.
7. **Webhook revalidate (se published + html_content/blocks mudaram):**
   - Invoke edge `cms-revalidate` para invalidar Vercel ISR
   - Não-blocking
8. **Activity log:** action='content-builder.update_landing_page', details com diff.
9. **Echo:**
   ```
   ✓ LP atualizada
   Version: v{old} → v{new}
   {published ? 'Cache expira em ~60s. Valide em ' + url : 'Edição em draft segura.'}
   {lovarch_warning ? '⚠️ Considere PR companion em Lovarch repo' : ''}
   ```

### acceptance_criteria

- **[A1] Role gating:** marketing/admin/owner.
- **[A2] Optimistic lock via version.**
- **[A3] Conditional confirmation:** published = "CONFIRMO UPDATE LIVE" uppercase; draft = "sim".
- **[A4] Lovarch warning:** surface se html_content mudou em domains lovarch/archprime.
- **[A5] Revalidate webhook:** automático em published + content change.
- **[A6] Audit diff:** activity_log com before/after diff.
- **[A7] No publish:** task NUNCA muda status.

---

## Exemplos

### Exemplo 1 — Sandra atualiza headline de LP draft

**Input:** `lp_id`, `updates={blocks: [...new...]}`, version=3

**Specialist:** draft → simple confirm → UPDATE v4 → DONE.

### Exemplo 2 — Atualizar LP published (CONFIRMO UPDATE LIVE)

**Input:** mesma LP em status=published

**Specialist:** "CONFIRMO UPDATE LIVE" uppercase obrigatório → UPDATE + cms-revalidate trigger → DONE com warning de cache.

### Exemplo 3 — Mudança em LP lovarch.com

**Input:** html_content mudou, target_domain=lovarch.com

**Specialist:** echo inclui warning sobre PR companion no Lovarch repo.

---

## Notas

- **Lovarch dual-renderer:** memory:CLAUDE.md + tech-debt note ainda ativos até migração `app.lovarch.com`.
- **`cms-revalidate` edge:** invalida ISR Vercel; LP `lp.archprime.io` é SPA, sem cache (skip).
- **Versioning:** trigger BEFORE UPDATE incrementa version + auto-snapshot em `landing_page_versions`.

---

**Mantido por:** content-builder

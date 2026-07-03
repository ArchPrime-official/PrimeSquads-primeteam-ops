# Task: update-landing-page

> Atualizar campos de `landing_pages` (blocks, html_content, title, target_domain, redirect, etc.). NÃO publica — apenas edita. Implementa F-09.1.

**Cumpre:** HO-TP-001 · HO-TP-003 (DS por marca ao editar/mover)

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
   - html_content novo NUNCA usa `document.write()` (quebra pós-hydration); pixel/form handlers via `addEventListener`/`fetch`; `fbq('Lead'/'Purchase', ...)` sempre com `eventID` determinístico (derivado de `lead_id`/`opportunity_id`/`session_id`, nunca `uuid()`/`Date.now()`/`Math.random()`)
   - **DS por marca (HO-TP-003):** `html_content` novo deve usar o Design System da marca do `target_domain` (ArchPrime vs Lovarch DS — [`data/domain-brand-ds-registry.yaml`](../data/domain-brand-ds-registry.yaml)); `meta_pixel_id` deve bater com o pixel da marca. Se o update **MUDA `target_domain` para outra marca**, avisar que o DS/pixel do `html_content` existente precisam ser re-tematizados (não herdar a marca antiga)
   - **`active=false` BLOQUEADO sem `redirect_to` OU `redirect_to_slug` configurado** (regra Attiva — LP desativada precisa de destino de redirect definido; sem isso, BLOCKED pedindo para configurar o redirect antes)
   - **Se `target_domain`, `slug` OU `locale` mudarem:** re-checar uniqueness (`target_domain`+`slug`+`locale`) ANTES do UPDATE — a constraint pode disparar `23505` (unique_violation); tratar e reportar de forma clara (não deixar o erro Postgres cru vazar pro usuário)
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
- **[A8] Attiva guard:** `active=false` sem `redirect_to`/`redirect_to_slug` = BLOCKED.
- **[A9] Uniqueness recheck:** mudança de `target_domain`/`slug`/`locale` trata `23505` explicitamente, não deixa erro cru.
- **[A10] DS por marca (HO-TP-003):** `html_content`/`meta_pixel_id` coerentes com a marca do `target_domain`; mudança de domínio entre marcas avisa re-tematização.

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
- **Toggle Attiva:** quando `active=false`, o renderer redireciona para `redirect_to` ou `/<redirect_to_slug>` — por isso a task bloqueia a desativação sem esse destino configurado (mesma regra da UI admin).
- **HTML novo:** sempre revisar contra as regras de `document.write()` proibido e `eventID` de Pixel determinístico (ver CLAUDE.md seção "Pixel Lead event") antes de persistir `html_content`.
- **DS por marca (HO-TP-003):** ao editar `html_content` ou trocar `target_domain`, o DS e o pixel têm de bater com a marca do domínio (`domain-brand-ds-registry.yaml`) — nunca deixar tokens ArchPrime numa página lovarch.com nem vice-versa.

---

**Mantido por:** content-builder

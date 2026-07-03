# Task: clone-landing-page

> Clonar LP (deep copy blocks/html_content/seo) com novo slug. A/B testing ou variações. Status reset para draft.
>
> 🎨 **Cruzar domínio muda marca/DS/pixel (HO-TP-003):** se `new_target_domain` ≠ `source.target_domain` e as marcas diferem (ex.: `archprime.io`→`lovarch.com`), o `html_content` clonado carrega o DS/pixel da marca ERRADA. Avise e oriente re-tematizar via `update-landing-page`/`generate-landing-page-ai` para o DS da marca de destino — ver [`data/domain-brand-ds-registry.yaml`](../data/domain-brand-ds-registry.yaml). Destino = `lovarch.com` → vale o débito dual-renderer (PR companion `ByPabloRuanL/lovarch`).
>
> ⚠️ **campaign_id nunca NULL:** se a source não tem campanha e `new_campaign_id` não veio, **ESCALATE** — nunca clonar LP sem campanha (attribution quebra).

**Cumpre:** HO-TP-001 · HO-TP-003

---

## Task anatomy

### task_name `Clone Landing Page`

### responsible_executor `content-builder`

### execution_type `Agent` — confirmation simples.

### input
- `source_lp_id` (uuid OR slug+domain)
- `new_slug` (string, kebab-case)
- `new_target_domain` (default = source.target_domain)
- `new_locale` (default = source.locale)
- `new_campaign_id` (uuid opcional — mas se `source.campaign_id` for NULL, torna-se **obrigatório**; sem nenhum dos dois → ESCALATE)
- `clone_blocks` (bool default true)
- `clone_html_content` (bool default true)
- `clone_seo` (bool default true)

### output
- `cloned_lp_id` (uuid)
- `source_lp_id` (echo)
- `new_url_preview` (após publish)
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role:** marketing/admin/owner.
2. Resolver source LP.
3. Validar new_slug uniqueness em (target_domain, locale).
4. Validar enums target_domain + locale.
4b. **Resolver campanha (HO-TP-003) — nunca NULL:** `effective_campaign = new_campaign_id ?? source.campaign_id`. Se ambos forem NULL → **ESCALATE** listando campanhas ativas (`SELECT id, name FROM campaigns WHERE status='active' ORDER BY created_at DESC`). NÃO fazer o INSERT com `campaign_id` NULL (era o bug: o `COALESCE` propagava NULL silenciosamente).
4c. **Cruzou de marca?** Se `domains[new_target_domain].brand` ≠ `domains[source.target_domain].brand` (via `domain-brand-ds-registry.yaml`), avisar no confirm que o DS/pixel clonados são da marca de ORIGEM e precisam ser re-tematizados para a marca de destino.
5. Confirmation: source slug → new slug + clone flags.
6. INSERT atomic com colunas reais de `landing_pages`:
   ```sql
   INSERT INTO landing_pages (slug, target_domain, locale, blocks, html_content,
                              seo, campaign_id, status, active, created_by,
                              title, visibility)
   SELECT {new_slug}, {new_domain}, {new_locale},
          CASE WHEN {clone_blocks} THEN blocks ELSE NULL END,
          CASE WHEN {clone_html_content} THEN html_content ELSE NULL END,
          CASE WHEN {clone_seo} THEN seo ELSE NULL END,
          COALESCE({new_campaign_id}, campaign_id),  -- garantido NÃO-NULL pelo passo 4b (senão ESCALATE)
          'draft', false, auth.uid(),
          {new_title or title || ' (copy)'},
          'private'
   FROM landing_pages WHERE id={source_lp_id}
   RETURNING id;
   -- TODO: coluna cloned_from_id NÃO existe em landing_pages (schema 2026-06-12).
   -- Lineage registrada em activity_logs (details.source_lp_id).
   ```
7. Activity log: action='content-builder.clone_landing_page', details com `{source_lp_id, new_lp_id, source_slug, new_slug}` (lineage aqui já que cloned_from_id não existe).
8. Echo:
   ```
   ✓ LP clonada
   Source: {source_slug}
   New: {new_slug} (status=draft)
   URL preview (após publish): https://{domain}/{new_slug}
   Próximos passos: edit via update-landing-page + publish
   ```

### acceptance_criteria
- A1 marketing/admin/owner
- A2 Slug uniqueness em (target_domain, slug, locale) — constraint real do schema
- A3 Status starts draft + active=false
- A4 Lineage via activity_logs (cloned_from_id NÃO existe — TODO migration)
- A5 Granular clone flags
- A6 Audit
- A7 **campaign_id nunca NULL (HO-TP-003):** source e new ambos NULL → ESCALATE, nunca INSERT com attribution quebrada
- A8 **Cruzar marca avisado:** clonar entre domínios de marcas diferentes ECHOA que DS/pixel precisam re-tematização

---

**Mantido por:** content-builder

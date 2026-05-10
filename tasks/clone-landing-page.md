# Task: clone-landing-page

> Clonar LP (deep copy blocks/html_content/seo) com novo slug. A/B testing ou variações. Status reset para draft.

**Cumpre:** HO-TP-001

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
- `new_campaign_id` (uuid opcional)
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
5. Confirmation: source slug → new slug + clone flags.
6. INSERT atomic com:
   ```sql
   INSERT INTO landing_pages (slug, target_domain, locale, blocks, html_content,
                              seo, campaign_id, status, active, created_by, ai_generated,
                              cloned_from_id)
   SELECT {new_slug}, {new_domain}, {new_locale},
          CASE WHEN {clone_blocks} THEN blocks ELSE '[]'::jsonb END,
          CASE WHEN {clone_html_content} THEN html_content ELSE '' END,
          CASE WHEN {clone_seo} THEN seo ELSE NULL END,
          {new_campaign_id}, 'draft', false, auth.uid(), false, id
   FROM landing_pages WHERE id={source_lp_id}
   RETURNING id;
   ```
7. Activity log: action='content-builder.clone_landing_page', details com source+new IDs.
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
- A2 Slug uniqueness em (target_domain, locale)
- A3 Status starts draft + active=false
- A4 cloned_from_id linkagem (audit/lineage)
- A5 Granular clone flags
- A6 Audit

---

**Mantido por:** content-builder

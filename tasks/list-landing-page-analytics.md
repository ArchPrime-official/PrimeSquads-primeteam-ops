# Task: list-landing-page-analytics

> Read-only: visitors + engagement events + funnel para LP. Sandra valida pré/pós publish. F-09.6.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `List Landing Page Analytics`

### responsible_executor `content-builder`

### execution_type `Agent` — read-only.

### input
- `landing_page_id` (uuid OR slug+domain)
- `date_range` (`'7d' | '30d' | '90d' | 'custom'`, default 30d)
- `date_from`, `date_to` (custom)
- `breakdown` (`'daily' | 'hourly' | 'utm_source' | 'device'`, default daily)
- `include_events` (bool default true)

### output
- `lp_meta`: `{slug, domain, status, published_at}`
- `funnel`: `{visitors, scroll_50, cta_view, cta_click, form_start, form_submit, conversion_rate}`
- `breakdown_data` (array per group)
- `top_events` (array — engagement signals)
- `verdict`: `DONE`

### action_items

1. **Role:** marketing/admin/owner.
2. Resolver LP.
3. Query agregado em:
   - `landing_page_visitors` (sessions)
   - `landing_page_engagement_events` (scrolls, clicks, form events)
   - `form_submissions` (conversões)
4. Calcular funnel rates.
5. Identificar top events (peak hours, top utm_source, drop-off points).
6. Activity log: action='content-builder.list_landing_page_analytics' (filter only).
7. Echo tabular condensado:
   ```
   📊 LP «{slug}» — últimos {range}
   Visitors: {N} | Engagement: {scroll_50}% | CTR: {ctr}%
   Form starts: {X} | Submits: {Y} | Conversion: {Z}%
   Top sources: {utm_source list}
   Drop-off: {primary block}
   ```

### acceptance_criteria
- A1 marketing/admin/owner
- A2 Custom date range max 1 ano
- A3 Funnel rates calculados (NaN-safe)
- A4 Top 5 utm_source/event highlights
- A5 Read-only

---

**Mantido por:** content-builder

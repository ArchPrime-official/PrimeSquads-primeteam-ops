# Task: list-meta-campaigns

> Task read-only para listar campanhas Meta Ads do cache (`meta_ads_campaigns_cache`) com insights principais (spend, CTR, CPC, CPM, leads, ROI, ranking quality). Staleness check + filter por status/account/date. Zero external API calls.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`List Meta Ads Campaigns`

### status
`pending`

### responsible_executor
`integration-specialist` (Sprint 10, Meta Ads module)

### execution_type
`Agent` — LLM + Supabase. Read-only no cache. Zero chamadas à Meta Graph API.

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `effective_status` (opcional — default "ACTIVE"; aceitos: "ACTIVE" | "PAUSED" | "ARCHIVED" | "all")
  - `account_id` (opcional — se user tem múltiplas contas Meta)
  - `account_name` (opcional — ILIKE em meta_ad_accounts.account_name se account_id não dado)
  - `objective` (opcional — "OUTCOME_LEADS" | "OUTCOME_TRAFFIC" | "OUTCOME_SALES" | etc.)
  - `min_spend` / `max_spend` (numeric, opcional)
  - `search_term` (opcional — ILIKE em campaign_name)
  - `sort_by` (opcional — default "spend DESC"; aceitos: spend | ctr | roi | leads | conversions | synced_at | recency)
  - `limit` (opcional int, default 50, max 200)
  - `date_range` (opcional — filter synced_at; keyword "today"/"this_week" ou custom)

### output

- **`total_rows`** — número de campanhas retornadas
- **`rows`** — array com campos: campaign_id, campaign_name, account_id, account_name, currency, effective_status, objective, daily_budget, lifetime_budget, spend, impressions, clicks, ctr, cpc, cpm, cpl, leads, conversions, purchases, revenue, roi, frequency, reach, quality_ranking, engagement_rating, conversion_rate_ranking, synced_at
- **`table_compact`** — markdown com colunas principais
- **`sync_status`** — { last_fast_sync_at, last_incremental_sync_at, last_full_sync_at, staleness_minutes_fast, status: FRESH | STALE | VERY_STALE | DISCONNECTED, last_error }
- **`aggregates`** — { total_spend, total_leads, total_conversions, avg_ctr, avg_roi, avg_cpl }
- **`flags`** — array de underperformer warnings (CTR < 1%, CPL > threshold, ROI < 1.0, frequency > 3)
- **`filters_applied`** — echo
- **`truncated`** — bool (true se total == limit)
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`next_step_suggestion`** — se STALE OU flags presentes: sugerir trigger_meta_sync OU route to /metaAds expertise
- **`convention_check`**:
  - Read-only: ✓
  - Account scoped: ✓ (RLS filter by active accounts)
  - No external API call: ✓
  - Staleness reported: ✓
  - Currency preserved (no conversion): ✓
  - Underperformer flags surfaced: ✓

### action_items

1. **Check connection** — `SELECT * FROM meta_ad_accounts WHERE is_active = true`:
   - 0 rows → BLOCKED "nenhuma conta Meta Ads conectada. Conectar em /marketing/settings"
   - 1+ rows → prosseguir. Se múltiplas + user não especificou account_id/name → default todas OR ask explicitly.

2. **Check sync status** — `SELECT * FROM meta_ads_sync_status ORDER BY updated_at DESC LIMIT 1`:
   - Status `running` → WARN "sync em progresso, dados podem ser parciais"
   - Status `failed` → WARN com last_error
   - Status `completed`:
     - Calcular staleness de `last_fast_sync_at`:
       - <30 min → FRESH
       - 30 min-2h → STALE
       - >2h → VERY_STALE
     - Incremental sync threshold: 2h (mais relaxado — insights refreshed less frequently)
     - Full sync threshold: 24h (archival data; tolerante)

3. **Resolve account_id se necessário** — se veio `account_name`, ILIKE em meta_ad_accounts:
   - 0 matches → warning + fallback para todas as contas
   - 1 match → usar
   - >1 → ESCALATE com candidates list

4. **Build query**:
   ```sql
   SELECT campaign_id, campaign_name, account_id, currency,
          effective_status, objective, daily_budget, lifetime_budget,
          spend, impressions, clicks, ctr, cpc, cpm, cpl,
          leads, conversions, purchases, revenue, roi,
          frequency, reach,
          quality_ranking, engagement_rating, conversion_rate_ranking,
          synced_at
   FROM meta_ads_campaigns_cache
   WHERE
     {effective_status filter OR (!= 'ARCHIVED' if 'all')}
     {AND account_id = X if specified}
     {AND objective = X if specified}
     {AND spend BETWEEN min AND max if bounds}
     {AND campaign_name ILIKE if search_term}
     {AND synced_at >= X if date_range}
   ORDER BY {sort_by: spend DESC NULLS LAST default}
   LIMIT {limit: 50};
   ```

5. **Join account_name** — enriquecer rows com account_name de meta_ad_accounts (via separate query ou sub-SELECT).

6. **Compute aggregates** sobre os rows retornados:
   - `total_spend = SUM(spend)` (respeitando currencies diferentes — se mixed, mostrar per currency)
   - `avg_ctr = AVG(ctr)` (excluir NULLs)
   - `avg_roi = AVG(roi)`
   - etc.

7. **Detect underperformer flags** em cada row:
   - `ctr < 0.01` → flag "CTR baixo (<1%)"
   - `cpl > 100` (or configurable threshold per business) → flag "CPL acima do benchmark"
   - `roi < 1.0` (campaign ativa com spend significativo) → flag "ROI negativo"
   - `frequency > 3` → flag "audience fatigue"
   - Append flags ao row + output aggregated flags list.

8. **Format output**:
   - `table_compact`: colunas principais, timestamps synced_at em Europe/Rome
   - `aggregates` visível
   - `flags` listadas se existentes (WARNING tom, não blocking)

9. **Populate next_step_suggestion**:
   - Se DISCONNECTED → conectar
   - Se VERY_STALE → trigger_meta_sync
   - Se flags presentes → route_to /metaAds expertise (para estratégia)
   - Se FRESH + sem flags → close

10. **Tratar erros**:
    - 42501 (RLS denial — role inadequada) → BLOCKED
    - 5xx → retry 1x → ESCALATE

11. **Return** — V10 + V11 + V18.

### acceptance_criteria

- **[A1] Account-scoped:** query respeita meta_ad_accounts.is_active; não expõe contas desativadas.
- **[A2] No external API:** task lê apenas `meta_ads_campaigns_cache` + `meta_ad_accounts` + `meta_ads_sync_status`. Nunca invoca Meta Graph API.
- **[A3] Staleness reported:** sync_status inclui staleness_minutes_fast + status classification.
- **[A4] No SELECT *:** query enumera ~28 colunas explicitamente. Sensitive campos (se houver) excluídos.
- **[A5] Currency preserved:** spend/revenue mantêm currency original. Se rows com currencies diferentes, aggregates separam per currency.
- **[A6] Underperformer flags:** task detecta CTR<1%, ROI<1, frequency>3 etc. e surface como warnings. Não bloqueante.
- **[A7] Limit capped:** max 200. Default 50.
- **[A8] Strategic recommendations not given:** task NUNCA sugere "pausar essa campanha" ou "aumentar budget". Só surface data + route_to /metaAds expertise.

---

## Exemplos de execução

### Exemplo 1 — Happy path FRESH (DONE)

**Input:** `"campanhas Meta ativas"`, user=marketing, sync fast 20min atrás, 3 campanhas ativas.

**Specialist:**
1. 1 conta Meta ativa (Sandra's account)
2. sync_status: fast 20min atrás → FRESH
3. Query com effective_status='ACTIVE' → 3 rows
4. Aggregates: total_spend €2.450, avg_ctr 2.3%, avg_roi 1.8
5. Flags: 0

**Return:**
```
[integration-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 3
table_compact: |
  | # | Campanha | Status | Spend | CTR | CPC | Leads | ROI | Synced |
  |---|----------|--------|-------|-----|-----|-------|-----|--------|
  | 1 | Immersione Roma Abr 2026 | ACTIVE | €1,450 | 2.8% | €0.85 | 47 | 2.2 | 2026-04-24 09:40 |
  | 2 | Evento Milano Mag 2026 | ACTIVE | €720 | 1.9% | €1.12 | 18 | 1.6 | 2026-04-24 09:40 |
  | 3 | Prime Studio Anuale | ACTIVE | €280 | 2.1% | €0.95 | 8 | 1.4 | 2026-04-24 09:40 |
aggregates: { total_spend_EUR: 2450, total_leads: 73, avg_ctr: 0.023, avg_roi: 1.73 }
flags: []
sync_status: { last_fast_sync_at: 2026-04-24T07:40Z, status: FRESH, staleness_minutes_fast: 20 }
filters_applied: { effective_status: "ACTIVE" }
next_step_suggestion: close
convention_check: read-only ✓ | account scoped ✓ | no API ✓ | staleness ✓ | currency EUR preserved ✓
```

### Exemplo 2 — Campanha underperformer (DONE com flags)

**Input:** `"todas as campanhas"`, 5 campanhas, 2 com ROI < 1.0.

**Specialist detecta flags e surface:**
```
[integration-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 5
table_compact: (5 rows com flags inline)
aggregates: { total_spend_EUR: 3,200, avg_roi: 1.1 }
flags: [
  { campaign: "Test Audience X", flag: "ROI negativo (0.6)", severity: HIGH },
  { campaign: "Retargeting Antiga", flag: "frequency 4.2 (audience fatigue)", severity: MEDIUM }
]
warnings: |
  2 campanhas com sinais de underperformance. Recomendações estratégicas
  (pausar / rebudget / nova audience) estão fora do meu scope — sou
  read-and-sync boundary.
next_step_suggestion: escalate_to_user
suggested_user_message: |
  "Detectei 2 flags em campanhas. Para recomendações estratégicas
   (pausar, rebudget, audience reset), consulte squad expertise:
   1. /metaAds:depesh-mandalia — diagnóstico campaign performance
   2. /metaAds:ralph-burns — scaling strategy
   3. /metaAds:jon-loomer — audience reset
   Eu posso FORNECER MAIS DADOS (breakdown por age/device, insights
   daily time-series) se o squad expertise precisar. Deseja?"
```

### Exemplo 3 — VERY_STALE + sync em progresso

**Input:** `"campanhas Meta"`, sync 3h atrás, último status='failed' com error_message.

**Return:** DONE com rows do cache (que podem estar desatualizados) + warning forte + sugestão explícita de investigar edge function logs + trigger_meta_sync manual.

### Exemplo 4 — Nenhuma conta Meta conectada (BLOCKED)

**Input:** `"campanhas Meta"`, user novo sem conta conectada.

**Return:** BLOCKED com instructions para conectar via /marketing/settings.

### Exemplo 5 — Recomendação estratégica solicitada (ESCALATE)

**Input:** `"qual campanha devo pausar?"`

**Specialist:** match "devo pausar" → strategic question → ESCALATE para expertise squad.

**Return:**
```
[integration-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  "Decisão de pausar campaign é estratégica, não operacional — fora do
   meu scope (eu só leio/sync data).
   Squads de expertise relevantes:
   1. /metaAds:depesh-mandalia — sabe ler performance e decidir pausar
   2. /metaAds:ralph-burns — scaling/unscaling strategy
   3. /metaAds:jon-loomer — audience troubleshooting
   Eu posso FORNECER o data (performance_summary, breakdowns) para o
   expertise squad analisar. Deseja que eu colete os dados primeiro?"
```

---

## Notas de implementação

- **Read-only, zero confirmation:** SELECT não precisa echo.
- **Strategic vs operational boundary:** specialist fornece dados, expertise squads (/metaAds) decidem. Linha bem clara.
- **Currency preservation:** campaigns podem ter currencies diferentes (EUR, USD, BRL). Output NÃO converte — respeita origem.
- **Flags não-blocking:** underperformer flags surface como warning, não BLOCKED. User decide agir.
- **Staleness tolerante:** Meta sync é mais custoso (grande volume de data); 30min FRESH é compatível com cron jobs típicos.
- **No RLS super restrito observado:** Meta tables não têm filter por user_id direto; assume-se que todos com acesso ao app têm leitura. Se role=cs/comercial tentar, RLS pode bloquear — honest BLOCKED.

---

**Mantido por:** integration-specialist.

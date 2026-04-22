# Edge Functions Required — primeteam-side Infrastructure

> Documento de **handoff** para o team primeteam. Lista TODAS as edge functions referenciadas pelos specialists deste squad, com specs básicas e ordering de prioridade. Essas funções devem existir no repo `ByPabloRuanL/primeteam` em `supabase/functions/`.

---

## Status atual (2026-04-22)

| # | Edge Function | Já existe? | Priority | Referenciada por |
|---|---------------|:----------:|:--------:|------------------|
| 1 | `sync-meta-billing` | ✅ (Fase 0+) | P0 | integration-specialist (Meta sync) |
| 2 | `get-revolut-balances` | ✅ (Fase 0+) | P0 | integration-specialist (Revolut balance check) |
| 3 | `sync-revolut-transactions` | ✅ (Fase 0+) | P0 | integration-specialist (Revolut sync) |
| 4 | `sync-google-calendar` | ✅ (assumido) | P0 | integration-specialist (Calendar sync) |
| 5 | `trigger-vapi-call` | ❌ | P1 | integration-specialist (Sprint 16 trigger AI call) |
| 6 | `update-meta-campaign` | ❌ | P1 | integration-specialist (Sprint 15 pause/resume/budget) |
| 7 | `create-google-event` | ❌ | P1 | integration-specialist (Sprint 15 calendar CRUD) |
| 8 | `update-google-event` | ❌ | P1 | integration-specialist (Sprint 15) |
| 9 | `delete-google-event` | ❌ | P1 | integration-specialist (Sprint 15) |
| 10 | `rotate-google-watch` | ❌ | P2 | wf-watch-channel-rotation |
| 11 | `fetch-ecb-rates` | ❌ | P2 | wf-currency-convert (ECB source) |
| 12 | `fetch-revolut-rate` | ❌ | P2 | wf-currency-convert (Revolut snapshot source) |
| 13 | `calculate-ab-significance` | ❌ | P3 | wf-meta-ab-test (statistical test) |
| 14 | `send-welcome-email` | ❌ | P2 | wf-onboarding-approval (welcome email trigger) |
| 15 | `refresh-google-token` | ❌ | P2 | integration-specialist (token lifecycle) |

**Priority legenda:**
- **P0:** já existem / core functioning (validate que ainda estão online após Fase 0 remediation)
- **P1:** bloqueia use case ativo do squad (testes reais vão falhar sem isso)
- **P2:** usado em workflows / scenarios específicos (pode aguardar necessidade real)
- **P3:** nice-to-have (specialist pode fallback gracefully)

---

## Specs básicas (P1 obrigatórios)

### 5. `trigger-vapi-call`

**Propósito:** Inicia chamada AI outbound via VAPI SDK. Specialist invoca com user JWT → edge function valida JWT → chama VAPI → registra em `telephony_calls` com `status='in_progress'`.

**Body esperado:**
```json
{
  "to_number": "+393481234567",
  "strategy_id": "uuid-of-call_strategies-row",
  "lead_id": "uuid-optional",
  "opportunity_id": "uuid-optional",
  "custom_variables": { "key": "value" }
}
```

**Retorno:**
```json
{
  "success": true,
  "call_id": "uuid",
  "vapi_call_id": "vapi-provider-id",
  "estimated_cost_per_min": 0.15
}
```

**verify_jwt:** `true` (per Fase 0 security — user must be authenticated)

**Segredos necessários (Supabase vault):**
- `VAPI_API_KEY`
- `VAPI_DEFAULT_PHONE_NUMBER_ID`

**Comportamento:**
1. Parse body + validate to_number format (E.164)
2. Fetch call_strategy (prompt, voice_id, system_message)
3. Call VAPI API `POST /call`
4. Insert row in `telephony_calls` (status=in_progress, direction=outbound, from_number=our number, to_number)
5. Webhooks VAPI vão atualizar status/transcription/sentiment posteriormente

---

### 6. `update-meta-campaign`

**Propósito:** Aplicar mutations em Meta Ads campaign (pause/resume/change budget).

**Body esperado:**
```json
{
  "campaign_id": "meta-campaign-id",
  "effective_status": "ACTIVE | PAUSED",
  "daily_budget": 10000
}
```

**Retorno:**
```json
{
  "success": true,
  "changes_applied": { "effective_status": "PAUSED", "daily_budget": null },
  "meta_response": { /* Meta Graph API response */ }
}
```

**verify_jwt:** `true`

**Segredos:**
- `META_ACCESS_TOKEN` (long-lived system user token)

**Comportamento:**
1. Validate caller has role (owner/admin/marketing) via profiles + user_roles join
2. Call Meta Graph API `POST /{campaign_id}` with updated fields
3. Update `meta_ads_campaigns_cache` optimistically (webhook re-syncs)
4. Log mutation em custom audit table (se existir)

---

### 7-9. `create-google-event` / `update-google-event` / `delete-google-event`

**Propósito:** CRUD de events no Google Calendar user's primary calendar.

**Body (create):**
```json
{
  "title": "string",
  "start_time": "2026-04-24T14:00:00Z",
  "end_time": "2026-04-24T15:00:00Z",
  "description": "string optional",
  "location": "string optional",
  "attendees": ["email1@x.com"],
  "add_meet_link": true,
  "reminder_minutes": [60, 15]
}
```

**Retorno (create):**
```json
{
  "success": true,
  "google_event_id": "abc123",
  "html_link": "https://calendar.google.com/...",
  "meet_link": "https://meet.google.com/..." 
}
```

**verify_jwt:** `true`

**Segredos:** Nenhum específico — usa `google_calendar_tokens` do user (OAuth token já armazenado).

**Comportamento (create):**
1. Fetch user's google_calendar_token, check expires_at
2. If expired: trigger refresh via Google OAuth refresh endpoint
3. Call `POST /calendar/v3/calendars/primary/events` with body
4. If `add_meet_link=true`, include `conferenceData.createRequest.conferenceSolutionKey.type='hangoutsMeet'`
5. Cache será atualizado via webhook (watch channel)

---

## Specs básicas (P2 — workflows dedicados)

### 10. `rotate-google-watch`

**Propósito:** Re-registrar Google Calendar watch channel antes de 7-day expiration.

**Body:**
```json
{ "channel_id": "existing-channel-id" }
```

**Comportamento:**
1. Stop old channel: `POST /calendar/v3/channels/stop`
2. Create new channel: `POST /calendar/v3/calendars/primary/events/watch` with new expiration (+7d)
3. UPDATE `google_calendar_watch_channels` row

**Idempotent:** se channel já rotated (new expiration future), skip.

---

### 11. `fetch-ecb-rates`

**Propósito:** Fetch taxa de câmbio histórica da ECB (European Central Bank — rates oficiais daily).

**Body:**
```json
{
  "date": "2026-04-15",
  "from_currency": "USD",
  "to_currency": "EUR"
}
```

**Retorno:**
```json
{ "success": true, "rate": 0.93, "source": "ECB", "date": "2026-04-15" }
```

**Comportamento:**
1. Check `fx_rate_cache` table primeiro (se existe row para date+currencies, retorna)
2. Else, fetch de ECB XML endpoint (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)
3. Cache result em `fx_rate_cache`
4. Retorna

**Cache strategy:** ECB rates são estáveis retroativamente — cache forever.

---

### 12. `fetch-revolut-rate`

Similar a ECB mas source = Revolut API (requires token).

---

### 14. `send-welcome-email`

**Propósito:** Trigger welcome email após customer criado via wf-onboarding-approval.

**Body:**
```json
{
  "customer_id": "uuid",
  "template_id": "welcome_default_v1"
}
```

**Comportamento:**
1. Fetch customer contact_email, full_name, etc.
2. Render template (Handlebars / Liquid)
3. Send via email provider (SendGrid / Postmark / etc.)
4. Mark customer.metadata.welcome_email_sent_at = now()

**Idempotent:** se welcome já enviado (metadata flag), skip.

---

### 15. `refresh-google-token`

**Propósito:** Refresh Google OAuth token quando `google_calendar_tokens.expires_at < now()`.

**Comportamento:** chama Google OAuth refresh endpoint com refresh_token → obtém novo access_token → UPDATE tokens row.

---

## Specs básicas (P3 — nice-to-have)

### 13. `calculate-ab-significance`

**Propósito:** Statistical test (chi-square / z-test) entre 2 variants para A/B test.

**Body:**
```json
{
  "variant_a": { "impressions": 10000, "clicks": 200 },
  "variant_b": { "impressions": 10000, "clicks": 250 }
}
```

**Retorno:**
```json
{
  "winner": "B",
  "confidence": 0.97,
  "uplift_percent": 25.0,
  "sample_size_sufficient": true
}
```

**Alternativa lightweight:** specialist pode fazer cálculo inline em JavaScript no próprio agent (simple formula) sem edge function. Edge function é útil se quiser consistência + testes unitários.

---

## Segurança — princípios para TODAS as edge functions

1. **verify_jwt=true obrigatório** — toda edge function deste doc exige JWT válido
2. **Role check per mutation** — mutations sensitivas (Meta pause, event CRUD) devem re-verificar role via `profiles` + `user_roles` join, NÃO confiar só no JWT present
3. **Audit log** — considerar tabela `edge_function_audit_log` para rastrear mutations (quem, quando, o que)
4. **Rate limiting** — cada edge function referenciada pode consumir quota externa (Meta, Google, VAPI). Considerar rate limit per user
5. **Never log secrets** — `VAPI_API_KEY`, `META_ACCESS_TOKEN` nunca aparecem em logs

---

## Ordering recomendado de implementação

Fase 1 (P1 — bloqueia primeiros testes reais):
1. `update-meta-campaign` — se marketing quer pausar campanha via squad
2. `create-google-event` — primeiro use case "criar evento via Claude Code"
3. `trigger-vapi-call` — se comercial quer disparar AI calls

Fase 2 (P2 — workflows específicos):
4. `rotate-google-watch` — setup cron job (sem isso, cache fica stale silencioso)
5. `fetch-ecb-rates` — quando financeiro precisar conversion retrospective
6. `send-welcome-email` — quando CS for usar wf-onboarding-approval de verdade

Fase 3 (P3 — optimização):
7. `calculate-ab-significance` — apenas se team for rodar A/B tests via squad

---

## Referências

- Specialists que chamam estas functions: `agents/integration-specialist.md`, `agents/automation-specialist.md`
- Workflows que invocam: `workflows/wf-currency-convert.yaml`, `workflows/wf-watch-channel-rotation.yaml`, `workflows/wf-meta-ab-test.yaml`, `workflows/wf-onboarding-approval.yaml`
- Security baseline: PrimeTeam PR #951 (RLS) e #952 (verify_jwt) da Fase 0

---

**Mantido por:** squad primeteam-ops (consumer) + team primeteam (implementer). Any update in specialist referencing new edge function should update this doc.

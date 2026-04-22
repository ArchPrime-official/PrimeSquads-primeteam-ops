# External Integrations Inventory

> As 8 integrações externas da plataforma PrimeTeam, com estado atual de setup e Edge Functions relacionadas.

**Source:** auditoria CLI `docs/platform-analysis/PRIMETEAM-CLI-FEASIBILITY-AUDIT-2026-04-22.md` (Seção 2).

**Total Edge Functions:** 195 — classificação completa no relatório acima.

---

## 1. Supabase (core)

| Campo | Valor |
|-------|-------|
| Project ref | `xmqmuxwlecjbpubjdkoj` |
| URL | `https://xmqmuxwlecjbpubjdkoj.supabase.co` |
| Services | Auth, Database, Realtime, Storage, Edge Functions |
| Edge Functions | 195 |
| Status | ✅ Ativo, RLS 100%, pós-Fase 0 limpo |

**Para squad:** referência primária. Auth + CRUD operam aqui.

---

## 2. Meta Ads (Facebook/Instagram)

| Campo | Valor |
|-------|-------|
| Purpose | Sync de campanhas, ad sets, ads, métricas diárias |
| Auth | Access tokens salvos em `meta_ad_accounts.access_token` |
| Sync | Cron horário (`meta-ads-cron-sync`) + manual |
| Status | ✅ Ativo |

**Edge Functions (15+):**
- `meta-ads-campaigns-v2`, `meta-ads-adsets`, `meta-ads-breakdowns`, `meta-ads-full-sync`, `meta-ads-funnel-kpis`, `meta-ads-cron-sync`, `meta-sync-discover`, `meta-sync-worker`, `meta-conversion-tracking`, `meta-spend-cleanup`, `sync-meta-billing`

**Para squad:** agent `marketing-specialist` (quando criado, Fase 2).

---

## 3. Google Calendar

| Campo | Valor |
|-------|-------|
| Purpose | Sync bidirecional de agenda com closers |
| Auth | OAuth2 per-closer (tokens em `user_oauth_tokens`) |
| Wrapper CLI necessário | ✅ sim (Fase 2) |
| Status | ✅ Ativo |

**Edge Functions (7):**
- `google-calendar-oauth`, `google-calendar-closer-oauth`, `google-calendar-events`, `google-calendar-update-event`, `google-calendar-sync`, `google-calendar-webhook`, `google-auth-save-tokens`

**Para squad:** `calendar-specialist` usa wrapper que lê `user_oauth_tokens` e chama Google API com o token do usuário.

---

## 4. Ringover (VoIP)

| Campo | Valor |
|-------|-------|
| Purpose | Telefonia, call tracking, transcripts |
| Integration | Webhook (pós-chamada) |
| Status | ✅ Ativo |

**Edge Functions (3):**
- `ringover-webhook`, `ringover-prelog`, `ringover-transcript`

**Para squad:** `integration-specialist` para histórico/transcripts. Chamada ao vivo fica no browser.

---

## 5. WhatsApp Business

| Campo | Valor |
|-------|-------|
| Purpose | Gateway de mensagens com clientes |
| Status | ✅ Ativo |

**Edge Functions (6):**
- `whatsapp-gateway`, `whatsapp-qr`, `whatsapp-secret`, `whatsapp-session`, `whatsapp-send`, `whatsapp-webhook`

**Para squad:** agent futuro (integration-specialist) para envio programado.

---

## 6. Stripe

| Campo | Valor |
|-------|-------|
| Purpose | Payment processing, subscriptions |
| Integration | Webhook + API |
| Status | ✅ Ativo |

**Edge Functions (5):**
- `stripe-webhook`, `stripe-tax-webhook`, `get-stripe-balances`, `sync-stripe-transactions`, `archprime-checkout`, `landing-page-checkout`

**Para squad:** `integration-specialist` (read-only balances, sync) + eventual integração no `content-builder` para configurar Stripe em LP.

---

## 7. VAPI (AI voice calls)

| Campo | Valor |
|-------|-------|
| Purpose | Chamadas AI-powered |
| Status | ✅ Ativo |

**Edge Functions (7):**
- `vapi-start-call`, `vapi-webhook`, `vapi-dispatcher`, `vapi-bulk-call`, `vapi-check-config`, `vapi-retroactive-enqueue`, `sync-vapi-billing`

**Para squad:** `automation-specialist` (configurar call strategies no automation flow).

---

## 8. Revolut

| Campo | Valor |
|-------|-------|
| Purpose | Bank account sync, balances |
| Auth | OAuth2 |
| Status | ✅ Ativo |

**Edge Functions (9):**
- `revolut-oauth-start`, `revolut-oauth-callback`, `revolut-webhook`, `revolut-webhook-setup`, `sync-revolut-transactions`, `sync-revolut-transactions-cron`, `get-revolut-balances`, `verify-revolut-balances-cron`, `check-revolut-webhook`

**Para squad:** `platform-specialist` (finance part) sincroniza via wrapper. `integration-specialist` se precisar reconfigurar OAuth.

---

## Estratégia de wrappers OAuth

Para Google Calendar, Revolut e Meta (OAuth inicial acontece no browser uma vez), o squad:

1. NÃO repete o OAuth flow (seria redundante)
2. Lê `user_oauth_tokens` do Supabase (respeitando RLS)
3. Usa o access_token salvo para chamar a API externa
4. Se token expirado, faz refresh via Edge Function apropriada

Isso mantém o squad simples e respeita o contrato de "cada user tem sua sessão".

---

## Reference

- Auditoria completa das 195 Edge Functions: `docs/platform-analysis/PRIMETEAM-CLI-FEASIBILITY-AUDIT-2026-04-22.md` (Seção 2)
- Config: `supabase/config.toml` (verify_jwt por function)
- Schema RLS: `data/schema-reference.md`

# Task: create-evento-products

> Criar batch products para evento (early bird, regular, VIP) com Fiscal Engine + Stripe Catalog sync. Bridge M-13/M-17. admin/owner.

**✅ SCHEMA GROUNDED (2026-07-03):** `products.Insert` exige **`code`** (NOT NULL, sem default) e `name` (NOT NULL) — a task original não gerava/pedia `code`. Não existem colunas `tax_rate`, `availability_window`, `capacity` em `products` — as colunas fiscais reais são `tax_category` (enum de app `consultancy_bundle | saas_pure | agency_service | live_event_online | live_event_physical | mixed | pending_classification`, ver `apps/v2/src/lib/products/productOptions.ts`), `fiscal_override` (jsonb opcional: `{tax_treatment, reason, effective_from, effective_until}`), `stripe_tax_code`. Preço é `price` (numeric) + `currency` (não `price_eur`). **Não existe tabela `events`** — um evento é uma `campaigns` row (`campaigns.id`); a task não linka products a campaign diretamente (products não tem `campaign_id`) — o link é feito por quem cria a `opportunity`/oferta apontando pro `product_id` dentro daquela campanha, fora do escopo desta task. **A task `update-event-products` NÃO existe** no squad — remover a referência.

**Empresa/regime fiscal:** `products` **não tem coluna de empresa/brand**. Quem determina ArchPrime (UK, HMRC, nunca OSS) vs Lovarch (OSS) é o `company_id`/`brand_slug` da **nota fiscal** no momento da emissão (`resolveTaxContext.ts`), combinado com o `tax_category` do produto. Por isso esta task NUNCA deve defaultar "IT 22%" (que nem é um valor de `tax_category` válido) — deve **perguntar** qual `tax_category` corresponde ao produto (ex.: evento com sessão ao vivo presencial → `live_event_physical`; webinar/evento online → `live_event_online`) e, se relevante para o contexto do evento, para qual empresa (ArchPrime/Lovarch) o evento é vendido (informativo — isso decide o regime na nota, não no produto).

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Create Evento Products`

### responsible_executor `admin-specialist`

### execution_type `Agent` — DUPLA confirmation (mutações em Stripe externo).

### input
- `campaign_id` (uuid — `campaigns.id` do evento) OU `campaign_slug` (text `campaigns.campaign_id`, resolvido para o uuid)
- `products` (array, min 1, max 5):
  - `code` (string, obrigatório — NOT NULL em `products`; sem geração automática documentada, pedir/gerar um código legível único, ex.: `EVT-{campaign_slug}-{tier}`)
  - `name` (obrigatório), `price` (decimal) + `currency` (ISO 4217, ex. `EUR`/`GBP`), `tier` (`'early_bird' | 'regular' | 'vip' | 'custom'`)
  - `description` opcional
  - `tax_category` (obrigatório — enum de app: `consultancy_bundle | saas_pure | agency_service | live_event_online | live_event_physical | mixed | pending_classification`; **nunca defaultar** — perguntar se o evento é presencial (`live_event_physical`) ou online (`live_event_online`))
  - `fiscal_override` (jsonb opcional, só se o regime padrão do `tax_category` não se aplicar ao caso)
- **Empresa do evento** (ArchPrime ou Lovarch) — informativo para o time de faturamento (não é coluna de `products`; decide o regime OSS/HMRC na hora de emitir a nota, via `company_id`/`brand_slug` da fatura). Perguntar explicitamente, nunca assumir.

### output
- `created_products` (array): `{id, code, name, stripe_product_id, stripe_price_id, sync_status}`
- `campaign_id` (echo)
- `verdict`: `DONE | PARTIAL | BLOCKED`

### action_items

1. **Auth `has_invoice_access()`** (função real — `true` se owner ou admin; ver `supabase/migrations/20260419200000_add_sales_invoices_module.sql`).
2. Resolver `campaign_id` (se veio `campaign_slug`, resolver via `SELECT id FROM campaigns WHERE campaign_id = {slug}`).
3. Validar products:
   - `code` único (checar contra `products.code` existente)
   - Names únicos dentro do batch
   - Prices > 0, `currency` válida
   - `tax_category` ∈ enum de app válido (nunca aceitar vazio/"IT 22%")
4. Confirmation:
   ```
   Vou criar {N} products para o evento «{campaign_name}»:
     [list: code, name, price+currency, tier, tax_category]

   Empresa/regime: {empresa} ({tax_category} → regime resolvido na nota, não no produto)

   ⚠️ MUTAÇÕES EXTERNAS:
   - INSERT products table
   - Stripe Catalog: create products + prices (via stripe-product-sync)

   Erro Stripe = rollback DB inserts.
   Confirma? (digite "CONFIRMO CRIA PRODUCTS" uppercase)
   ```
5. **Atomic-ish via SAVEPOINT per product:**
   - INSERT product DB (com `code`, `name`, `price`, `currency`, `tax_category`, `fiscal_override` se houver)
   - Invoke `stripe-product-sync` edge (existe — `supabase/functions/stripe-product-sync/`)
   - Atualizar product com stripe_ids
   - Falha Stripe = log warning, continuar (BEGIN/SAVEPOINT raw não funciona via PostgREST)
6. Activity log STRICT com `campaign_id` + product_ids.
7. Echo:
   ```
   ✓ {N} products criados ({sync_ok}/{total} synced Stripe)
   {failed_sync ? failed.length + ' falharam Stripe — corrigir manual' : ''}
   Próximos passos: vincular os products à oferta/opportunity do evento (não existe task update-event-products — o link é feito no fluxo de venda/checkout, apontando product_id).
   ```

### acceptance_criteria
- A1 has_invoice_access (owner/admin)
- A2 Tripla "CONFIRMO CRIA PRODUCTS"
- A3 Atomic per-product (SAVEPOINT)
- A4 Stripe rollback on failure
- A5 Audit STRICT
- A6 `code` obrigatório e único; `tax_category` obrigatório e SEM default silencioso — sempre perguntar
- A7 Max 5 products per call

---

**Mantido por:** admin-specialist

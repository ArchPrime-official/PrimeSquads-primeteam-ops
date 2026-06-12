# Task: create-evento-products

> Criar batch products para evento (early bird, regular, VIP) com Fiscal Engine + Stripe Catalog sync. Bridge M-13/M-17. admin/owner.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Create Evento Products`

### responsible_executor `admin-specialist`

### execution_type `Agent` — DUPLA confirmation (mutações em Stripe externo).

### input
- `event_id` (uuid)
- `products` (array, min 1, max 5):
  - `name`, `price_eur` (decimal), `tier` (`'early_bird' | 'regular' | 'vip' | 'custom'`)
  - `description`, `tax_rate` (default IT 22%)
  - `availability_window`: `{from, to}` opcional
  - `capacity` (int opcional)

### output
- `created_products` (array): `{id, name, stripe_product_id, stripe_price_id, sync_status}`
- `event_id` (echo)
- `verdict`: `DONE | PARTIAL | BLOCKED`

### action_items

1. **Auth has_invoice_access** (admin/owner).
2. Resolver event_id.
3. Validar products:
   - Names unique no event
   - Prices > 0
   - Capacity opcional > 0
   - Availability dates dentro de event period
4. Confirmation:
   ```
   Vou criar {N} products para evento «{event_name}»:
     [list: name, price, tier, capacity]

   ⚠️ MUTAÇÕES EXTERNAS:
   - INSERT products table (Fiscal Engine)
   - Stripe Catalog: create products + prices

   Erro Stripe = rollback DB inserts.
   Confirma? (digite "CRIA PRODUCTS" uppercase)
   ```
5. **Atomic-ish via SAVEPOINT per product:**
   - INSERT product DB
   - Invoke `stripe-product-sync` edge (NÃO `create-stripe-product` que não existe)
   - Atualizar product com stripe_ids
   - Falha Stripe = log warning, continuar (BEGIN/SAVEPOINT raw não funciona via PostgREST)
6. Activity log STRICT com event_id + product_ids.
7. Echo:
   ```
   ✓ {N} products criados ({sync_ok}/{total} synced Stripe)
   {failed_sync ? failed.length + ' falharam Stripe — corrigir manual' : ''}
   Próximos passos: link products ao evento via update-event-products
   ```

### acceptance_criteria
- A1 has_invoice_access
- A2 Tripla "CRIA PRODUCTS"
- A3 Atomic per-product (SAVEPOINT)
- A4 Stripe rollback on failure
- A5 Audit STRICT
- A6 Tax rate per country
- A7 Max 5 products per call

---

**Mantido por:** admin-specialist

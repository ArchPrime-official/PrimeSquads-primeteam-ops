# Task: create-sales-invoice

> Emitir nota fiscal (`sales_invoices`) para opportunity fechada. Número sequencial atomico (lock para evitar gap). Admin/owner only via `has_invoice_access()`. Implementa F-13.3 do PRD.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Create Sales Invoice`

### responsible_executor
`admin-specialist` (gate `has_invoice_access` = owner+admin)

### execution_type
`Agent` — confirmation OBRIGATÓRIO + dupla check em valores fiscais.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `opportunity_id` (uuid, obrigatório)
  - `customer_data` (object — name, tax_id, address, country) — pode resolver via opportunity.customer
  - `items` (array OR resolver via `opp_products`):
    - `description`, `quantity`, `unit_price`, `tax_rate` (%, ex 22 = IVA IT)
  - `currency` (ISO 4217, default conforme country)
  - `issue_date` (ISO date, default today)
  - `notes` (string opcional)

### output

- **`invoice_id`** (uuid)
- **`invoice_number`** (string sequencial — formato YYYYNNNN, ex `2026-0042`)
- **`total_net`**, **`total_tax`**, **`total_gross`**
- **`pdf_url`** (após geração)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Auth gate:** `has_invoice_access(auth.uid())` MUST=true (owner+admin). Outros → BLOCKED:
   ```
   Emitir nota fiscal requer role admin ou owner (has_invoice_access).
   Sua role: {role}. Peça à Joyce/Larissa (admin) ou Pablo (owner).
   ```
2. **Resolver opportunity:**
   ```sql
   SELECT id, customer_id, total_amount, currency, status, won_at, products
   FROM opportunities WHERE id={opportunity_id};
   ```
   - `status != 'won'` → ESCALATE com warning
   - Sem `won_at` → ESCALATE
   - Sem customer_id → ESCALATE com pedido para vincular customer primeiro
3. **Resolver items** se não passados — usar `opp_products` linked.
4. **Validar customer_data:** name, country obrigatórios. tax_id obrigatório se country IT/UK.
5. **Validar tax_rates:** match country (IT=22%, UK=20%, BR=variável). Outros valores → ESCALATE.
6. **Pre-check duplicate:**
   ```sql
   SELECT id FROM sales_invoices
   WHERE opportunity_id={opp_id} AND status NOT IN ('cancelled', 'rejected');
   ```
   Se já existe → ESCALATE com `invoice_already_exists` + ID.
7. **Calcular totals:**
   - `total_net = sum(qty * unit_price)`
   - `total_tax = sum(qty * unit_price * tax_rate / 100)`
   - `total_gross = net + tax`
8. **Confirmation message:**
   ```
   Vou emitir nota fiscal:
     Customer: {name} ({country}, tax_id: {tax_id or 'sem'})
     Opportunity: {opp_id} (won em {won_at})
     Items: {N}
     Net total: {currency} {net}
     Tax total: {currency} {tax}
     Gross total: {currency} {gross}
     Issue date: {issue_date}

   ⚠️ Nota fiscal emitida é IMUTÁVEL após criação (compliance HMRC/IT).
   Para correções: bulk-reissue-invoices ou cancelamento (admin).

   Confirma emissão? (digite "EMITE NOTA" uppercase literal)
   ```
9. **Aguardar "EMITE NOTA"** literal — tripla check em fiscal.
10. **Atomic INSERT via RPC `get_next_invoice_number()`** (usa advisory lock interno — não usar BEGIN/SAVEPOINT raw via PostgREST):
    ```typescript
    // Step 1: obter número sequencial via RPC (tem advisory lock interno)
    const { data: seqData } = await supabase.rpc('get_next_invoice_number', {
      p_year: new Date().getFullYear()
    });
    // seqData[0] = { next_number: '2026-0042', next_sequence: 42 }

    // Step 2: INSERT com número já reservado
    const { data: invoice } = await supabase.from('sales_invoices').insert({
      invoice_number: seqData[0].next_number,
      opportunity_id: opp_id,
      customer_data: customer_data,
      total_net: net, total_tax: tax, total_gross: gross,
      currency: currency,
      issue_date: issue_date,
      status: 'issued',
      created_by: auth_uid
    }).select('id, invoice_number').single();

    // Step 3: INSERT items
    await supabase.from('sales_invoice_items').insert(items.map(i => ({
      invoice_id: invoice.id, ...i
    })));
    ```
11. **Trigger PDF generation** — TODO: EF `generate-invoice-pdf` NÃO existe (ver lista EFs). Marcar como pendente:
    ```
    PDF: TODO (EF não implementada — generate-invoice-pdf ausente)
    ```
12. **Activity log STRICT:** falha = ROLLBACK invoice. action='admin-specialist.create_sales_invoice', details com invoice_number + opp_id + valores.
13. **Echo:**
    ```
    ✓ Nota fiscal emitida
    Number: {invoice_number} (sequencial 2026)
    Total: {currency} {gross} (net {net} + tax {tax})
    PDF: {pdf_url}
    Compliance: imutável após emissão

    Próximos passos:
    - PDF pode ser baixado e enviado ao customer
    - Reconciliação fiscal automática via cron (HMRC submission)
    ```

### acceptance_criteria

- **[A1] Auth gate has_invoice_access:** owner+admin only (intencional).
- **[A2] Sequential atomic:** advisory lock garante zero gap em invoice_number.
- **[A3] Imutability surface:** echo + confirmation enfatizam que nota é imutável.
- **[A4] Tripla confirmation:** "EMITE NOTA" uppercase literal.
- **[A5] Duplicate detection:** opp já com nota emitida = BLOCKED.
- **[A6] Tax math:** net + tax = gross (sanity check antes de INSERT).
- **[A7] Audit STRICT:** falha audit = rollback invoice (compliance crítico).
- **[A8] PDF generation:** trigger não-blocking; echo retorna URL após disponível.

---

## Exemplos

### Exemplo 1 — Joyce (admin) emite nota cliente IT (DONE)

**Input:** opp won € 4500, customer Marco Rossi (IT, tax_id válido), items 1x consulting

**Specialist:** Auth ✓, opp won ✓, sem dup ✓, tax_rate 22% IT, total_gross €5490 → confirmation → "EMITE NOTA" → INSERT atomic (number 2026-0042) → PDF triggered → DONE.

### Exemplo 2 — Comercial (sem auth) → BLOCKED

**Input:** Daniel (comercial) tenta emitir → BLOCKED imediato.

### Exemplo 3 — Opp duplicate → ESCALATE

**Input:** opp já tem invoice 2026-0040 → ESCALATE:
```
Opportunity já tem nota fiscal 2026-0040 emitida em 2026-04-15.
Para reemitir com correção: use bulk-reissue-invoices.
Para cancelar: contate owner (operação restrita).
```

---

## Notas

- **Atomic seq number:** RPC `get_next_invoice_number(p_year)` usa advisory lock interno. NÃO usar BEGIN/SAVEPOINT raw via PostgREST (não suportado).
- **PDF generation:** TODO — EF `generate-invoice-pdf` NÃO existe no projeto (2026-06-12). Implementar quando necessário.
- **Imutability:** trigger BEFORE UPDATE em `sales_invoices` rejeita mudanças em invoices com `status='issued'` (apenas voids permitidos).
- **HMRC compliance:** UK invoices têm formato específico (Making Tax Digital). Edge `submit-hmrc-invoice` faz submission automática (Sprint futuro).

---

**Mantido por:** admin-specialist

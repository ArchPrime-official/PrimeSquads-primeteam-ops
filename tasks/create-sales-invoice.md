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
10. **Atomic INSERT com lock:**
    ```sql
    BEGIN;
    -- Lock seq number (advisory lock para garantir sequencial)
    SELECT pg_advisory_xact_lock(hashtext('invoice_seq_' || EXTRACT(YEAR FROM NOW())::text));

    -- Get next number
    SELECT COALESCE(MAX(seq), 0) + 1 INTO next_seq
    FROM sales_invoices
    WHERE EXTRACT(YEAR FROM issue_date) = EXTRACT(YEAR FROM NOW());

    INSERT INTO sales_invoices
      (invoice_number, seq, opportunity_id, customer_data,
       total_net, total_tax, total_gross, currency,
       issue_date, status, created_by)
    VALUES (
      EXTRACT(YEAR FROM NOW()) || '-' || LPAD(next_seq::text, 4, '0'),
      next_seq, {opp_id}, {customer_data},
      {net}, {tax}, {gross}, {currency},
      {issue_date}, 'issued', auth.uid()
    )
    RETURNING id, invoice_number;

    -- INSERT items in sales_invoice_items
    INSERT INTO sales_invoice_items (invoice_id, ...) VALUES (...);

    COMMIT;
    ```
11. **Trigger PDF generation** via edge function `generate-invoice-pdf`.
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

- **Atomic seq number:** `pg_advisory_xact_lock` evita gaps em fila concorrente. Crítico para HMRC compliance.
- **PDF generation:** edge `generate-invoice-pdf` produz PDF via library (jsPDF/Puppeteer). Asset salvo em bucket `sales-invoices`.
- **Imutability:** trigger BEFORE UPDATE em `sales_invoices` rejeita mudanças em invoices com `status='issued'` (apenas voids permitidos).
- **HMRC compliance:** UK invoices têm formato específico (Making Tax Digital). Edge `submit-hmrc-invoice` faz submission automática (Sprint futuro).

---

**Mantido por:** admin-specialist

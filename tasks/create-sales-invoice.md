# Task: create-sales-invoice

> Emitir nota fiscal (`sales_invoices` + `sales_invoice_items`) para uma opportunity/transação fechada, seguindo o fluxo REAL de `/fatture` (page `FattureGeneratore.tsx` / hook `useSalesInvoices.ts`). Numeração sequencial POR EMPRESA via RPC `get_next_invoice_number`. Acesso gated por `has_invoice_access()`. Implementa F-13.3 do PRD.

**Cumpre:** HO-TP-001

> **Schema-verified 2026-07-02** contra `apps/v2/src/integrations/supabase/types.ts`. Todas as tabelas/colunas/RPCs citadas existem no schema real. Refs mortas da versão anterior (tabela `invoices`, colunas `total_net/total_tax/total_gross`, `customer_data`, `issue_date`, status `cancelled/rejected`, EF `generate-invoice-pdf`, `opp_products`, `opportunities.total_amount/won_at/status='won'`) foram substituídas pelos nomes reais.

---

## Task anatomy

### task_name
`Create Sales Invoice`

### responsible_executor
`admin-specialist` (gate `has_invoice_access()` — RPC boolean, sem args)

### execution_type
`Agent` — confirmation OBRIGATÓRIO + dupla check em valores fiscais.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload (`draft`):**
  - `opportunity_id` (uuid, obrigatório)
  - `customer_id` (uuid — resolve via `opportunities.customers`)
  - `company_id` (uuid ou null — empresa emissora; null = ArchPrime default, controla prefixo + sequência)
  - `finance_transaction_id` (uuid opcional — quando emitido a partir de uma parcela em `/finance/transactions`)
  - `customer_snapshot` (jsonb — snapshot congelado do cliente no momento da emissão; campos: `company_name`, `contact_name`, `contact_email`, `billing_address_line1/2`, `billing_city`, `billing_postcode`, `billing_country`, `vat_number`, `tax_id`, e campos fiscais IT `codice_fiscale`, `sdi_code`, `pec_email`, `invoice_legal_name`)
  - `items` (jsonb array — `description`, `qty`, `unit_price`, `amount`, opcional `product_id`, `description_sub`)
  - `currency` (ISO 4217)
  - `invoice_date` (ISO date, default today) — data de emissão
  - `supply_date` (ISO date) — tax point (default = data da transação)
  - `subtotal`, `discount`, `total` (numéricos; base para reconciliação IVA-inclusive)
  - `installment_number` / `installments_total` (opcionais, coerentes: ambos NULL ou 1 <= number <= total)
  - `payment_plan` (jsonb opcional — snapshot do plano de parcelamento)

### output

- **`invoice_id`** (uuid — `sales_invoices.id`)
- **`invoice_number`** (string sequencial POR EMPRESA — formato `<PREFIX>-YYYY-NNNN`, ex `AP-2026-0042` para ArchPrime)
- **`invoice_sequence`** (int) + **`invoice_year`** (int)
- **`subtotal`**, **`discount`**, **`total`**, **`net_amount`**, **`vat_amount`**, **`vat_rate`**, **`tax_treatment`**
- **`pdf_storage_path`** + **`html_storage_path`** (gerados client-side no momento da emissão)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Auth gate:** `has_invoice_access()` MUST=true. Sem args (deriva de `auth.uid()`). Outros → BLOCKED:
   ```
   Emitir nota fiscal requer acesso fiscal (has_invoice_access = false para você).
   Peça a um admin/owner com acesso fiscal (Joyce/Larissa/Pablo).
   ```
2. **Resolver opportunity + customer** (join real — customer NÃO é coluna direta):
   ```sql
   SELECT o.id, o.closed_at, o.sales_proposal_value, o.sales_proposal_currency,
          o.product_id, o.lead_id,
          o.negotiation_upfront_value, o.negotiation_installments,
          o.negotiation_installments_count,
          c.id AS customer_id, c.company_name, c.contact_name, c.contact_email,
          c.billing_address_line1, c.billing_address_line2, c.billing_city,
          c.billing_postcode, c.billing_country, c.vat_number, c.tax_id,
          c.codice_fiscale, c.sdi_code, c.pec_email, c.invoice_legal_name,
          c.preferred_currency
   FROM opportunities o
   LEFT JOIN customers c ON c.opportunity_id = o.id  -- relação real via join, não coluna
   WHERE o.id = {opportunity_id};
   ```
   - Sem `closed_at` → ESCALATE (opp não fechada; use `closed_at`, não `won_at`).
   - Sem customer vinculado → ESCALATE com pedido para vincular customer primeiro.
3. **Resolver items:** derivados do produto (`opportunities.product_id` → `products.invoice_description_i18n, tax_category`) + valores da negociação (`negotiation_*`). NÃO existe tabela `opp_products` — a linha vem de `products` + snapshot da negociação.
4. **Montar `customer_snapshot`** a partir dos campos do customer (inclui fiscais IT: `codice_fiscale`, `sdi_code`, `pec_email`, `invoice_legal_name`). É snapshot CONGELADO — a nota preserva os dados do momento da emissão.
5. **Guard de duplicidade (por transação):** se `draft.finance_transaction_id` já tem `finance_transactions.sales_invoice_id` preenchido → BLOCKED:
   ```
   Esta transazione finanziaria ha già una fattura emessa.
   Apri la fattura esistente invece di emetterne una nuova.
   ```
   (O DB reforça via UNIQUE em `finance_transactions.sales_invoice_id`.)
6. **Classificação fiscal (tax classifier):** resolve `tax_treatment`, `vat_rate`, `vat_amount`, `net_amount`, `tax_note_en`, `tax_note_local`, `customer_language`, `issuer_vat_number`, `issuer_vat_registered`. Suporta OSS (colunas `oss_country_of_consumption`, `oss_declaration_id`, `oss_declaration_period`) para B2C intra-UE. Falha do classifier é NÃO-fatal → fallback legado sem IVA.
7. **Reconciliação IVA-inclusive:** o valor Stripe é BRUTO. Decompor em `net_amount` + `vat_amount` a partir de `subtotal`/`discount`/`total` e do `vat_rate` do classifier. Sanity: `net_amount + vat_amount ≈ total`.
8. **Confirmation message:**
   ```
   Vou emitir nota fiscal:
     Emissor (company_id): {issuer_company_name} ({issuer_country})
     Cliente: {company_name} ({billing_country})
              VAT: {vat_number or '—'} · CF: {codice_fiscale or '—'} · SDI: {sdi_code or '—'}
     Opportunity: {opp_id} (chiusa em {closed_at})
     Tax treatment: {tax_treatment} · IVA {vat_rate}%
     Net: {currency} {net_amount}
     IVA: {currency} {vat_amount}
     Totale: {currency} {total}
     Data emissione: {invoice_date} · Supply date: {supply_date}

   ⚠️ Nota fiscal emitida é IMUTÁVEL. Correção = void (status='voided') + reemissão.

   Confirma emissão? (digite "CONFIRMO EMITE NOTA" uppercase literal)
   ```
9. **Aguardar "CONFIRMO EMITE NOTA"** literal.
10. **Obter número sequencial POR EMPRESA via RPC** (advisory lock interno — NÃO usar BEGIN/SAVEPOINT raw via PostgREST):
    ```typescript
    // get_next_invoice_number tem 2 overloads:
    //   (p_company_id, p_year?)  → numeração por empresa (prefixo próprio)
    //   (p_year?)                → default ArchPrime
    // Retorna [{ next_number, next_sequence }]
    const { data: seq } = await supabase.rpc('get_next_invoice_number', {
      p_company_id: draft.company_id ?? null,
      p_year: new Date(draft.invoice_date).getFullYear(),
    });
    const { next_number, next_sequence } = seq[0]; // ex: 'AP-2026-0042', 42
    ```
11. **Gerar HTML + PDF client-side** e fazer upload para storage (é assim que o `/fatture` real funciona — NÃO existe EF `generate-invoice-pdf`):
    - `renderInvoiceHtml(params)` → `html_content`
    - `generateInvoicePdf(html, next_number)` → `pdfBlob`
    - `uploadInvoiceFiles(...)` → `{ htmlPath, pdfPath }`
12. **INSERT em `sales_invoices`** (colunas REAIS):
    ```typescript
    const { data: invoice } = await supabase.from('sales_invoices').insert({
      invoice_number: next_number,
      invoice_year: year,
      invoice_sequence: next_sequence,
      company_id: draft.company_id ?? null,
      opportunity_id: draft.opportunity_id,
      customer_id: draft.customer_id,
      customer_snapshot: draft.customer_snapshot,
      issuer_company_name: draft.issuer.company_name,
      issuer_company_number: draft.issuer.company_number,
      issuer_address: draft.issuer.address,
      issuer_email: draft.issuer.email,
      issuer_country: draft.issuer.country,
      items: netItems,                 // jsonb (fonte de exibição)
      subtotal, discount, total,
      net_amount, vat_amount, vat_rate, tax_treatment,
      tax_note_en, tax_note_local, customer_language,
      issuer_vat_number, issuer_vat_registered,
      // OSS quando aplicável:
      oss_country_of_consumption, oss_declaration_period,
      currency: draft.currency,
      gbp_equivalent, exchange_rate, exchange_rate_source,
      invoice_date: draft.invoice_date,
      supply_date: draft.supply_date,
      status: txAlreadyCompleted ? 'paid' : 'issued',  // enum: draft|issued|paid|voided|refunded
      html_content: html,
      pdf_storage_path: pdfPath,
      html_storage_path: htmlPath,
      issued_at: new Date().toISOString(),
      installment_number: coherentInstallmentNumber,
      installments_total: coherentInstallmentsTotal,
      payment_plan_snapshot: draft.payment_plan ?? null,
      created_by: auth_uid,
    }).select().single();
    ```
13. **INSERT em `sales_invoice_items`** (espelho relacional; não-fatal — `sales_invoices.items` jsonb é a fonte de exibição):
    ```typescript
    await supabase.from('sales_invoice_items').insert(netItems.map((i, idx) => ({
      invoice_id: invoice.id,
      product_id: i.product_id ?? null,
      description_fallback: i.description,
      description_i18n: { en: i.description },
      qty: i.qty, unit_price: i.unit_price, amount: i.amount,
      tax_treatment, vat_rate, vat_amount: /* net * rate/100 */, net_amount: i.amount,
      position: idx,
    })));
    ```
14. **Vincular transação financeira** (via RPC canônica OU update direto):
    - Preferir RPC `link_existing_transaction_to_invoice(p_invoice_id, p_transaction_id)` (retorna Json) quando há `finance_transaction_id`.
    - O fluxo v1/v2 também faz update direto de `finance_transactions.sales_invoice_id` + `sales_invoices.finance_transaction_id`. RPC `move_transactions_to_invoice(p_target_invoice_id, p_transaction_ids[])` existe para mover várias transações para uma nota.
15. **(Opcional) Verificar total persistido** via RPC `calculate_invoice_total(p_invoice_id)` (retorna number recomputado a partir dos items) — sanity-check pós-insert contra `total`.
16. **Audit log:** INSERT em `invoice_audit_log` (`invoice_id`, `action` = `'classified'|'created'`, `actor_user_id`, `after_state` jsonb, `notes`). Não-fatal, mas registrar sempre.
17. **Echo:**
    ```
    ✓ Nota fiscal emitida
    Number: {invoice_number} (sequência {invoice_sequence}/{invoice_year}, empresa {company})
    Tax treatment: {tax_treatment} · IVA {vat_rate}%
    Net {currency} {net_amount} + IVA {vat_amount} = Totale {total}
    PDF: {pdf_storage_path} · HTML: {html_storage_path}
    Compliance: imutável (correção = void + reemissão)
    ```

### acceptance_criteria

- **[A1] Auth gate:** `has_invoice_access()` (RPC boolean sem args) MUST=true.
- **[A2] Numeração atômica POR EMPRESA:** `get_next_invoice_number(p_company_id, p_year)` (advisory lock interno) — zero gap dentro de cada prefixo/ano.
- **[A3] Colunas reais:** `subtotal/discount/total/net_amount/vat_amount/vat_rate/tax_treatment`, `customer_snapshot`, `invoice_date/supply_date`, `invoice_number/invoice_sequence/invoice_year` (NUNCA `total_net/total_gross/customer_data/issue_date`).
- **[A4] Status enum válido:** só `draft|issued|paid|voided|refunded` (NUNCA `cancelled|rejected`).
- **[A5] Duplicate detection:** transação com `sales_invoice_id` já preenchido = BLOCKED (reforçado por UNIQUE no DB).
- **[A6] Tax math:** `net_amount + vat_amount ≈ total` (reconciliação IVA-inclusive antes do INSERT).
- **[A7] PDF real:** HTML+PDF gerados client-side + upload (`pdf_storage_path`/`html_storage_path`) — NÃO depende de EF inexistente.
- **[A8] Campos fiscais IT + OSS:** `codice_fiscale/sdi_code/pec_email/invoice_legal_name` no `customer_snapshot`; OSS via `oss_*` quando B2C intra-UE.
- **[A9] Audit:** entrada em `invoice_audit_log` por emissão.

---

## Exemplos

### Exemplo 1 — admin emite nota cliente IT B2C (DONE)

**Input:** opp fechada (`closed_at`), customer Marco Rossi (IT, `codice_fiscale` preenchido, sem `vat_number`), produto principal.

**Specialist:** `has_invoice_access()` ✓, opp `closed_at` ✓, sem tx já faturada ✓ → classifier resolve `tax_treatment` IT + `vat_rate` 22% → reconcilia net/IVA → confirmation → "CONFIRMO EMITE NOTA" → `get_next_invoice_number(company_id, 2026)` → `AP-2026-0042` → render HTML+PDF+upload → INSERT `sales_invoices` (status `issued`) + `sales_invoice_items` + `invoice_audit_log` → DONE.

### Exemplo 2 — sem has_invoice_access → BLOCKED

**Input:** usuário sem acesso fiscal tenta emitir → `has_invoice_access()`=false → BLOCKED imediato.

### Exemplo 3 — transação já faturada → BLOCKED

**Input:** `finance_transaction_id` já tem `sales_invoice_id`:
```
Esta transazione ha già una fattura emessa. Apri la esistente.
Para corrigir: void da nota antiga (status='voided') + reemissão.
```

---

## Notas

- **Fonte de verdade:** `apps/v2/src/hooks/invoices/useSalesInvoices.ts` (mutation `issue`) + `apps/v2/src/pages/FattureGeneratore.tsx`. Refletir mudanças de fluxo aqui SEMPRE que esses arquivos mudarem.
- **Numeração:** RPC `get_next_invoice_number` — 2 overloads (`p_company_id, p_year?` para por-empresa; `p_year?` para ArchPrime default). Retorna `{ next_number, next_sequence }[]`. Advisory lock interno — NÃO usar BEGIN/SAVEPOINT raw via PostgREST.
- **PDF:** gerado 100% client-side (render HTML → PDF no browser → upload para storage). NÃO existe EF `generate-invoice-pdf` — a versão anterior desta task estava errada ao marcar PDF como TODO.
- **Void (imutabilidade):** corrigir nota = `UPDATE sales_invoices SET status='voided', voided_at, voided_by, voided_reason` + emitir nova. NÃO existe status `cancelled`.
- **Multi-empresa:** `company_id` FK `companies`; controla prefixo e sequência da numeração + dados do emissor (`issuer_*`).
- **OSS:** colunas `oss_country_of_consumption`, `oss_declaration_id`, `oss_declaration_period` para regime OSS (One Stop Shop) B2C intra-UE — populadas pelo classifier fiscal (majoritariamente Lovarch).
- **RPCs de finanças relacionadas:** `link_existing_transaction_to_invoice(p_invoice_id, p_transaction_id)` e `move_transactions_to_invoice(p_target_invoice_id, p_transaction_ids[])` — ambas retornam Json.

---

**Mantido por:** admin-specialist

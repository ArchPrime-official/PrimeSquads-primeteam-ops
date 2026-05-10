# Task: bulk-reissue-invoices

> Reemitir batch de notas fiscais (correções, customer data refresh). Cada reemissão CANCELA a antiga + emite nova com snapshot atualizado. Admin/owner only. Implementa F-13.4.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Bulk Reissue Sales Invoices`

### responsible_executor
`admin-specialist` (gate `has_invoice_access`)

### execution_type
`Agent` — DUPLA confirmation + dry-run preview obrigatório.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `invoice_ids` (array uuid, OR filter):
  - `filter` (object opcional): `{period_from, period_to, customer_id, has_error_flag}`
  - `reason` (string OBRIGATÓRIO — auditoria)
  - `apply_changes` (object): `{customer_data_refresh, tax_rate_correction, line_items_correction}`

### output

- **`reissue_batch_id`** (uuid — group em `invoice_reissue_batches`)
- **`reissued_count`** + **`old_invoice_ids`** + **`new_invoice_ids`**
- **`total_value_reissued`** (currency)
- **`verdict`** — `DONE | PARTIAL | BLOCKED`

### action_items

1. **Auth:** has_invoice_access. Outros → BLOCKED.
2. **Resolver invoice_ids** (lista direta OU filter query, max 100 por batch).
3. **Pre-flight check:** todas invoices em status='issued' (não cancelled/draft). Filtrar.
4. **Estimate impact:** soma de gross totals afetados.
5. **Dry-run preview** (mostra TODAS as mudanças):
   ```
   Reissue batch — {N} notas fiscais

   Razão: {reason}
   Período afetado: {min_date} → {max_date}
   Total value: {currency} {sum_gross}

   Mudanças aplicadas:
     - Customer data refresh: {true/false}
     - Tax rate correction: {old_rate}% → {new_rate}%
     - Line items: {N changes}

   Notas afetadas:
     [list 20 + count se > 20]

   IMPACTO:
     - Notas atuais: VOIDED (status='cancelled', voided_at=NOW)
     - Notas novas: emitidas com novo invoice_number sequencial
     - Audit trail: invoice_reissue_batches mantém old↔new linkage

   Confirma? (digite "REISSUE BATCH" uppercase literal)
   ```
6. **Aguardar "REISSUE BATCH"** literal.
7. **Atomic batch operation com SAVEPOINT por invoice:**
   ```sql
   BEGIN;
   INSERT INTO invoice_reissue_batches (id, reason, requested_by, count) VALUES (...);

   FOR each invoice IN list:
     SAVEPOINT sp_{i};
     -- Void old
     UPDATE sales_invoices
     SET status='cancelled', voided_at=NOW(), voided_by=auth.uid(),
         voided_reason='reissue: ' || {reason}
     WHERE id={old_id};

     -- Create new (uses lock for seq number)
     INSERT INTO sales_invoices (...)
     VALUES (apply_changes ON old data) RETURNING new_id;

     -- Link
     INSERT INTO invoice_reissue_links
       (batch_id, old_invoice_id, new_invoice_id) VALUES (...);

     -- If error: ROLLBACK TO sp_{i}, log warning, skip esta invoice
   END LOOP;
   COMMIT;
   ```
8. **Tratar partial failure:** se 47/50 succeeded, surface counts em handoff card. Não rollback total.
9. **Trigger PDF regen** para todas new invoices.
10. **Activity log STRICT:** action='admin-specialist.bulk_reissue_invoices', details com batch_id + old/new IDs + reason.
11. **Echo:**
    ```
    ✓ Reissue batch completo
    Batch ID: {batch_id}
    Successful: {N_ok}/{N_total}
    Failed: {N_failed} (ver warnings)
    Total value: {currency} {sum}
    PDFs: regenerando em background

    Audit trail completa em invoice_reissue_batches + invoice_reissue_links.
    ```

### acceptance_criteria

- **[A1] Auth has_invoice_access:** owner+admin only.
- **[A2] Reason obrigatório:** sem reason = ESCALATE.
- **[A3] Max 100 per batch:** evita storm.
- **[A4] Dry-run preview obrigatório:** user vê mudanças exatas antes de confirmar.
- **[A5] Tripla confirmation:** "REISSUE BATCH" uppercase literal.
- **[A6] Atomic per-invoice:** SAVEPOINT permite partial success.
- **[A7] Voided not deleted:** old invoices ficam em DB com status='cancelled' (audit trail completo).
- **[A8] Linkage table:** invoice_reissue_links mantém old↔new mapping para rastreabilidade.

---

## Exemplos

### Exemplo 1 — Joyce reemite 23 notas com tax_rate corrigido

**Input:** filter `{period_from='2026-04-01', period_to='2026-04-30', has_error_flag=true}`, `reason='Correção tax rate IT 22% (estava 21%)'`, apply `{tax_rate_correction: {old: 21, new: 22}}`

**Specialist:** dry-run mostra 23 notas afetadas, total €87k → "REISSUE BATCH" → 23/23 OK → PDFs regen → DONE.

### Exemplo 2 — Sem reason → ESCALATE

**Input:** invoice_ids passados sem `reason`

**Specialist:** ESCALATE:
```
Reissue requer 'reason' explícito (audit trail HMRC).
Exemplos válidos:
  - "Correção tax rate IT 22% (estava 21%)"
  - "Customer data atualizado (mudança endereço)"
  - "Erro em line items (valor unitário)"
```

### Exemplo 3 — Partial success (3 falham)

**Input:** 50 invoices, 3 falham por validação tax_id

**Specialist:** verdict=PARTIAL, 47 OK + 3 warnings detalhados. User decide cleanup individual.

---

## Notas

- **VOID semantics:** invoices canceladas mantêm row + status='cancelled'. Importante para audit + compliance HMRC.
- **Sequencial new:** mesma logic do create-sales-invoice (advisory lock + seq number).
- **PDF regen async:** edge `regenerate-invoice-pdfs` pega lista de new IDs.
- **Limit 100:** acima disso, dividir em batches sequenciais (operacional).

---

**Mantido por:** admin-specialist

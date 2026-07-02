# Task: bulk-reissue-invoices

> Reemitir batch de notas fiscais (correções, refresh de dados do cliente). Cada reemissão faria void da antiga (`status='voided'`) + emissão de nova com snapshot atualizado. Admin/owner via `has_invoice_access()`. Implementa F-13.4.

**Cumpre:** HO-TP-001

---

## ⛔ status: blocked_on_infra

**Schema-verified 2026-07-02** contra `apps/v2/src/integrations/supabase/types.ts`.

Esta task NÃO PODE ser executada em produção porque a **infraestrutura de reemissão em massa não existe no schema atual**. Confirmado por busca direta no `types.ts`:

| Referência da task | Existe no schema? |
|---|---|
| tabela `invoice_reissue_batches` | ❌ NÃO existe em `types.ts` |
| tabela `invoice_reissue_links` | ❌ NÃO existe em `types.ts` |
| coluna `sales_invoices.status = 'cancelled'` | ❌ enum `sales_invoice_status` só tem `draft \| issued \| paid \| voided \| refunded` |
| RPC de reemissão em batch | ❌ NÃO existe |
| EF `regenerate-invoice-pdfs` | ❌ NÃO existe em `supabase/functions/` |

Sem tabela de batch nem tabela de linkagem old↔new, **não há como rastrear a operação nem garantir atomicidade/rollback por invoice** exigidos por uma reemissão fiscal em massa. Marcar como `blocked_on_infra` até que as migrations abaixo sejam criadas. **NÃO ativar esta task nem inventar essas tabelas.**

### Infra faltante (pré-requisito para desbloquear)

1. **Migration `invoice_reissue_batches`** — rastrear o batch: `reason`, `requested_by`, `count`, `created_at`, `status` (com RLS habilitada na mesma migration — regra do projeto).
2. **Migration `invoice_reissue_links`** — mapear `old_invoice_id` ↔ `new_invoice_id` por batch (FK ambos para `sales_invoices.id`, RLS habilitada).
3. **(Opcional) RPC/EF de reemissão atômica** — encapsular void + reemissão + linkagem numa transação server-side, já que PostgREST não suporta BEGIN/SAVEPOINT raw multi-statement do lado do cliente.

Enquanto (1) e (2) não existirem, o único rastreio disponível seria `invoice_audit_log` (colunas reais: `invoice_id`, `action`, `actor_user_id`, `before_state`, `after_state`, `notes`) — insuficiente para batch tracking com linkagem old↔new.

---

## Fluxo pretendido (referência — NÃO executar até desbloqueio)

> As tabelas/colunas/RPCs abaixo que EXISTEM estão marcadas ✅; as que NÃO existem estão marcadas ❌. O desenho assume que a infra faltante já foi criada.

### task_name
`Bulk Reissue Sales Invoices`

### responsible_executor
`admin-specialist` (gate `has_invoice_access()` ✅ — RPC boolean, sem args)

### execution_type
`Agent` — DUPLA confirmation + dry-run preview obrigatório. **Bloqueada até infra existir.**

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `invoice_ids` (array uuid) OU `filter` (`{period_from, period_to, customer_id}`)
  - `reason` (string OBRIGATÓRIO — audit trail)
  - `apply_changes` (`{customer_snapshot_refresh, tax_rate_correction, items_correction}`)

### output (quando desbloqueada)

- **`reissue_batch_id`** (uuid — ❌ depende de `invoice_reissue_batches`)
- **`reissued_count`**, **`old_invoice_ids`**, **`new_invoice_ids`** (❌ linkagem depende de `invoice_reissue_links`)
- **`total_value_reissued`** (soma de `sales_invoices.total` ✅)
- **`verdict`** — `DONE | PARTIAL | BLOCKED`

### action_items (pretendidos)

1. **Auth:** `has_invoice_access()` ✅. Outros → BLOCKED.
2. **Resolver `invoice_ids`** (lista OU filter query em `sales_invoices` ✅, max 100 por batch).
3. **Pre-flight:** todas em `status='issued'` (enum válido ✅; NÃO `draft/voided/paid/refunded`).
4. **Estimate impact:** soma de `sales_invoices.total` ✅ das notas afetadas.
5. **Dry-run preview** (mostra TODAS as mudanças + total afetado).
6. **Aguardar "CONFIRMO REISSUE BATCH"** literal.
7. **Batch operation (BLOQUEADO):** para cada invoice:
   - Void da antiga: `UPDATE sales_invoices SET status='voided', voided_at=NOW(), voided_by=auth.uid(), voided_reason='reissue: '||{reason}` ✅ (colunas reais existem).
   - Reemitir nova: mesmo fluxo de `create-sales-invoice` (`get_next_invoice_number` ✅ + INSERT `sales_invoices`/`sales_invoice_items` ✅ + HTML/PDF client-side ✅).
   - Registrar linkagem old↔new: ❌ `invoice_reissue_links` não existe → **operação não rastreável → task bloqueada**.
8. **Partial failure:** por-invoice (idealmente via RPC/EF transacional server-side ❌, já que PostgREST não faz SAVEPOINT raw).
9. **Regenerar PDF** das novas: via render client-side ✅ (NÃO existe EF `regenerate-invoice-pdfs` ❌).
10. **Audit:** `invoice_audit_log` ✅ por invoice (`action='reissued'`, `before_state`/`after_state`, `notes`).

### acceptance_criteria

- **[A1] Auth `has_invoice_access()`** ✅.
- **[A2] Reason obrigatório** (audit trail).
- **[A3] Max 100 por batch.**
- **[A4] Dry-run preview obrigatório.**
- **[A5] Void via `status='voided'`** ✅ (NUNCA `cancelled`).
- **[A6] Rastreabilidade batch old↔new** ❌ — **BLOQUEADOR**: exige `invoice_reissue_batches` + `invoice_reissue_links`.
- **[A7] Atomicidade por-invoice** ❌ — exige RPC/EF server-side transacional.

---

## Notas

- **Por que blocked_on_infra:** as duas tabelas centrais da feature (`invoice_reissue_batches`, `invoice_reissue_links`) NÃO existem no `types.ts` (2026-07-02). Sem elas, uma reemissão fiscal em massa não é auditável nem reversível com segurança — inaceitável para compliance. Não simular com `activity_logs`/`invoice_audit_log`.
- **Alternativa manual (hoje):** para corrigir 1–poucas notas, usar `create-sales-invoice` (nova emissão) + void manual da antiga (`UPDATE sales_invoices SET status='voided', ...`), uma a uma, registrando em `invoice_audit_log`. Isso NÃO é batch — é operação individual.
- **Void semantics reais:** `status='voided'` + `voided_at`/`voided_by`/`voided_reason` (colunas existem em `sales_invoices` ✅). A nota antiga permanece na tabela (audit/compliance).
- **Numeração das novas:** RPC `get_next_invoice_number(p_company_id, p_year?)` ✅ (advisory lock interno).
- **PDF:** gerado client-side (render HTML → PDF → upload storage) ✅. NÃO existe EF de regeneração em massa.

---

**Mantido por:** admin-specialist

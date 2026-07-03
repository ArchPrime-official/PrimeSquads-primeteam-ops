# Task: bulk-update-opportunities

> Atualizar batch de opportunities (sales_user_id, presales_user_id, pipeline, next_contact_date). Comercial frequentemente atualiza 20+ ao mesmo tempo. Implementa F-02.4.

**✅ SCHEMA GROUNDED (2026-07-03):** colunas reais de `opportunities` — `sales_user_id`/`presales_user_id` (NÃO `owner_id`), sem `priority`, sem `tags` (a tabela não tem coluna tags), sem `customer_name` (nome vem via join com `leads.full_name`). A tabela `opportunity_bulk_batches` **NÃO existe** — não há batch_id persistido em tabela própria; o rastreamento do lote é feito só pelo `activity_logs` (uma entry com a lista de IDs nos `details`) + as rows individuais de `opportunity_history` (sem coluna de linkagem de batch — cada row tem só `opportunity_id`, `field_name`, `old_value`, `new_value`, `changed_by`, `changed_at`). A EF real que este task invoca (`opportunities-bulk-edit`, `supabase/functions/opportunities-bulk-edit/index.ts`) aceita apenas: `stage`, `sales_user_id`, `presales_user_id`, `presales_session_user_id`, `sales_session_date`, `sales_session_status`, `next_contact_date`, `sales_proposal_value`, `presales_status`, `pipeline`, `lost_reason` — e faz **cap de 100** (não 200), checando role via `user_roles` restrito a `['admin', 'comercial', 'owner']` (cs/marketing/financeiro são rejeitados pela própria EF, não só pela task).

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Bulk Update Opportunities`

### responsible_executor
`sales-specialist`

### execution_type
`Agent` — DUPLA confirmation + dry-run preview obrigatório.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `opportunity_ids` (array uuid OR `filter`):
  - `filter` (object opcional): `{stage, campaign_id, sales_user_id, created_after, created_before}`
  - `updates` (object — campos a alterar, restrito ao que a EF `opportunities-bulk-edit` aceita):
    - `sales_user_id`, `presales_user_id`, `presales_session_user_id`, `sales_session_date`, `sales_session_status`, `next_contact_date`, `sales_proposal_value`, `presales_status`, `pipeline`, `lost_reason`
    - `stage` — **PERMITIDO apenas para valores NÃO-terminais** (ver regra de bloqueio abaixo)
  - `reason` (string OBRIGATÓRIO — auditoria)
  - `max_count` (int, default 50, **hard cap 100** — limite real da EF `opportunities-bulk-edit`, não 200)

### output

- **`updated_count`**, **`skipped_count`**, **`failed_count`**
- **`updated_ids`** (array)
- **`verdict`** — `DONE | PARTIAL | BLOCKED`

### action_items

1. **Role check:** comercial/admin/owner. cs/marketing/financeiro → BLOCKED (a própria EF `opportunities-bulk-edit` já rejeita esses roles via `user_roles`, mas a task deve bloquear ANTES de invocar, para dar mensagem clara).
2. **Resolver opp_ids:**
   - Lista direta OR filter query (limit max_count)
   - 0 results → ESCALATE
3. **Validar updates:** at least 1 field, e cada campo do objeto `updates` DEVE pertencer ao conjunto aceito pela EF (ver lista acima) — rejeitar/ignorar campos fantasma (`owner_id`, `priority`, `tags_add`, `tags_remove`, `notes_append`, `customer_name` NÃO existem em `opportunities`).
4. **BLOQUEIO de stage terminal em bulk (recomendado, em vez de condicionar campos extras):** se `updates.stage` ∈ `{SALE_DONE, COMPLETED, LOST}` → **BLOCKED**. A EF `opportunities-bulk-edit` NÃO seta `closed_at` automaticamente, NÃO exige `sales_proposal_value` para SALE_DONE, NÃO valida o guard de produto principal (#4478) e NÃO exige `lost_reason` para LOST — mover uma opp para um stage terminal em massa por essa EF deixaria a opp "fechada" sem os campos obrigatórios de negócio. Para transições terminais, usar `move-opportunity-stage` **uma opp por vez** (essa task já trata `sales_proposal_value`/`lost_reason`/`closed_at` corretamente).
5. **Reason obrigatório:** sem reason → ESCALATE.
6. **Pre-flight check:** filtrar opps que user pode tocar (RLS + join em leads para exibição legível):
   ```sql
   SELECT o.id, o.stage, o.sales_user_id, l.full_name
   FROM opportunities o
   JOIN leads l ON l.id = o.lead_id
   WHERE o.id IN ({ids});
   -- Nota: PostgREST/Supabase client não expõe FOR UPDATE NOWAIT; a EF trata erro por opp individualmente
   -- (loop com try/catch por id), então "concurrent edit" aparece como failed_count, não como skip explícito.
   ```
7. **Dry-run preview:**
   ```
   Bulk update — {N} opportunities

   Razão: {reason}
   Filtro: {filter or 'lista direta'}

   Mudanças:
     {field}: {old} → {new} ({N affected})
     ...

   Sample (10 of {N}):
     [opp_id, lead_full_name, current_stage]
     ...

   Confirma? (digite "CONFIRMO BULK UPDATE" uppercase literal)
   ```
8. **Aguardar "CONFIRMO BULK UPDATE"** literal.
9. **Invoke EF `opportunities-bulk-edit`:**
   ```typescript
   const { data, error } = await supabase.functions.invoke('opportunities-bulk-edit', {
     body: {
       opportunity_ids: ids,
       updates: updates_object, // só campos da lista aceita pela EF
     },
     headers: { Authorization: `Bearer ${jwt}` }
   });
   // opportunities-bulk-update NÃO é alternativa equivalente: é um fluxo de reconciliação
   // CSV por (email, campaign_name), não um update por lista de IDs — não usar aqui.
   // A EF já insere em opportunity_history (field_name/old_value/new_value) por campo alterado.
   ```
10. **Tratar partial:** counts em handoff card (a EF retorna `{success, failed, errors: [{id, reason}]}`).
11. **Activity log:** action='sales-specialist.bulk_update_opportunities', details com a lista de `opportunity_ids` + counts + reason (uma única entry para o batch, gravada pela task — a EF não grava em `activity_logs`).
12. **Echo:**
    ```
    ✓ Bulk update completo
    Updated: {N_ok}/{N_total}
    Failed: {N_failed}
    Reason: {reason}

    Audit: opportunity_history tem uma row por campo alterado por opp (sem batch_id — não existe essa coluna).
    ```

### acceptance_criteria

- **[A1] Role gating:** comercial/admin/owner (alinhado ao check real da EF).
- **[A2] Reason obrigatório.**
- **[A3] Max 100 cap:** limite real da EF `opportunities-bulk-edit` (não 200).
- **[A4] Dry-run preview obrigatório.**
- **[A5] Tripla confirmation:** "CONFIRMO BULK UPDATE" uppercase.
- **[A6] Stage terminal bloqueado em bulk:** SALE_DONE/COMPLETED/LOST só via `move-opportunity-stage` (single-opp), nunca neste bulk.
- **[A7] Campos restritos ao whitelist da EF:** rejeitar `owner_id`/`priority`/`tags_add`/`tags_remove`/`notes_append`/`customer_name` (não existem em `opportunities`).
- **[A8] Activity log:** uma única entry para o batch, gravada pela task (a EF não grava activity_logs).

---

## Exemplos

### Exemplo 1 — Daniel reatribui 23 opps de Sandra→Miriam

**Input:** filter `{sales_user_id=Sandra, stage='NEGOTIATION'}`, updates `{sales_user_id=Miriam}`, reason `'Sandra de licença até 30/05'`

**Specialist:** dry-run mostra 23 opps → "CONFIRMO BULK UPDATE" → 23/23 OK → DONE.

### Exemplo 2 — Sem reason → ESCALATE

```
Bulk update requer 'reason' explícito (audit trail).
Exemplo: "Reatribuição por licença Sandra", "Reset stage de batch importado".
```

### Exemplo 3 — Marketing tenta → BLOCKED

**Input:** Sandra (marketing) → BLOCKED com mensagem.

---

## Notas

- **`opportunities-bulk-update` NÃO é um substituto de `opportunities-bulk-edit`:** é uma EF de reconciliação de CSV (matching por `email`+`campaign_name`, campos como `sales_user_email`/`sales_session_date`), não um update por lista de `opportunity_ids`. Não citar como "alternativa simples" — são fluxos diferentes.
- **`opportunity_history`:** é a própria EF `opportunities-bulk-edit` que insere as rows (não um trigger de banco), uma por campo alterado por opp. Não existe coluna de `batch_id` para linkagem — o agrupamento do lote só existe no `activity_logs` gravado pela task.
- **Role check é feito pela EF via tabela `user_roles`** (`['admin','comercial','owner'].includes(role)`), não por uma função RLS `is_sales_member()` — não citar função inexistente.

---

**Mantido por:** sales-specialist

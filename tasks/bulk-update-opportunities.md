# Task: bulk-update-opportunities

> Atualizar batch de opportunities (stage, owner, product). Comercial frequentemente atualiza 20+ ao mesmo tempo. Implementa F-02.4.

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
  - `filter` (object opcional): `{stage, campaign_id, owner_id, created_after, created_before}`
  - `updates` (object — campos a alterar):
    - `stage`, `owner_id`, `product_id`, `priority`, `tags_add`, `tags_remove`, `notes_append`
  - `reason` (string OBRIGATÓRIO — auditoria)
  - `max_count` (int, default 50, hard cap 200)

### output

- **`batch_id`** (uuid — `opportunity_bulk_batches`)
- **`updated_count`**, **`skipped_count`**, **`failed_count`**
- **`updated_ids`** (array)
- **`verdict`** — `DONE | PARTIAL | BLOCKED`

### action_items

1. **Role check:** comercial/admin/owner. cs/marketing/financeiro → BLOCKED.
2. **Resolver opp_ids:**
   - Lista direta OR filter query (limit max_count)
   - 0 results → ESCALATE
3. **Validar updates:** at least 1 field. Stage values ∈ enum. owner_id existe + has comercial role.
4. **Reason obrigatório:** sem reason → ESCALATE.
5. **Pre-flight check:** filtrar opps que user pode tocar (RLS):
   ```sql
   SELECT id, stage, owner_id, customer_name
   FROM opportunities
   WHERE id IN ({ids}) AND ... (RLS-filtered)
   FOR UPDATE NOWAIT;  -- detect concurrent edits
   ```
6. **Dry-run preview:**
   ```
   Bulk update — {N} opportunities

   Razão: {reason}
   Filtro: {filter or 'lista direta'}

   Mudanças:
     {field}: {old} → {new} ({N affected})
     ...

   Sample (10 of {N}):
     [opp_id, customer_name, current_stage → new_stage]
     ...

   Confirma? (digite "BULK UPDATE" uppercase literal)
   ```
7. **Aguardar "BULK UPDATE"** literal.
8. **Atomic batch com SAVEPOINT por opp:**
   ```sql
   BEGIN;
   INSERT INTO opportunity_bulk_batches (id, reason, requested_by, count, updates_json)
     VALUES (...);

   FOR each opp:
     SAVEPOINT sp_{i};
     UPDATE opportunities SET {updates}, updated_by=auth.uid(), updated_at=NOW()
     WHERE id={id};
     INSERT INTO opportunity_history (opp_id, batch_id, change_type='bulk_update', diff)
       VALUES (...);
     -- error: ROLLBACK TO sp_{i}, log warning, continue
   END LOOP;
   COMMIT;
   ```
9. **Tratar partial:** counts em handoff card.
10. **Activity log:** action='sales-specialist.bulk_update_opportunities', details com batch_id + counts + reason. Single entry para batch (not 50 separate).
11. **Echo:**
    ```
    ✓ Bulk update completo
    Batch ID: {batch_id}
    Updated: {N_ok}/{N_total}
    Skipped (RLS/concurrent): {N_skipped}
    Failed: {N_failed}
    Reason: {reason}

    Audit: opportunity_history rows com batch_id linkagem.
    ```

### acceptance_criteria

- **[A1] Role gating:** comercial/admin/owner.
- **[A2] Reason obrigatório.**
- **[A3] Max 200 cap:** evita storm.
- **[A4] Dry-run preview obrigatório.**
- **[A5] Tripla confirmation:** "BULK UPDATE" uppercase.
- **[A6] Atomic per-opp:** SAVEPOINT permite partial.
- **[A7] Batch entry em activity_logs:** uma única entry para o batch (não 50).
- **[A8] History rows:** cada opp tem opportunity_history row com batch_id linkagem.

---

## Exemplos

### Exemplo 1 — Daniel reatribui 23 opps de Sandra→Miriam

**Input:** filter `{owner_id=Sandra, stage='qualified'}`, updates `{owner_id=Miriam}`, reason `'Sandra de licença até 30/05'`

**Specialist:** dry-run mostra 23 opps → "BULK UPDATE" → 23/23 OK → DONE.

### Exemplo 2 — Sem reason → ESCALATE

```
Bulk update requer 'reason' explícito (audit trail).
Exemplo: "Reatribuição por licença Sandra", "Reset stage de batch importado".
```

### Exemplo 3 — Marketing tenta → BLOCKED

**Input:** Sandra (marketing) → BLOCKED com mensagem.

---

## Notas

- **Edge function `opportunities-bulk-update`:** já existe; pode ser invocada como alternativa para logic complexa.
- **opportunity_history:** trigger AFTER UPDATE existente cria row automática; task adiciona batch_id para linkagem.
- **RLS:** `is_sales_member()` ou similar valida user pode tocar opp; FOR UPDATE NOWAIT detecta concurrent.

---

**Mantido por:** sales-specialist

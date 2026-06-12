# Task: bulk-delete-leads

> Bulk delete leads (cleanup periódico). Admin/owner only — operação destrutiva. Sandra/admin limpam stale/bad leads.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Bulk Delete Leads`

### responsible_executor
`sales-specialist` com gate admin/owner

### execution_type
`Agent` — DUPLA confirmation + dry-run obrigatório.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `lead_ids` (array uuid OR `filter`):
  - `filter` (object): `{status, source, created_before, never_contacted, opted_out}`
  - `reason` (string OBRIGATÓRIO)
  - `cascade` (bool — default false; se true, tenta deletar opportunities relacionadas que sejam apenas qualified/new)

### output

- **`deleted_count`**, **`skipped_count`** (com FK refs)
- **`verdict`** — `DONE | PARTIAL | BLOCKED`

### action_items

1. **Auth gate:** admin/owner only. Outros (comercial/cs) → BLOCKED:
   ```
   Bulk delete de leads é admin/owner only.
   Risco LGPD/GDPR + perda de funil. Sua role: {role}.
   ```
2. **Resolver lead_ids:** lista direta OR filter query (limit max 200).
3. **Reason obrigatório.**
4. **Pre-flight:**
   - Identificar leads com opportunities won (BLOCK delete — preserva history)
   - Identificar leads com opportunities active (warning — perde pipeline visibility)
5. **Dry-run preview:**
   ```
   ⚠️ BULK DELETE leads

   Selecionados: {N}
   Filtro: {filter}

   Skip por FK:
     - {X} com opp won (preservados, history)
     - {Y} com opp active (alerta — pode quebrar pipeline)

   Total a deletar: {Z}

   Sample (10): [name, email, status, created_at]

   {opted_out_count > 0 ? '⚠️ ' + opted_out_count + ' leads com opt_out=true (recommended preserve)' : ''}

   Reason: {reason}
   Continua? (digite "CONFIRMO BULK DELETE LEADS" uppercase literal)
   ```
6. **Aguardar literal.**
7. **Atomic batch DELETE com SAVEPOINT.**
8. **Tratar erros:**
   - 23503 (FK opps active) → log warning, skip
9. **Activity log STRICT** com IDs + counts + reason.
10. **Echo:**
    ```
    ✓ {Z} leads deletados
    Skip: {X+Y} preservados (FK)
    Audit log preserved.
    ```

### acceptance_criteria

- **[A1] Admin/owner only.**
- **[A2] Reason obrigatório.**
- **[A3] Max 200 batch.**
- **[A4] Tripla confirmation:** "CONFIRMO BULK DELETE LEADS" uppercase.
- **[A5] FK protection:** leads com opp won = skip.
- **[A6] Opted_out warning** (preserve por compliance).
- **[A7] Audit STRICT.**

---

**Mantido por:** sales-specialist (com gate admin/owner)

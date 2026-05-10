# Task: create-automation-flow

> Criar novo flow de automação (`automation_flows`) com nodes/edges JSON. Status inicial 'draft' (não ativa). Implementa F-10.1.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Create Automation Flow`

### responsible_executor
`automation-specialist`

### execution_type
`Agent` — confirmation com node validation.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `name` (string, obrigatório, 3..200 chars)
  - `description` (string opcional)
  - `nodes` (array JSONB — `[{id, type, config, position}]`)
  - `edges` (array JSONB — `[{source, target}]`)
  - `trigger_type` (`'webhook' | 'schedule' | 'event' | 'manual'`)
  - `trigger_config` (object — depende do trigger_type)
  - `ai_suggested` (bool, default false — flag se gerado via AI)

### output

- **`flow_id`** (uuid)
- **`status`** (`'draft'`)
- **`nodes_count`**, **`edges_count`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** marketing/comercial/admin/owner.
2. **Validar name** unique em `automation_flows` (per user_id ou global).
3. **Validar nodes:**
   - Min 1 trigger node
   - Cada node: `id` único, `type` ∈ enum (trigger, action_send_email, action_wait, action_branch, etc.)
   - `config` válido per type
4. **Validar edges:**
   - Source/target IDs existem em nodes
   - Sem ciclos (DAG)
   - Trigger node sem incoming edge
5. **Validar trigger_type/config:**
   - webhook: requer endpoint config
   - schedule: cron expression válida
   - event: event_type ∈ enum
6. **Confirmation:**
   ```
   Vou criar automation flow «{name}»:
     Trigger: {trigger_type}
     Nodes: {N} ({trigger_node_type} → ... → {last_action})
     Edges: {N}
     Status inicial: draft (NÃO executa até activate-automation-flow)
     {ai_suggested ? 'Flow gerado via AI — review nodes antes de activate' : ''}
   Confirma?
   ```
7. **INSERT:**
   ```sql
   INSERT INTO automation_flows
     (name, description, nodes, edges, trigger_type, trigger_config,
      status, created_by, ai_suggested)
   VALUES (..., 'draft', auth.uid(), {ai_suggested}) RETURNING id;
   ```
8. **Activity log:** action='automation-specialist.create_automation_flow', details com flow_id + nodes/edges count.
9. **Echo:**
   ```
   ✓ Flow criado (status=draft)
   Flow ID: {flow_id}
   Nodes: {N} | Edges: {N}
   Trigger: {trigger_type}

   Próximos passos:
   1. Validar nodes via UI canvas (visual review recomendado)
   2. Test mode (dry-run sem efeitos)
   3. activate-automation-flow quando pronto
   ```

### acceptance_criteria

- **[A1] Role gating:** marketing/comercial/admin/owner.
- **[A2] DAG validation:** sem ciclos, trigger sem incoming.
- **[A3] Node config validation:** type-specific.
- **[A4] Status starts draft:** zero execução até activate explícito.
- **[A5] Name uniqueness.**
- **[A6] AI flag:** ai_suggested=true permite metric tracking.

---

## Exemplos

### Exemplo 1 — Sandra cria welcome flow

**Input:** `name='Welcome Sequence Q3'`, trigger=event (event_type=lead_created), 5 nodes (email, wait 1d, email, wait 3d, branch).

**Specialist:** valid DAG → confirmation → INSERT → echo com next steps.

### Exemplo 2 — Cycle detectado → BLOCKED

**Input:** edges com `node_a → node_b → node_a`

**Specialist:** BLOCKED:
```
Flow tem ciclo (node_a → node_b → node_a). Flows devem ser DAGs.
Para loops, use action_loop_until com condição clara.
```

---

## Notas

- **Edge `automation-flow-validate`:** lógica complexa de validação fica na edge (Sprint 15).
- **AI assist:** `canvas-flow-ai-generator` edge pode pré-popular nodes; user passa `ai_suggested=true`.
- **Test mode:** Sprint futuro — `test-automation-flow` task com mock data.

---

**Mantido por:** automation-specialist

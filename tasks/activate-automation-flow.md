# Task: activate-automation-flow

> Toggle status de flow para `'active'`. Após ativação, trigger começa a executar. Implementa F-10.1.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Activate Automation Flow`

### responsible_executor
`automation-specialist`

### execution_type
`Agent` — DUPLA confirmation (flow ativo executa ações reais — emails enviados, tasks criadas, etc.).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `flow_id` (uuid)
  - `version` (int — optimistic lock)
  - `confirm_test_passed` (bool — user confirma que testou em dry-run)

### output

- **`flow_id`**, **`new_status`** (`'active'`)
- **`activated_at`**, **`first_eligible_trigger_at`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** authority é creator OR owner (RLS):
   ```sql
   SELECT created_by, status, name, trigger_type FROM automation_flows
   WHERE id={flow_id};
   ```
   Se user.id != created_by AND role != owner → BLOCKED:
   ```
   Apenas o criador do flow OU owner pode ativar.
   Flow criado por: {creator_name}.
   ```
2. **Validar status atual:** MUST=`'draft'` (ou `'paused'`). Outros → ESCALATE.
3. **Validar `confirm_test_passed=true`:** sem isso → ESCALATE com:
   ```
   Recomenda-se testar flow em modo dry-run antes de ativar.
   Se já testou, re-invoque com confirm_test_passed=true.
   Caso contrário, use UI canvas test mode.
   ```
4. **DUPLA confirmation:**

   **Step 1 preview:**
   ```
   Vou ATIVAR flow «{name}»:
     Trigger: {trigger_type} ({config_summary})
     Nodes: {N} ({preview_actions})

   ⚠️ APÓS ATIVAÇÃO:
     - Trigger começa a disparar imediatamente (ou conforme schedule)
     - Ações executam REALMENTE (emails enviados, tasks criadas, etc.)
     - Pause possível via deactivate-automation-flow

   Continuar?
   ```

   **Step 2:** digite "ATIVA FLOW" uppercase literal.
5. **UPDATE atomic com version:**
   ```sql
   UPDATE automation_flows
   SET status='active', activated_at=NOW(), activated_by=auth.uid()
   WHERE id={flow_id} AND version={expected_version}
   RETURNING id, status, activated_at;
   ```
6. **Side-effect (event/webhook trigger):** registra trigger em queue/dispatcher se aplicável (já feito por edge `automation-trigger`).
7. **Activity log:** action='automation-specialist.activate_automation_flow', details com flow_id + nodes count + trigger.
8. **Echo:**
   ```
   ✓ Flow ATIVO
   Flow: {name}
   Status: draft → active
   Trigger: {trigger_type}
   {schedule ? 'Próxima execução: ' + next_at : 'Aguardando trigger event'}

   Monitor via list-automation-flows (filtra status=active).
   Pause se necessário via deactivate-automation-flow.
   ```

### acceptance_criteria

- **[A1] Authority check:** creator ou owner.
- **[A2] Status válido:** draft/paused → active.
- **[A3] Test confirmation:** confirm_test_passed=true required.
- **[A4] Tripla confirmation:** "ATIVA FLOW" uppercase literal.
- **[A5] Version optimistic lock.**
- **[A6] Audit:** activated_at + activated_by registrados.
- **[A7] Reversible:** deactivate-automation-flow reverte para 'paused'.

---

## Exemplos

### Exemplo 1 — Sandra ativa Welcome flow

**Input:** flow_id, version=1, confirm_test_passed=true

**Specialist:** auth ✓, draft → active → "ATIVA FLOW" → DONE.

### Exemplo 2 — Comercial tenta ativar flow de Sandra → BLOCKED

**Input:** Daniel ativa flow created_by=Sandra

**Specialist:** BLOCKED com mensagem clara (apenas creator/owner).

### Exemplo 3 — confirm_test_passed=false → ESCALATE

```
Recomenda-se testar flow em dry-run antes de ativar (ações reais executam).
Se já testou: re-run com confirm_test_passed=true.
```

---

## Notas

- **Authority hierarchy:** owner sempre bypass; admin NÃO bypassa (creator é responsable).
- **Trigger types:**
  - webhook: ativação registra endpoint em router
  - schedule: cron job ativado
  - event: subscriber adicionado a event bus
  - manual: aguarda invoke explícito
- **Side-effects monitoring:** Sprint 15 implementou bloqueio de edição em ative; mudanças requerem deactivate primeiro.

---

**Mantido por:** automation-specialist

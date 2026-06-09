# Task: adjust-schedule-block

> Ajustar o horário e/ou a duração de um BLOCO de execução específico de uma tarefa
> (`task_schedule_blocks`). Permite mover na agenda a fatia certa — não a tarefa
> inteira. Propaga ao Google Calendar automaticamente via trigger.

**Cumpre:** organização correta da agenda no nível de bloco.

---

## Task anatomy

### task_name
`Adjust Schedule Block`

### responsible_executor
`platform-specialist`

### execution_type
`Agent` — validação de ordem cronológica + confirmation.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `block_id` (uuid) — o bloco a ajustar. OU `task_id` + `block_order` para resolvê-lo.
  - `new_scheduled_start` (ISO UTC, opcional) — novo início do bloco
  - `new_duration_minutes` (int, opcional) — nova duração
  - `force` (bool default false) — ignora aviso de colisão/ultrapassar prazo

> Pelo menos um de `new_scheduled_start` / `new_duration_minutes` deve vir.

### output

- **`block_id`**, **`task_id`**, **`new_scheduled_start`**, **`new_duration_minutes`**
- **`due_date_updated`** (bool — se era o último bloco e o prazo foi sincronizado)
- **`google_sync`** (`queued | n/a`)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Resolver o bloco** e a tarefa-mãe (campos reais — ver
   `data/tasks-schedule-blocks-field-reference.md`):
   ```sql
   SELECT b.id, b.task_id, b.scheduled_start, b.duration_minutes, b.block_order,
          t.title, t.due_date, t.can_be_split, t.owner_id
     FROM task_schedule_blocks b
     JOIN tasks t ON t.id = b.task_id
    WHERE b.id = {block_id};
   ```
2. **Authorization:** owner/assigned/admin/owner-role. Senão → BLOCKED (ou delega a
   `request-task-date-change` se a política exigir aprovação).
3. **Reunião não se move:** se `t.can_be_split = false` → BLOCKED (reuniões são fixas).
4. **Validar ordem cronológica** contra os blocos vizinhos da MESMA tarefa:
   ```sql
   SELECT block_order, scheduled_start, duration_minutes
     FROM task_schedule_blocks
    WHERE task_id = {task_id} AND id <> {block_id}
    ORDER BY block_order;
   ```
   - novo início não pode começar antes do fim do bloco `block_order - 1`;
   - fim do bloco (novo início + duração) não pode passar do início do bloco `block_order + 1`.
5. **Régua de prazo:** se `novo_inicio + duração > t.due_date` e NOT `force` →
   ESCALATE avisando que ultrapassa o prazo.
6. **Confirmation:**
   ```
   Ajustar bloco {block_order} de «{title}»:
     Início: {old_start_local} → {new_start_local} (Europe/Rome)
     Duração: {old_dur} → {new_dur}
     {é_ultimo_bloco ? 'Prazo da tarefa será atualizado para o fim deste bloco.' : ''}
   Confirma?
   ```
7. **UPDATE do bloco:**
   ```sql
   UPDATE task_schedule_blocks
      SET scheduled_start = COALESCE({new_scheduled_start}, scheduled_start),
          duration_minutes = COALESCE({new_duration_minutes}, duration_minutes),
          updated_at = now()
    WHERE id = {block_id};
   ```
8. **Sincronizar due_date se for o último bloco** (maior `block_order`):
   ```sql
   UPDATE tasks SET due_date = {fim_do_bloco}, updated_at = now()
    WHERE id = {task_id}
      AND {block_order} = (SELECT max(block_order) FROM task_schedule_blocks WHERE task_id = {task_id});
   ```
9. **Google sync:** automático. O trigger `enqueue_calendar_sync` enfileira o bloco em
   `calendar_sync_outbox`; o `gcal-outbound-worker` atualiza o evento Google do bloco.
   NÃO escrever no Google à mão.
10. **Activity log:** action='platform-specialist.adjust_schedule_block'.
11. **Echo:**
    ```
    ✓ Bloco {block_order} de «{title}» ajustado
    {new_start_local} ({new_dur})
    {due_date_updated ? '✓ Prazo da tarefa sincronizado' : ''}
    ✓ Google Calendar: atualização enfileirada
    ```

### acceptance_criteria

- **[A1]** Ajusta o BLOCO certo (`task_schedule_blocks`), nunca a tarefa inteira.
- **[A2]** Usa colunas REAIS (`scheduled_start`, `duration_minutes`, `block_order`).
- **[A3]** Valida ordem cronológica contra blocos vizinhos.
- **[A4]** Bloqueia ajuste de reunião (`can_be_split=false`).
- **[A5]** Sincroniza `due_date` quando ajusta o último bloco.
- **[A6]** Não escreve no Google à mão — deixa o trigger propagar.
- **[A7]** Audit.

---

## Notas

- Para mover uma tarefa SEM blocos, use `update-task` ajustando `scheduled_start_time`.
- Para redistribuir TODOS os blocos de uma tarefa, dispare o auto-scheduling (não
  recalcule horários à mão) — ver `data/tasks-schedule-blocks-field-reference.md` §4.4.
- Schema e operações completas: `data/tasks-schedule-blocks-field-reference.md`.

---

**Mantido por:** platform-specialist

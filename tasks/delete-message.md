# Task: delete-message

> Soft delete mensagem em canal (`is_deleted=true`, content limpo). Creator OR channel admin OR owner.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Delete Channel Message`

### responsible_executor `platform-specialist`

### execution_type `Agent` — confirmation simples.

### input
- `message_id` (uuid)
- `reason` (string opcional, recomendado se admin deletando msg de outro)

### output
- `message_id`, `deleted_at`
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Authority:**
   - User é `created_by` (pode deletar próprias)
   - User é `channel_admin` (pode deletar qualquer no canal)
   - User é `owner` (override)
2. Resolver msg + verificar autoria.
3. Confirmation:
   ```
   Delete mensagem:
     Sender: {sender_name}
     Content: «{first 200 chars}»
     Sent: {time_ago}
     {non_creator ? 'Você está deletando msg de outro user (channel admin/owner)' : ''}
     {reason ? 'Reason: ' + reason : ''}
   Confirma?
   ```
4. **Soft delete:**
   ```sql
   UPDATE channel_messages
   SET is_deleted=true, content='[deleted]', deleted_at=NOW(),
       deleted_by=auth.uid(), deletion_reason={reason}
   WHERE id={message_id};
   ```
5. **Cascade:** se mensagem é parent thread, threads filhas continuam visíveis (não deletam recursivo).
6. Activity log: action='platform-specialist.delete_message', details com sender_id + deleted_by + reason.
7. Echo: "✓ Mensagem soft-deletada. UI mostra '[deleted]'. Audit preserva content original em deletion logs."

### acceptance_criteria
- A1 Authority creator/channel_admin/owner
- A2 Soft delete preserva audit
- A3 Reason recomendado se non-creator
- A4 Thread integrity (filhas preservadas)
- A5 Audit log

---

**Mantido por:** platform-specialist

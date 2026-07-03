# Task: delete-message

> Soft delete mensagem em canal (`deleted_at` preenchido). Creator OR channel admin OR owner.

**⚠️ SCHEMA REAL (types.ts, 2026-07-03):** `channel_messages` tem apenas `deleted_at timestamptz` para soft delete — **não existem** `is_deleted`, `deleted_by`, `deletion_reason`. Autoria via `user_id` (não `created_by`).

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
   - User é `user_id` da mensagem (pode deletar próprias)
   - User é `channel_admin` (`channel_members.role='admin'` no canal — pode deletar qualquer msg do canal)
   - User é `owner` (override)
2. Resolver msg + verificar autoria (`user_id`).
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
4. **Gravar o content original no activity_log ANTES de sobrescrever** (é a única cópia de auditoria disponível — não existe `deletion_reason`/`deleted_by` na própria tabela):
   ```sql
   -- 1) capturar content original para o log ANTES do UPDATE
   SELECT content, user_id FROM channel_messages WHERE id = {message_id};
   -- 2) activity_log com o content capturado (ver passo 7)
   ```
5. **Soft delete (colunas reais — sem `is_deleted`/`deleted_by`/`deletion_reason`):**
   ```sql
   UPDATE channel_messages
   SET content = '[deleted]', deleted_at = NOW()
   WHERE id = {message_id};
   ```
6. **Cascade:** se mensagem é parent thread, threads filhas continuam visíveis (não deletam recursivo).
7. Activity log: action='platform-specialist.delete_message', details com `sender_user_id` + `deleted_by=auth.uid()` + `reason` + **content original capturado no passo 4** (a coluna da tabela é sobrescrita, então o audit trail vive só no activity_log).
8. Echo: "✓ Mensagem soft-deletada (deleted_at preenchido). UI mostra '[deleted]'. Content original preservado no activity_log."

### acceptance_criteria
- A1 Authority: `user_id`/channel_admin (`channel_members.role='admin'`)/owner
- A2 Soft delete via `deleted_at` (sem `is_deleted`/`deleted_by`/`deletion_reason` — não existem na tabela); content original só sobrevive no activity_log
- A3 Reason recomendado se non-creator
- A4 Thread integrity (filhas preservadas)
- A5 Audit log com content capturado ANTES do UPDATE

---

**Mantido por:** platform-specialist

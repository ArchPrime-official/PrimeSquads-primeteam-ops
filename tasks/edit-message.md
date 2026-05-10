# Task: edit-message

> Editar mensagem própria em canal interno. Apenas creator pode editar (RLS). Mantém edit history.

**✅ SCHEMA ADAPTED (2026-05-10):** Tabela `channel_message_edits` NÃO existe — adaptado para usar coluna JSONB `edit_history` em `channel_messages` (acrescentar entry per edit). Approach mais leve sem migration nova.

**Mutation adaptada:**
```sql
UPDATE channel_messages
SET content={new_content},
    edited_at=NOW(),
    edit_count=COALESCE(edit_count,0)+1,
    edit_history=COALESCE(edit_history,'[]'::jsonb) ||
                 jsonb_build_object(
                   'old_content', content,
                   'edited_at', NOW(),
                   'edited_by', auth.uid()
                 )
WHERE id={message_id} AND created_by=auth.uid() AND version={expected};
```

**Migration mínima requerida (futura):**
```sql
ALTER TABLE channel_messages
ADD COLUMN IF NOT EXISTS edit_count int DEFAULT 0,
ADD COLUMN IF NOT EXISTS edited_at timestamptz,
ADD COLUMN IF NOT EXISTS edit_history jsonb;
```

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Edit Channel Message`

### responsible_executor `platform-specialist`

### execution_type `Agent` — confirmation simples (skip se changes mínimos).

### input
- `message_id` (uuid)
- `new_content` (string, 1..5000 chars)
- `version` (int — optimistic lock)

### output
- `message_id`, `edited_at`, `edit_count`
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Authority:** user MUST be `created_by` da mensagem. Outros → BLOCKED:
   ```
   Apenas o autor pode editar mensagem.
   Sender original: {sender_name}.
   ```
2. **Time window check:** mensagens > 24h não editáveis (UI-policy padrão Slack-like). Se > 24h → ESCALATE com warning:
   ```
   Mensagem de {time_ago}. Edição típica é em janela 24h.
   Para corrigir histórico antigo: delete + new message.
   ```
3. Validar `new_content` 1..5000 chars + diff vs original.
4. UPDATE atomic version lock:
   ```sql
   UPDATE channel_messages
   SET content={new_content},
       edited_at=NOW(),
       edit_count=edit_count+1
   WHERE id={message_id} AND created_by=auth.uid() AND version={expected};
   ```
5. INSERT em `channel_message_edits` (history):
   ```sql
   INSERT INTO channel_message_edits (message_id, old_content, new_content, edited_at, edited_by)
   VALUES (...);
   ```
6. Activity log skip (mensagens triviais geram spam).
7. Echo: "✓ Mensagem editada. {warning_24h ? '' : ''}"

### acceptance_criteria
- A1 Authority creator only
- A2 24h window default
- A3 Edit history preserved
- A4 Edit count increment
- A5 Optimistic lock

---

**Mantido por:** platform-specialist

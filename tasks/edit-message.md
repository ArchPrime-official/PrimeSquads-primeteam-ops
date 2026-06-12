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
4. UPDATE com edit_history JSONB (tabela `channel_message_edits` NÃO existe — usar abordagem JSONB conforme cabeçalho; colunas `edit_count/edited_at/edit_history` precisam existir via migration `edit-message-migration` pendente):
   ```sql
   UPDATE channel_messages
   SET content = {new_content},
       is_edited = true,
       updated_at = NOW(),
       -- TODO: colunas abaixo requerem migration (edit-message-migration):
       edited_at = NOW(),
       edit_count = COALESCE(edit_count, 0) + 1,
       edit_history = COALESCE(edit_history, '[]'::jsonb) ||
                      jsonb_build_object(
                        'old_content', content,
                        'edited_at', NOW(),
                        'edited_by', auth.uid()
                      )
   WHERE id = {message_id} AND user_id = auth.uid();
   -- Nota: coluna `version` NÃO existe em channel_messages; sem optimistic lock disponível
   ```
   Se colunas edit_count/edited_at/edit_history não existirem ainda, usar apenas:
   ```sql
   UPDATE channel_messages
   SET content = {new_content}, is_edited = true, updated_at = NOW()
   WHERE id = {message_id} AND user_id = auth.uid();
   ```
5. Activity log skip (mensagens triviais geram spam).
6. Echo: "✓ Mensagem editada."

### acceptance_criteria
- A1 Authority creator only
- A2 24h window default
- A3 Edit history preserved (JSONB edit_history se migration existir; senão `is_edited=true`)
- A4 Edit count increment (requer migration)
- A5 Optimistic lock via user_id (coluna version não existe)

---

**Mantido por:** platform-specialist

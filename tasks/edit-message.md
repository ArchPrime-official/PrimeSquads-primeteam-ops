# Task: edit-message

> Editar mensagem própria em canal interno. Apenas creator pode editar (RLS). Mantém edit history.

**⚠️ SCHEMA REAL (confirmado em types.ts, 2026-07-03):** `channel_messages` tem `content`, `created_at`, `deleted_at`, `id`, `is_edited`, `reply_to_id`, `thread_*`, `updated_at`, `user_id`. **Não existem** `channel_message_edits`, `edit_count`, `edited_at`, `edit_history` nem `version`. Autoria é sempre por `user_id` (não `created_by`). Sem essas colunas, hoje só é possível persistir `content` + `is_edited=true` + `updated_at` — histórico de edição/contagem de edits e optimistic lock por `version` **não existem** e não devem ser prometidos até uma migration real criar essas colunas.

**Mutation real (sem migration pendente):**
```sql
UPDATE channel_messages
SET content = {new_content},
    is_edited = true,
    updated_at = NOW()
WHERE id = {message_id} AND user_id = auth.uid();
```

**Migration mínima requerida (futura, se quisermos histórico de edição):**
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

### output
- `message_id`, `updated_at`, `is_edited`
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Authority:** user MUST be `user_id` da mensagem (não `created_by` — coluna não existe). Outros → BLOCKED:
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
4. **UPDATE (única forma suportada pelo schema atual):**
   ```sql
   UPDATE channel_messages
   SET content = {new_content}, is_edited = true, updated_at = NOW()
   WHERE id = {message_id} AND user_id = auth.uid();
   ```
   Sem `edit_count`/`edited_at`/`edit_history`/`version` — essas colunas não existem hoje (ver migration futura no cabeçalho). 0 rows afetadas = mensagem não pertence ao usuário → BLOCKED.
5. Activity log skip (mensagens triviais geram spam).
6. Echo: "✓ Mensagem editada."

### acceptance_criteria
- A1 Authority: apenas `user_id = auth.uid()` (creator only)
- A2 24h window default
- A3 Sinaliza edição via `is_edited=true` (sem histórico de conteúdo anterior — `edit_history` não existe)
- A4 Sem contagem de edits (`edit_count` requer migration futura, não prometida hoje)
- A5 Sem optimistic lock (coluna `version` não existe em `channel_messages`) — autoria via `user_id` é controle de acesso, não controle de concorrência

---

**Mantido por:** platform-specialist

# Task: send-message

> Enviar mensagem em canal interno (channel_messages). Operação MAIS frequente do time. Implementa F-07.1.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Send Channel Message`

### responsible_executor
`platform-specialist`

### execution_type
`Agent` — confirmation simples (single ack se message não-trivial).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `channel_id` (uuid) OR `channel_name` (resolver)
  - `content` (string, 1..5000 chars, markdown supported)
  - `mentions` (array uuid users, opcional)
  - `thread_parent_id` (uuid opcional — reply em thread)
  - `attachments` (array URLs/refs opcional)

### output

- **`message_id`** (uuid)
- **`channel_id`**, **`thread_parent_id`** (echo)
- **`mentioned_users`** (array)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** any authenticated user (todos podem enviar em canais que são membros).
2. **Resolver channel:**
   ```sql
   SELECT id, name, is_archived FROM internal_channels WHERE id={channel_id} OR name={channel_name};
   ```
   Archived → BLOCKED.
3. **Verificar membership:**
   ```sql
   SELECT 1 FROM channel_members WHERE channel_id={id} AND user_id=auth.uid();
   ```
   Não-member → BLOCKED com:
   ```
   Você não é membro do canal #{channel_name}.
   Peça ao admin para adicionar via add-channel-member.
   ```
4. **Validar content:** 1..5000 chars, sem only-whitespace.
5. **Resolver mentions:** validar user_ids existem + são membros do canal (opcional warn se não-membro).
6. **Validar thread_parent_id:** se passado, MUST belong to same channel + thread_parent_id IS NULL no parent (no nested threads).
7. **Skip confirmation se short message** (< 200 chars + sem mentions). Senão preview:
   ```
   Send em #{channel_name}:
     {thread_parent_id ? 'Reply em thread: ' + parent_summary : 'Nova mensagem'}
     Conteúdo: «{first 200 chars + ...}»
     Mentions: {N} users ({names})
     {attachments ? attachments.length + ' attachments' : ''}
   Confirma?
   ```
8. **INSERT:**
   ```sql
   INSERT INTO channel_messages
     (channel_id, content, sender_id, mentions, thread_parent_id, attachments)
   VALUES ({id}, {content}, auth.uid(), {mentions_jsonb}, {thread_parent_id}, {attachments_jsonb})
   RETURNING id;
   ```
9. **Side-effects (não-blocking):**
   - Notification edge para mentioned users (push/email se preferences)
   - Update channel.last_message_at
10. **Activity log** (skip se mensagem trivial — evitar log spam):
    - INSERT em `activity_logs` SE: mentions count > 5 OR message contém comando `@all` OR thread em mensagem >7 dias.
11. **Echo:**
    ```
    ✓ Mensagem enviada em #{channel_name}
    Message ID: {id}
    {mentions ? mentions.length + ' usuários mencionados (notificados)' : ''}
    ```

### acceptance_criteria

- **[A1] Membership check** antes de send.
- **[A2] Archived channel = BLOCKED.**
- **[A3] Content validation** 1..5000 chars.
- **[A4] Thread integrity** (parent existe, no nested).
- **[A5] Mention validation:** users existem.
- **[A6] Skip confirmation** para mensagens curtas (UX).
- **[A7] Activity log selectivo:** evita spam log para mensagens triviais.
- **[A8] Notification side-effect** non-blocking (mentions).

---

## Exemplos

### Exemplo 1 — Quick message em canal que é membro

**Input:** `channel_name='#dev-ops'`, `content='Deploy ok'`

**Specialist:** member ✓, < 200 chars → SKIP confirmation → INSERT → DONE.

### Exemplo 2 — Mensagem com mentions e attachment

**Input:** content longo + `mentions=[Sandra, Pablo]` + 2 attachments

**Specialist:** confirmation preview shown → "sim" → INSERT → notifications → DONE.

### Exemplo 3 — Não-member tenta send → BLOCKED

**Input:** Daniel tenta enviar em #finance (não é member)

**Specialist:** BLOCKED:
```
Você não é membro de #finance.
Peça à Joyce/Larissa (admins do canal) para adicionar via add-channel-member.
```

---

## Notas

- **Membership obrigatório:** RLS em channel_messages enforces.
- **Thread integrity:** memory mention de thread bug fix (2026-04-22 Phase 0): thread_parent_id IS NULL no parent.
- **Notification preferences:** edge respeita push_notification_preferences per user.
- **Markdown:** content suporta markdown (rendered no frontend).

---

**Mantido por:** platform-specialist

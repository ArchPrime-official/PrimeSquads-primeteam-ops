# Task: create-channel

> Criar canal de comunicação interna + membership inicial. Admin/owner only (estrutura organizacional). Implementa F-07.1.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Create Channel`

### responsible_executor
`platform-specialist` com gate admin/owner

### execution_type
`Agent` — confirmation com preview de membership.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `name` (string, kebab-case, 3..50 chars, sem espaços)
  - `description` (string opcional)
  - `is_private` (bool, default false)
  - `member_ids` (array uuid — initial membership)
  - `topic` (string opcional)

### output

- **`channel_id`** (uuid)
- **`members_added`** (count)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** admin/owner only.
2. **Validar name:**
   - Regex `^[a-z][a-z0-9-]{2,49}$` (kebab-case, lowercase)
   - Uniqueness em channels
3. **Validar member_ids:** todos existem em profiles + active.
4. **Confirmation:**
   ```
   Criar canal #{name}:
     Description: {description or '(sem descrição)'}
     Private: {is_private}
     Members iniciais: {N}
       [list 10 names + count se > 10]
     Topic: {topic or '(sem topic)'}
   Confirma?
   ```
5. **Atomic INSERT:**
   ```sql
   BEGIN;
   INSERT INTO internal_channels (name, description, is_private, topic, created_by)
   VALUES ({name}, {description}, {is_private}, {topic}, auth.uid())
   RETURNING id;

   INSERT INTO channel_members (channel_id, user_id, role, added_by)
   SELECT {channel_id}, unnest({member_ids}), 'member', auth.uid();
   COMMIT;
   ```
6. **Activity log:** action='platform-specialist.create_channel', details com channel_id + members_count.
7. **Echo:**
   ```
   ✓ Canal #{name} criado
   ID: {channel_id}
   Members: {N} adicionados
   {is_private ? 'Privado — só members veem' : 'Público — visível na listagem'}
   Próximos passos: send-message para introduzir o canal.
   ```

### acceptance_criteria

- **[A1] Admin/owner only.**
- **[A2] Name kebab-case + uniqueness.**
- **[A3] Atomic membership creation.**
- **[A4] Members existem + active.**
- **[A5] Audit channel_id + members.**

---

## Exemplos

### Exemplo 1 — Pablo cria canal #lancio-maggio

**Input:** name='lancio-maggio', members=[Sandra, Andrea, Jessica, Pablo], description='Coordenação Lancio Maggio'

**Specialist:** validate ✓, confirmation → atomic INSERT → DONE.

### Exemplo 2 — Marketing tenta criar → BLOCKED

**Input:** Sandra (marketing) → BLOCKED com mensagem.

---

**Mantido por:** platform-specialist

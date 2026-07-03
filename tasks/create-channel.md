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
  - `name` (string, 3..50 chars — nome de exibição do canal, ex: "Lancio Maggio")
  - `slug` (string, **obrigatório** — NOT NULL em `internal_channels`; derivar de `name` se omitido: kebab-case `^[a-z][a-z0-9-]{2,49}$`, UNIQUE)
  - `description` (string opcional)
  - `emoji` (string opcional — ícone do canal)
  - `is_private` (bool, default false)
  - `member_ids` (array uuid — initial membership)

> **`topic` não existe** em `internal_channels` — removido do input/INSERT.
> **`is_dm` não é exposto por esta task.** Esta task cria canais de equipe (`is_dm=false`, default). Criação de DM (1:1) deve usar um fluxo próprio, não este.

### output

- **`channel_id`** (uuid)
- **`members_added`** (count)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** admin/owner only.
2. **Validar slug:**
   - Regex `^[a-z][a-z0-9-]{2,49}$` (kebab-case, lowercase) — derivar de `name` se omitido
   - Uniqueness em `internal_channels.slug`
3. **Validar member_ids:** todos existem em profiles + active.
4. **Confirmation:**
   ```
   Criar canal #{name} ({slug}):
     Description: {description or '(sem descrição)'}
     Private: {is_private}
     Members iniciais: {N}
       [list 10 names + count se > 10]
   Confirma?
   ```
5. **Atomic INSERT:**
   ```sql
   BEGIN;
   INSERT INTO internal_channels (name, slug, description, emoji, is_private, created_by)
   VALUES ({name}, {slug}, {description}, {emoji}, {is_private}, auth.uid())
   RETURNING id;

   -- channel_members NÃO tem coluna added_by
   INSERT INTO channel_members (channel_id, user_id, role)
   SELECT {channel_id}, unnest({member_ids}), 'member';
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
- **[A2] Slug kebab-case + uniqueness (NOT NULL em `internal_channels`).**
- **[A3] Atomic membership creation.**
- **[A4] Members existem + active.**
- **[A5] Audit channel_id + members.**

---

## Exemplos

### Exemplo 1 — Pablo cria canal #lancio-maggio

**Input:** name='Lancio Maggio', slug='lancio-maggio', members=[Sandra, Andrea, Jessica, Pablo], description='Coordenação Lancio Maggio'

**Specialist:** validate ✓, confirmation → atomic INSERT → DONE.

### Exemplo 2 — Marketing tenta criar → BLOCKED

**Input:** Sandra (marketing) → BLOCKED com mensagem.

---

## Notas

- **NOT NULL reais em `internal_channels`:** `name`, `slug`. `topic` não é coluna da tabela (removido nesta correção). `is_private`/`is_dm` são nullable com default (`is_private` tratado como `false` de negócio; `is_dm` fica `false`/não exposto por esta task).
- **`channel_members`:** colunas reais são `channel_id`, `id`, `joined_at`, `last_read_at`, `last_read_message_id`, `role`, `user_id` — **não existe `added_by`**.

---

**Mantido por:** platform-specialist

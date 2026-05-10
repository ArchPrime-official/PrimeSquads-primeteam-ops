# Task: request-role-change

> Task atômica para criar uma row em `role_requests` quando user **não-owner** quer ascender para roles restritos (`admin`, `financeiro`, `owner`). Implementa **FR5** do PRD (`docs/prd-v2/modules/01-auth.md`). Output: REQUEST_CREATED com approver implícito = qualquer owner.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy

### task_name
`Request Role Change`

### status
`pending`

### responsible_executor
`admin-specialist` (read-only check) → `platform-specialist` (INSERT)

> NOTA: admin-specialist é owner-only. Como esta task é executada por NÃO-owners,
> o handler real é `platform-specialist` com escopo restrito a `role_requests`
> (não `user_roles` direto). Quem aprova depois roda `approve-role-request`
> via admin-specialist.

### execution_type
`Agent` — confirmation step OBRIGATÓRIO. Echo educacional sobre quem aprova.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `requested_role` (`'admin' | 'financeiro' | 'owner'`, obrigatório)
  - `reason` (string, RECOMENDADO — owner vai ler antes de aprovar)

### output

- **`request_id`** — uuid da row em `role_requests`
- **`user_id`** — auth.uid() (echo)
- **`requested_role`** (echoed)
- **`status`** — sempre `'pending'`
- **`verdict`** — `REQUEST_CREATED` | `BLOCKED` | `ESCALATE`
- **`convention_check`** — RLS ✓ / no_self_grant ✓ / audit_logged ✓

### action_items

1. **PRE-CHECK 1 — restricted role enforcement:**
   - Roles **NÃO-restritas** (`comercial`, `cs`, `marketing`) → ESCALATE com `redirect_to: admin-specialist.grant_role`. Owners atribuem direto, sem workflow.
   - Roles restritas (`admin`, `financeiro`, `owner`) → continuar.
   - Outros valores → ESCALATE com lista de roles válidas.

2. **PRE-CHECK 2 — user já tem a role:**
   ```sql
   SELECT 1 FROM user_roles
   WHERE user_id = auth.uid() AND role = {requested_role}
   LIMIT 1;
   ```
   Se já tem → ESCALATE com `already_has_role`.

3. **PRE-CHECK 3 — user é owner:**
   ```sql
   SELECT is_owner(auth.uid()) AS is_owner;
   ```
   Se TRUE → ESCALATE com `redirect_to: admin-specialist.grant_role` (owner não usa request workflow — atribui direto via grant_role).

4. **PRE-CHECK 4 — duplicate pending request:**
   ```sql
   SELECT id FROM role_requests
   WHERE user_id = auth.uid()
     AND requested_role = {requested_role}
     AND status = 'pending'
   LIMIT 1;
   ```
   Se existe → ESCALATE com `duplicate_pending_request` + request_id existente.

5. **Confirmation message** apresentada via chief:
   ```
   Você quer pedir a role «{requested_role}».

   Capabilities que você ganhará se aprovado:
     {list_capabilities_for_role}

   Quem aprova: qualquer **owner** da plataforma.
   Razão (será lida pelo owner): {reason or "(não informada — recomendo escrever uma justificativa)"}

   Confirma envio do pedido?
   ```

6. **Aguardar "sim"** — se "não", ESCALATE com `cancelled_by_user`.

7. **INSERT request:**
   ```sql
   INSERT INTO role_requests
     (user_id, requested_role, reason, status)
   VALUES
     (auth.uid(), {requested_role}, {reason}, 'pending')
   RETURNING id, created_at;
   ```

8. **Tratar erros:**
   - 42501 (RLS) → BLOCKED
   - 23502 (NOT NULL: requested_role) → BLOCKED
   - 23514 (CHECK: requested_role enum) → BLOCKED com lista válida
   - 5xx → retry 1x → ESCALATE

9. **Activity log:**
   - `action='platform-specialist.request_role_change'`
   - `resource_type='role_request'`
   - `resource_id={request_id}`
   - `details={requested_role, reason, current_roles}`

10. **Echo final:**
    ```
    Pedido enviado ✓
    Request ID: {request_id}

    Aguardando aprovação de qualquer **owner**.

    O que acontece quando aprovado:
    - Você ganhará a role «{requested_role}» imediatamente
    - Activity log registra quem aprovou + quando
    - Você poderá usar capabilities desta role na próxima sessão (logout/login pode ser necessário se token cached)
    ```

### acceptance_criteria

- **[A1] Restricted role only:** task SÓ roda para roles `admin`/`financeiro`/`owner`. Não-restritas redirecionadas para grant_role direto.
- **[A2] No self-grant:** owners não usam esta task (têm permissão direta via admin-specialist). Pre-check 3 redireciona.
- **[A3] No duplicate:** se pending request existe pra mesma combo (user, role), ESCALATE em vez de criar.
- **[A4] No bypass:** mutation só toca `role_requests`. NUNCA INSERT em `user_roles` (essa permissão é owner-only via grant_role).
- **[A5] Confirmation OBRIGATÓRIO:** user vê capabilities + reason antes de INSERT.
- **[A6] Audit trail:** activity_logs tem entry com cycle_id + details.
- **[A7] Echo educacional:** user entende QUEM aprova + O QUE acontece quando aprovado + se precisa relogar.
- **[A8] Status default 'pending':** schema default. Não setar manualmente.

---

## Exemplos

### Exemplo 1 — Comercial pede admin (REQUEST_CREATED)

**Input:** user role=comercial pede `requested_role='admin'`, `reason='preciso gerenciar campanhas e leads em escala'`

**Specialist:**
1. Restricted role ✓ (admin é restrita)
2. User não tem admin ✓
3. User não é owner ✓
4. Sem pending duplicate ✓
5. Confirmation:
   ```
   Você quer pedir a role «admin».
   Capabilities que você ganhará: gerenciar users (exceto financeiro/owner),
     ver activity log, atribuir comercial/cs/marketing roles, ...
   Quem aprova: qualquer owner.
   Razão: preciso gerenciar campanhas e leads em escala
   Confirma?
   ```
6. User: "sim"
7. INSERT → request_id `5e2f-...`
8. Activity log
9. Echo:
   ```
   Pedido enviado ✓ Request ID: 5e2f-...
   Aguardando aprovação de qualquer owner.
   ```

### Exemplo 2 — User já é owner (ESCALATE redirect)

**Input:** owner pede `requested_role='financeiro'`

**Specialist:** Pre-check 3 detecta is_owner → ESCALATE:
```
Owners atribuem roles direto via admin-specialist.grant_role —
não há workflow de approval. Use: pto admin grant-role financeiro {target_user}
```

### Exemplo 3 — Role não-restrita (ESCALATE redirect)

**Input:** user pede `requested_role='cs'`

**Specialist:** Pre-check 1 → ESCALATE:
```
Role 'cs' não exige approval workflow — qualquer owner/admin pode atribuir
direto. Peça ao admin do seu setor para grant-role cs.
```

### Exemplo 4 — Pending duplicate (ESCALATE)

**Input:** user já tem request pending para admin (request_id 3a1c-...)

**Specialist:** Pre-check 4 → ESCALATE:
```
Você já tem um pedido pendente para 'admin' (request_id 3a1c-... criado
em 2026-05-08). Aguarde resposta ou contate um owner para acelerar.
```

---

## Notas

- **FR5 source:** PRD `docs/prd-v2/modules/01-auth.md` seção FR5 + memory `rls-public-tables-checklist.md` (PR #1282).
- **`approver_id` schema:** `role_requests` tabela NÃO tem coluna `approver_id` específica (qualquer owner pode aprovar). Quem aprovar fica em `reviewed_by` após approve.
- **Capabilities reference:** ao mostrar capabilities, consultar tabela:
  - `admin`: gerenciar users (exceto financeiro/owner), activity log, atribuir comercial/cs/marketing
  - `financeiro`: full access ao módulo Finance (transactions, recurring, invoices, balances)
  - `owner`: full platform access + can grant any role + admin-specialist permissions
- **Notification side-effect (Sprint futuro):** integration-specialist pode notificar owners via WhatsApp quando nova role_request chega.

---

**Mantido por:** platform-specialist (com handoff para admin-specialist em approve)

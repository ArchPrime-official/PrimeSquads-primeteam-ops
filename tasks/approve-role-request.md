# Task: approve-role-request

> Task atômica para **owner** aprovar ou rejeitar uma `role_requests` pendente. Aprovação dispara: INSERT user_roles + UPDATE request (status='approved'). Rejeição só atualiza request. Implementa **FR5** do PRD.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy

### task_name
`Approve Role Request`

### status
`pending`

### responsible_executor
`admin-specialist` (owner-only — gate primário do agent)

### execution_type
`Agent` — confirmation step OBRIGATÓRIO (DUPLA confirmation, padrão admin-specialist).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `request_id` (uuid, obrigatório — OU resolver via user_id+role se único pending)
  - `decision` (`'approve' | 'reject'`, obrigatório)
  - `response_message` (string, opcional — explicação se reject)

### output

- **`request_id`**, **`user_id`** (target), **`requested_role`**
- **`decision`** (echoed)
- **`user_roles_id`** — uuid da nova row em user_roles (se approve)
- **`verdict`** — `APPROVED` | `REJECTED` | `BLOCKED` | `ESCALATE`
- **`convention_check`** — RLS ✓ / owner_only ✓ / audit_logged ✓ / dupla_confirmation ✓

### action_items

1. **OWNER-ONLY GATE** — primário do admin-specialist:
   ```sql
   SELECT is_owner(auth.uid()) AS is_owner;
   ```
   Se FALSE → BLOCKED:
   ```
   Aprovação de role requests é OWNER-ONLY. Sua role atual: {role}.
   Apenas owners podem aprovar/rejeitar. Peça ao Pablo (owner).
   ```

2. **Resolver request:**
   ```sql
   SELECT r.id, r.user_id, r.requested_role, r.reason, r.status,
          r.created_at,
          p.full_name AS target_name, p.email AS target_email,
          (SELECT array_agg(role) FROM user_roles WHERE user_id = r.user_id) AS current_roles
   FROM role_requests r
   JOIN profiles p ON p.id = r.user_id
   WHERE r.id = {request_id};
   ```
   0 ou >1 match → ESCALATE.

3. **Validar status:**
   - SE `status != 'pending'` → BLOCKED:
     ```
     Este pedido já foi {status} (em {reviewed_at} por {reviewer_name}).
     Não pode ser re-processado.
     ```

4. **Validar decision** — `decision` ∈ `('approve', 'reject')`. Outros → ESCALATE.

5. **Validar role enum** (defensivo, schema já valida):
   - `requested_role` ∈ `('admin', 'financeiro', 'owner')`
   - Outros valores → BLOCKED indicando schema corruption (não deveria ter passado em request-role-change).

6. **Edge case — approve para 'owner' role:**
   Se `requested_role = 'owner'` AND `decision = 'approve'`:
   - Echo warning extra: "Atenção: você está promovendo {target_name} para OWNER. Isto dá acesso TOTAL à plataforma — gerenciar finance, atribuir/remover qualquer role, deactivate users. Reversível mas requer cuidado."
   - Confirmation tripla: "Digite 'CONFIRMO OWNER' literal para prosseguir."

7. **Edge case — approve para user já com role:**
   ```sql
   SELECT 1 FROM user_roles
   WHERE user_id = {request.user_id} AND role = {request.requested_role}
   LIMIT 1;
   ```
   Se já tem (race condition desde request) → BLOCKED com `target_already_has_role`. UPDATE request.status='approved' mesmo assim para fechar.

8. **Confirmation message** (dupla, padrão admin-specialist):

   **Step 1 preview:**
   ```
   Pedido de {target_name} ({target_email}):
     Role atual: {current_roles}
     Quer ganhar: «{requested_role}»
     Razão: {reason or "(não informada)"}
     Pedido criado em: {created_at}

   Decisão: {APPROVE | REJECT}
   {response_message echoed se reject}

   Capabilities que vão {ser GANHAS / NÃO ser concedidas}:
     {list_capabilities}

   Continuar?
   ```

   **Step 2 confirmation literal:**
   - approve normal: digite "confirma"
   - approve owner: digite "CONFIRMO OWNER" (uppercase)
   - reject: digite "confirma"

   Qualquer outro input → ESCALATE com `cancelled_by_user`.

9. **Se APPROVE — 2 mutations sequenciais:**

   9a. **INSERT user_roles** (race-safe via UNIQUE constraint):
   ```sql
   INSERT INTO user_roles (user_id, role, assigned_by, assigned_at)
   VALUES ({request.user_id}, {request.requested_role}, auth.uid(), NOW())
   ON CONFLICT (user_id, role) DO NOTHING
   RETURNING id;
   ```
   Se 0 rows (CONFLICT) → log warning, continuar para 9b mesmo assim (request fica approved, role já existia).

   9b. **UPDATE request:**
   ```sql
   UPDATE role_requests
   SET status = 'approved',
       reviewed_by = auth.uid(),
       reviewed_at = NOW()
   WHERE id = {request_id};
   ```

10. **Se REJECT — só UPDATE request:**
    ```sql
    UPDATE role_requests
    SET status = 'rejected',
        reviewed_by = auth.uid(),
        reviewed_at = NOW()
    WHERE id = {request_id};
    ```
    user_roles NÃO recebe row.

11. **Tratar erros:**
    - 42501 (RLS denial) → BLOCKED
    - 23505 (UNIQUE user_roles) → tratado em 9a com ON CONFLICT (não escala)
    - 23514 (CHECK status) → ESCALATE
    - Falha em 9b após 9a OK → log warning de partial state. user_roles tem nova row mas request ainda pending. Tentar UPDATE request novamente. Se falhar 2x → ESCALATE com `manual_cleanup_needed` (owner pode rodar approve novamente, é idempotente).
    - 5xx → retry 1x → ESCALATE

12. **Activity log** (CRÍTICO em admin ops):
    - `action='admin-specialist.approve_role_request'` ou `'reject_role_request'`
    - `resource_type='role_request'`
    - `resource_id={request_id}`
    - `details={target_user_id, requested_role, decision, response_message, current_roles_before}`

    **STRICT failure mode:** se activity_logs INSERT falhar (per admin-specialist agent rule), ABORT cycle. Não pode haver role mutation sem audit.

13. **FLAG quality-guardian audit** — ops admin SEMPRE auditadas (INV-07 extension). Chief delegate `*audit --cycle {id}` automaticamente.

14. **Echo:**
    - **APPROVE:**
      ```
      Pedido aprovado ✓
      {target_name} agora tem role «{requested_role}».

      Capabilities ganhas: {list}
      Activity log registrado: action=approve_role_request

      Recomende ao user fazer logout/login se token estiver cached.
      ```
    - **REJECT:**
      ```
      Pedido rejeitado.
      {target_name} continua com roles: {current_roles}.

      {response_message ? "Mensagem para o user: " + response_message : ""}
      Activity log registrado: action=reject_role_request
      ```

### acceptance_criteria

- **[A1] Owner-only gate:** task ABORT imediatamente se user.role != 'owner'. Zero queries pra role_requests.
- **[A2] Idempotency via status check:** se request != 'pending', task abort sem mutations.
- **[A3] Owner promotion = tripla confirmation:** approve para `requested_role='owner'` exige "CONFIRMO OWNER" literal (não "confirma" comum).
- **[A4] Race-safe INSERT:** ON CONFLICT em user_roles previne duplicação se user já tem role (race entre request e approve).
- **[A5] Reject não toca user_roles:** schema default — UPDATE só na request.
- **[A6] Audit OBRIGATÓRIO:** activity_logs INSERT é STRICT — falha = ABORT (admin-specialist rule).
- **[A7] Quality-guardian audit:** flag para audit a CADA cycle, sem exceção.
- **[A8] Echo educacional:** approve menciona "logout/login pode ser necessário se token cached".

---

## Exemplos

### Exemplo 1 — Owner aprova request de comercial→admin

**Input:** Pablo (owner) aprova request_id `5e2f-...` de Miriam (comercial→admin)

**Specialist:**
1. is_owner ✓
2. Resolve request → status=pending, target=Miriam, requested_role=admin
3. Status pending ✓
4. Decision='approve' ✓
5. Não é owner promotion → confirmation simples
6. Step 1 preview shown → Step 2 "confirma" literal
7. INSERT user_roles → row id `aa11-...` (sem conflict)
8. UPDATE request → status=approved, reviewed_by=Pablo
9. Activity log INSERT
10. quality-guardian flagged
11. Echo:
    ```
    Pedido aprovado ✓
    Miriam Leitao agora tem role «admin».
    Capabilities ganhas: gerenciar users (exceto financeiro/owner), activity log, ...
    Activity log registrado.
    Recomende a Miriam fazer logout/login.
    ```

### Exemplo 2 — Non-owner tenta aprovar (BLOCKED)

**Input:** user role=admin tenta aprovar request

**Specialist:** Owner gate falha imediatamente → BLOCKED:
```
Aprovação de role requests é OWNER-ONLY. Sua role atual: admin.
Apenas owners podem aprovar/rejeitar. Peça ao Pablo (owner).
```

### Exemplo 3 — Promoção para owner (tripla confirmação)

**Input:** Pablo aprova request_id de Sandra (cs→owner) — caso raro

**Specialist:** Detecta requested_role='owner' → warning extra + Step 2 exige "CONFIRMO OWNER" literal. Se user digita só "confirma" → ESCALATE com:
```
Promoção para OWNER exige confirmação literal "CONFIRMO OWNER" (uppercase).
Você digitou "confirma". Cancelado por segurança. Re-execute se intencional.
```

### Exemplo 4 — Reject com mensagem

**Input:** Pablo rejeita request com `response_message='preciso entender melhor seu uso de admin antes — vamos conversar'`

**Specialist:** UPDATE só na request. Echo:
```
Pedido rejeitado.
Miriam continua com roles: [comercial].
Mensagem para o user: preciso entender melhor seu uso de admin antes — vamos conversar
Activity log registrado.
```

### Exemplo 5 — Race: user já ganhou role direto (warning + cleanup)

**Input:** Sandra criou request 3 dias atrás. Hoje Pablo grant_role direto e ESQUECEU de aprovar request. Outro owner agora aprova.

**Specialist:**
- Pre-check 7 detecta user já tem role → BLOCKED com `target_already_has_role` mas também UPDATE request.status='approved' para fechar pendência (cleanup):
  ```
  Atenção: Sandra já possui role «admin» (atribuído direto em 2026-05-08).
  O pedido foi marcado como approved (status fechado, sem nova mutation).
  Considere processar requests pending antes de grant_role direto pra
  manter audit trail consistente.
  ```

---

## Notas

- **FR5 source:** PRD `docs/prd-v2/modules/01-auth.md` seção FR5.
- **`role_requests` schema:** id, user_id, requested_role, status, reviewed_by, reviewed_at, created_at, reason. (Confirmado prod 2026-05-10.)
- **Notification side-effect (Sprint futuro):** integration-specialist notifica target user via WhatsApp/email quando approve/reject acontece.
- **Diferença vs grant_role direto:** `admin-specialist.grant_role` é owner→target mutation imediata (ex: onboard novo membro). `approve-role-request` é gated por workflow request (ex: user solicita ascensão por iniciativa própria).
- **Token cache:** Supabase JWT pode ter role claims cached por sessão. User pode precisar relogar para ver nova role efetiva. Recomendar no echo.

---

**Mantido por:** admin-specialist (owner-only gate)

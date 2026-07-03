# Task: manage-academy-access

> Gerir o ACESSO de um aluno à Academy ArchPrime (`academy.archprime.io`) — conceder/estender/revogar/listar `acad_entitlements`. Preenche a lacuna [ALTO]: hoje o acesso só é concedido automaticamente pelo `stripe-webhook`; não havia caminho manual (cortesia, reembolso, extensão de prazo, staff).

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ⚠️ Confirme em `types.ts`: `acad_entitlements` tem `user_id`, `product` (NOT NULL), `access_until`, `revoked_at`, `notes`. Conceder = INSERT; estender = UPDATE `access_until`; revogar = UPDATE `revoked_at`. Gate lido por `user_has_academy_access()`.

---

## Task anatomy

### task_name
`Manage Academy Access`

### status
`pending`

### responsible_executor
`platform-specialist` — auth **owner/admin** (acesso a produto academy; a RLS de `acad_entitlements` é a fonte real).

### execution_type
`Agent` — confirmação obrigatória (concede/revoga acesso pago); revoke/grant em massa exige dupla.

### input
- **Cycle ID**, **User JWT**, **User role**
- `operation` — `grant | extend | revoke | list`
- `user_id` (uuid) **ou** `email` (resolver→user_id) — **ELICITAR** (o aluno-alvo)
- `product` (string, ex.: `'strategia-cac'`) — **source: schema NOT NULL** + **ELICITAR sempre** (qual produto de acesso; nunca defaultar)
- `access_until` (date/timestamptz) — obrigatório para `grant`/`extend` (até quando vale o acesso)
- `notes` (string opcional — motivo: cortesia/staff/reembolso)

### output
- `entitlement_id`, `user_id`, `product`, `access_until`, `revoked_at`, `verdict: DONE | BLOCKED | ESCALATE`

### action_items
1. **Auth** — owner/admin (RLS de `acad_entitlements`). Demais → BLOCKED (42501).
2. **Resolver aluno** — `user_id` (ou `email`→`user_id`). Confirmar que o `profiles.id` existe. Novo aluno sem conta → usar a EF `create-prime-plus-access` (provisiona conta + acesso) OU orientar signup antes. Não encontrado → ESCALATE.
3. **Elicitar `product`** (sempre) + `access_until` (grant/extend). Nunca defaultar o produto.
4. **Confirmação** (echo): "operação {operation} · aluno {full_name} · produto {product} · válido até {access_until} · motivo {notes}". `revoke` e grant retroativo → dupla confirmação (`confirma`).
5. **Write** (JWT do user, RLS):
   - **grant:** `INSERT INTO acad_entitlements (user_id, product, access_until, notes) VALUES (...) ON CONFLICT (user_id, product) DO UPDATE SET access_until=EXCLUDED.access_until, revoked_at=NULL, notes=EXCLUDED.notes RETURNING id;`
   - **extend:** `UPDATE acad_entitlements SET access_until={access_until}, updated_at=now() WHERE user_id={user_id} AND product={product} RETURNING id;`
   - **revoke:** `UPDATE acad_entitlements SET revoked_at=now(), updated_at=now() WHERE user_id={user_id} AND product={product} RETURNING id;`
   - **list:** `SELECT id, product, access_until, revoked_at, notes FROM acad_entitlements WHERE user_id={user_id};`
   Erros: `42501` → BLOCKED; `23503` (FK user_id) → BLOCKED; 0 linhas em extend/revoke → ESCALATE (não tinha acesso).
6. **Verificação PÓS-AÇÃO** (obrigatória): re-`SELECT` do entitlement confirmando o efeito (grant/extend: `access_until` e `revoked_at IS NULL`; revoke: `revoked_at` preenchido).
7. **Activity log**: `action='platform-specialist.manage_academy_access'`, `details={cycle_id, operation, user_id, product, access_until, revoked}`.

### acceptance_criteria
- **[A1]** Auth owner/admin.
- **[A2]** `user_id`/aluno e `product` elicitados; produto nunca defaultado.
- **[A3]** `access_until` exigido em grant/extend.
- **[A4]** revoke/grant retroativo com dupla confirmação.
- **[A5]** Verificação pós-ação confirma o efeito (grant/extend/revoke).
- **[A6]** Colunas reais de `acad_entitlements` (nada de fantasma).

---

## Exemplos
### Exemplo 1 — Cortesia de acesso (grant, DONE)
Admin dá acesso `strategia-cac` a um aluno até 2027-01-01, notes 'cortesia evento' → INSERT/UPSERT → verificação ok.
### Exemplo 2 — product ausente (ELICITAR)
Pedido "dá acesso pro fulano" sem produto → pergunta "Qual produto?" antes de INSERT.
### Exemplo 3 — Reembolso (revoke)
UPDATE `revoked_at=now()`; dupla confirmação; aluno perde acesso na próxima checagem de `user_has_academy_access()`.

## Notas
- Grant automático de compra é do `stripe-webhook` (não mexer). Esta task é para acesso MANUAL (cortesia/staff/extensão/reembolso). Provisionar aluno NOVO com conta = EF `create-prime-plus-access`.
- Acesso Lovarch (produto separado) = `manage-lovarch-access` (Fase 2). Ver alunos/progresso = `list-academy-students`.
- Referências: `data/required-fields-registry.yaml`, `types.ts` (`acad_entitlements`), `supabase/functions/create-prime-plus-access`.

---

**Mantido por:** platform-specialist

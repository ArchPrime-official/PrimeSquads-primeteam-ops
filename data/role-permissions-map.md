# Role × Agent Permissions Map

> Matriz detalhada de quais agents cada role pode usar, com scope concreto do que cada combinação permite.

**Princípio:** o squad mostra o que o usuário PODE fazer; o Supabase RLS decide o que ele VAI VER.

---

## Matriz por agent (8 agents da v1.0)

### `ops-chief` (Tier 0 — Orchestrator)

| Role | Acesso | Notas |
|------|--------|-------|
| owner | ✅ completo | Pode invocar qualquer specialist |
| financeiro | ✅ | Só roteia para specialists compatíveis |
| comercial | ✅ | Só roteia para specialists compatíveis |
| cs | ✅ | Só roteia para specialists compatíveis |
| marketing | ✅ | Só roteia para specialists compatíveis |

**Todos podem invocar o chief.** Chief decide o que fazer.

---

### `auth-specialist` (Tier 1)

| Role | Acesso | Comandos |
|------|--------|----------|
| Todas | ✅ | `*login`, `*logout`, `*whoami`, `*refresh` |

Todo usuário precisa autenticar. Sem distinção de role aqui.

---

### `platform-specialist` (Tier 1 — operações CRUD gerais)

Cobre: tasks, finance (via `has_finance_access`), CS (via `has_role('cs')`), admin (via `is_admin`), import CSV, profile.

| Role | Escopo do que platform-specialist entrega |
|------|----------------------------------------|
| owner | Tudo |
| financeiro | Finance completo, tasks pessoais, profile, imports |
| comercial | Tasks pessoais, profile, perfis próprios (sem finance, sem CS) |
| cs | Tasks pessoais, profile, students/tickets via `has_role('cs')` |
| marketing | Tasks pessoais, profile (sem finance, sem CS) |

---

### `sales-specialist` (Tier 2 — CRM/Vendas)

Cobre: leads, opportunities (pipeline kanban via comando), qualificação, bulk ops.

| Role | Acesso | Scope |
|------|--------|-------|
| owner | ✅ | Todas oportunidades + leads |
| comercial | ✅ | Oportunidades/leads via role `comercial` (RLS filtra por owner) |
| admin/financeiro | ❌ RLS bloqueia | Não tem role `comercial` nem está em policy |
| cs/marketing | ❌ RLS bloqueia | Idem |

**Após Fase 0 (PR #951):** as 3 policies permissivas foram removidas. Agora só comercial + owner acessam opportunities.

---

### `marketing-specialist` (Tier 2)

Cobre: campaigns, editorial calendar, Meta sync, leads (marketing view), content metrics.

| Role | Acesso | Scope |
|------|--------|-------|
| owner | ✅ | Tudo |
| marketing | ✅ | Campanhas, editorial, Meta via role `marketing` |
| Outros | ❌ | RLS bloqueia |

---

### `cs-specialist` (Tier 2)

Cobre: students, tickets, atividades, onboarding forms, avatars.

| Role | Acesso |
|------|--------|
| owner | ✅ |
| cs | ✅ via role `cs` |
| Outros | ❌ |

---

### `content-builder` (Tier 2 — editor-replacement CLI)

Cobre: LP blocks (17 types), forms, quiz, automation flows (via JSON).

| Role | Acesso | Scope |
|------|--------|-------|
| owner | ✅ | Tudo |
| marketing | ✅ | LPs, forms, quiz que tem role marketing permite |
| Outros | ❌ (RLS em `landing_pages`) | Exceto ver LPs públicas publicadas |

---

### `quality-guardian` (Tier 3 — cross-cutting)

Valida i18n, RLS, lint, mobile-first em output de outros agents.

| Role | Acesso |
|------|--------|
| Todas | ✅ | Validação é read-only, não depende de role |

---

### `design-guardian` (Tier 3 — cross-cutting)

Valida ArchPrime DS compliance em output de `content-builder`.

| Role | Acesso |
|------|--------|
| owner | ✅ |
| marketing | ✅ |
| Outros | ❌ (só valida se trigger veio de content-builder em role compatível) |

---

### `integration-specialist` (Tier 3 — APIs externas)

Cobre: Google Calendar (wrapper OAuth), Meta Ads sync, Revolut sync, Stripe.

| Role | Acesso | Scope |
|------|--------|-------|
| owner | ✅ | Todas integrações |
| financeiro | ✅ Revolut, Stripe | RLS em finance_* |
| marketing | ✅ Meta Ads | RLS em meta_* |
| comercial | ✅ Google Calendar | Por closer_id no user_oauth_tokens |
| cs | ❌ | Sem integrações específicas |

---

## Cenários práticos

### Sandra (marketing) tenta usar platform-specialist para finance

```
Sandra: /ptOps:platform "listar transações de março"
  → platform-specialist executa: SELECT * FROM finance_transactions WHERE ...
  → RLS: has_finance_access() para user_id=sandra = false
  → Retorna: []
  → Agent responde: "Nenhuma transação encontrada ou você não tem permissão financeira."
```

Comportamento correto: squad não "esconde" acesso, deixa RLS responder. Specialist explica contextualmente.

### Jessica (cs) tenta ver pipeline comercial

```
Jessica: /ptOps:sales "mostrar meu pipeline"
  → sales-specialist executa queries em opportunities
  → RLS: Jessica tem role 'cs', nenhuma policy de opportunities aceita 'cs'
  → Retorna: [] ou erro 401
  → Agent responde: "Você não tem acesso ao pipeline comercial. Se isso está incorreto, verifique suas roles com /ptOps:auth whoami."
```

### Yuri (comercial, leader) usa radar-specialist

Quando radar-specialist for criado (Fase 4):

```
Yuri: /ptOps:radar "preparar comitê desta semana"
  → radar-specialist executa queries em radar_meetings
  → RLS: admin/owner, OR leader de setor (comercial)
  → Yuri é leader comercial, passa
  → Agent edita meeting + action plans
```

---

## Quando squad deve recusar (antes de executar)

Há casos onde o squad **pode recusar antes** de executar, para economizar round-trip com RLS:

### 1. Agent claramente incompatível

```
Jessica: /ptOps:finance "criar transação"
  → ops-chief: "Role 'cs' não tem acesso financeiro. Recomendo não tentar.
               Se acredita que deveria ter, fale com o owner."
```

Não tenta rotear — evita erro desnecessário.

### 2. Comando bloqueado por policy

```
Sandra: /ptOps:admin "deletar usuário X"
  → ops-chief: "Role 'marketing' não pode deletar usuários. Apenas 'owner'."
```

### 3. Quando há dúvida

```
Yuri: /ptOps:radar "editar metas"
  → ops-chief: "Para edição de radar, você precisa ser leader de setor.
               Verificando... você é leader comercial, pode prosseguir."
```

Chief resolve sozinho (não precisa ESCALATE nem rodar RLS).

---

## Expansão futura (v2.0)

Se a plataforma adicionar roles novas (ex: `operations`, `partner`), atualizar:

1. Esta matriz
2. `data/team-roles-reference.md`
3. `primeteam-platform-rules.md` seção 8
4. Agents afetados (adicionar na lista de roles aceitas)
5. CHANGELOG.md do squad

---

## Reference

- Regras completas: [`primeteam-platform-rules.md`](./primeteam-platform-rules.md) seção 8
- Time: [`team-roles-reference.md`](./team-roles-reference.md)
- Supabase policies: ver migrations em `supabase/migrations/` do repo PrimeTeam

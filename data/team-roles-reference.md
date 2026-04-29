# Team Roles Reference

> Os colaboradores da ArchPrime, suas roles no Supabase e os agents do squad
> que fazem sentido para cada um.

**Source of truth:** `auth.users` + `user_roles` + `profiles` no Supabase
(`xmqmuxwlecjbpubjdkoj`). Este arquivo é um snapshot do estado real
consultado em **2026-04-29**.

**Last updated:** 2026-04-29

> ℹ️ **Email não está exposto** via RLS — `auth.users.email` requer service
> role. Para contato direto com o time, usar o dashboard Supabase. O squad
> identifica usuários via `user_id` (UUID) internamente.

---

## Roster ativo (11 usuários com `is_active=true`)

| Nome | Role(s) Supabase | Departamento (perfil) | Agents principais |
|------|------------------|----------------------|-------------------|
| Pablo | `owner` | CEO | Todos |
| Joyce Kelly | `admin` + `financeiro` | — | auth, platform, finance |
| Wesley Alexandre Boeno Rugani | `financeiro` | financeiro | auth, platform, finance |
| Sandra | `admin` + `marketing` | — | auth, marketing, content-builder, automation |
| Miriam | `comercial` + `cs` + `marketing` | — | auth, platform, sales, calendar, content-builder, automation |
| Daniel | `comercial` + `cs` | comercial | auth, platform, sales, calendar |
| Yuri | `comercial` + `cs` | — | auth, platform, sales, calendar |
| Jessica | `admin` + `cs` | CS | auth, platform, cs |
| ilaria esposito | `marketing` | — | auth, marketing, content-builder, automation |
| Michele | `admin` + `comercial` | — | auth, platform, sales, calendar |
| teste | (sem role atribuída) | financeiro | auth (apenas) |

> ⚠️ "teste" é um profile ativo sem role atribuída — RLS bloqueia tudo que
> dependa de role. Conta de teste antiga; manter ou desativar fica a critério
> do owner.

---

## Roster inativo (21 usuários com `is_active=false`)

Mantidos para histórico (ex-colaboradores, contas sazonais, planejamento
futuro). **Não são roteados pelo squad** — quando logam, RLS já bloqueia o
acesso a partir de `auth.users.deleted_at` ou checks de policy.

| Nome | Role(s) | Departamento |
|------|---------|--------------|
| Andrea | `cs` | CS |
| Cami Grinover | `cs` | cs |
| christopher | (sem role) | Vendas |
| Davi | `admin` | — |
| El Mahdi Baiz | `marketing` | — |
| Eri | `comercial` | — |
| Flavio | `comercial` | Commerciale |
| Francesca | `comercial` | — |
| Francesco Del Vento | `comercial` | — |
| Frank | `comercial` | — |
| Gabriella | `cs` | — |
| Gianluca Crupano | `comercial` | — |
| Giordano | `comercial` | — |
| Juliana | `cs` | — |
| Larissa | `admin` + `financeiro` | Financeiro |
| Rafaela | `comercial` | — |
| Rayanne | `cs` | — |
| Roberto | (sem role) | Vendas |
| Sharon | (sem role) | Vendas |
| Yahya | (sem role) | Vendas |
| Yassine | `comercial` | Sales |

---

## Role hierarchy (para priorização)

```
owner       (power 1) → acesso total
admin       (power 2) → gestão geral (não tem mais finance access desde 2026-03-04)
financeiro  (power 2) → Finance completo
comercial   (power 3) → CRM + Agenda
cs          (power 3) → CS + tasks pessoais
marketing   (power 3) → Marketing + Automação + Content
```

Roles têm número "power" menor = mais permissão. Não há hierarquia estrita
entre power 3 (são laterais).

---

## Acesso financeiro (`has_finance_access()`)

Apenas roles `owner` e `financeiro` retornam `true` na função
`has_finance_access()` no Supabase (admin foi removido em 2026-03-04).

**Pessoas ativas com acesso financeiro hoje:**
- Pablo (`owner`)
- Joyce Kelly (`financeiro`)
- Wesley Alexandre Boeno Rugani (`financeiro`)

Total: **3 ativas**. As outras 8 ativas do roster não veem nenhum dado
financeiro — RLS retorna array vazio em qualquer query a `finance_*`.

---

## Como o squad usa esta tabela

1. **Per-user (sempre fresca):** após `pto login` ou `pto refresh`, a CLI faz
   query em `user_roles` e armazena a(s) role(s) em `~/.primeteam/session.json`
   no campo `roles[]` (Sprint 28). O `ops-chief` lê esse campo na ativação para
   personalizar a saudação e pular perguntas de tour.
2. **Roster completo (snapshot):** este arquivo serve como referência humana
   e é consumido pelo `ops-chief` na ativação (STEP 3) para entender o time.
   Atualizar manualmente quando houver mudanças no time (ver "Onboarding"
   abaixo).
3. **Triage:** chief verifica roles do usuário antes de rotear:
   - Comando compatível: roteia diretamente
   - Comando de role diferente: explica e recusa (economiza round-trip RLS)
4. `*help` lista só agents compatíveis com role (UX, não é segurança — RLS
   enforça a real).

---

## Multi-role

Vários usuários têm múltiplas roles. Exemplos do roster ativo:

- Joyce = `admin` + `financeiro`
- Sandra = `admin` + `marketing`
- Miriam = `comercial` + `cs` + `marketing` (3 roles)
- Jessica = `admin` + `cs`
- Michele = `admin` + `comercial`

A query em `user_roles` retorna array. Quando o array tem > 1 role, squad
usa **união** dos agents permitidos.

---

## Onboarding de novo colaborador

Quando um novo usuário é adicionado:

1. Owner (Pablo) cria user em `auth.users` (via Supabase dashboard ou Auth UI)
2. Owner cria profile em `profiles` (full_name, department, is_active=true)
3. Owner concede role(s) via INSERT em `user_roles` (respeitando trigger
   `only_owner_grants_sensitive_roles_trigger`)
4. **Owner edita este arquivo** adicionando o nome à seção "Roster ativo"
5. Colaborador instala primeteam-ops localmente, roda `pto login`
6. CLI cacheia roles em `~/.primeteam/session.json:roles[]`
7. Squad detecta role na ativação, personaliza saudação

**Constraint de segurança:** apenas `owner` pode conceder roles `financeiro`
e `owner` (enforçado por trigger no DB).

---

## Atualizar este documento

Este arquivo é **referência manual**. Quando houver mudanças no time:

1. Atualizar tabela "Roster ativo" / "Roster inativo"
2. Atualizar `CHANGELOG.md` do squad
3. PR no repo do squad

> 🚧 **Backlog (não-prioritário):** comando `pto sync-roster` para regenerar
> este arquivo automaticamente a partir do Supabase. Decisão Sprint 28: adiar
> até a manutenção manual incomodar — mudanças no time são <1×/mês.

O squad **não** sincroniza automaticamente a partir do Supabase. A única fonte
de verdade de RLS é o DB — este arquivo é referência humana para o time e
para o agent na ativação.

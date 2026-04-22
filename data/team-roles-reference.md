# Team Roles Reference

> Os 10 colaboradores da ArchPrime, suas roles no Supabase e os agents do squad que fazem sentido para cada um.

**Source of truth:** `auth.users` + `user_roles` no Supabase (`xmqmuxwlecjbpubjdkoj`).

**Last updated:** 2026-04-22

---

## Roster

| Nome | Email | Role Supabase | Setor | Agents principais |
|------|-------|---------------|-------|-------------------|
| Pablo | pablo@archprime.io | `owner` | Owner | Todos |
| Joyce | joyce@archprime.io | `financeiro` | Administrativo | auth, platform, finance |
| Larissa | larissa@archprime.io | `financeiro` | Administrativo | auth, platform, finance |
| Adriana | adriana@archprime.io | `financeiro` | Administrativo (contadora) | auth, platform, finance |
| Sandra | sandra@archprime.io | `marketing` | Marketing | auth, marketing, content-builder, automation |
| Miriam | miriam@archprime.io | `comercial` | Comercial | auth, platform, sales, calendar |
| Daniel | daniel@archprime.io | `comercial` | Comercial | auth, platform, sales, calendar |
| Yuri | yuri@archprime.io | `comercial` | Comercial (+ leader comitê) | auth, platform, sales, calendar, radar |
| Jessica | jessica@archprime.io | `cs` | Customer Success | auth, platform, cs |
| Andrea | andrea@archprime.io | `cs` | Customer Success | auth, platform, cs |

---

## Role hierarchy (para priorização)

```
owner    (power 1) → acesso total
admin    (power 2) → gestão geral (atualmente sem user ativo)
financeiro (power 2) → Finance completo
comercial (power 3) → CRM + Agenda
cs       (power 3) → CS + tasks pessoais
marketing (power 3) → Marketing + Automação + Content
```

Roles têm número "power" menor = mais permissão. Não há hierarquia estrita entre power 3 (são laterais).

---

## Como o squad usa esta tabela

1. Após `npx primeteam-ops login`, CLI faz query em `user_roles` e armazena a(s) role(s) da session em `~/.primeteam/session.json`
2. `ops-chief` ao triar demanda, verifica a role do usuário:
   - Se comando compatível: roteia diretamente
   - Se comando de role diferente: avisa ("tentativa de acesso" com explicação)
3. `*help` lista só agents compatíveis com role (UX, não é segurança — RLS enforça real)

---

## Multi-role (futuro)

Alguns usuários podem ter múltiplas roles (ex: Yuri é comercial + leader de radar). A query em `user_roles` retorna array.

Se o array tem > 1 role, squad usa união dos agents permitidos.

---

## Onboarding de novo colaborador

Quando um novo usuário é adicionado:

1. Owner (Pablo) cria user em `auth.users` (via Supabase dashboard ou CLI admin)
2. Owner concede role via INSERT em `user_roles` (respeitando trigger `only_owner_grants_sensitive_roles_trigger`)
3. Colaborador instala primeteam-ops localmente, roda `login`
4. Squad detecta role, mostra agents compatíveis no `*help`

**Constraint de segurança:** apenas `owner` pode conceder roles `financeiro` e `owner` (enforçado por trigger no DB).

---

## Atualizar este documento

Este arquivo é referência estática. Quando houver mudanças no time:

1. Atualizar tabela Roster
2. Atualizar CHANGELOG.md do squad
3. PR no repo do squad
4. `bump-all-squads.sh` nos projetos consumidores

O squad **não** sincroniza automaticamente a partir do Supabase. A única fonte de verdade de RLS é o DB — este arquivo é referência humana para o time.

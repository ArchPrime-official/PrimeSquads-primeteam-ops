# PrimeTeam Platform Rules — Central Reference

> **ARQUIVO DE LEITURA OBRIGATÓRIA** antes de qualquer ação executada pelo squad `primeteam-ops`. Todos os specialists consultam este documento. Violações são detectadas pelo `handoff-quality-gate`.

**Version:** 1.3.0
**Last updated:** 2026-07-03

---

## Índice

1. [GitHub Security & Privacy](#1-github-security--privacy)
2. [Auth & Session](#2-auth--session)
3. [Handoff Protocol (Hub-and-Spoke)](#3-handoff-protocol-hub-and-spoke)
4. [Code Patterns](#4-code-patterns)
5. [Database Rules (RLS)](#5-database-rules-rls)
6. [i18n Rules](#6-i18n-rules)
7. [ArchPrime Design System](#7-archprime-design-system)
8. [Role-Based Access (RBAC)](#8-role-based-access-rbac)
9. [Logging & Audit](#9-logging--audit)
10. [Platform Conventions](#10-platform-conventions)
11. [Heurísticas de Arquitetura (SSoT · AI cost · UAZAPI)](#11-heurísticas-de-arquitetura-ssot--ai-cost--uazapi)
12. [HO-TP-002 — Required Fields Completeness](#12-ho-tp-002--required-fields-completeness-campos-obrigatórios-enforçados)
13. [HO-TP-003 — Domain ⇒ Brand ⇒ Design System coupling](#13-ho-tp-003--domain--brand--design-system-coupling)

---

## 1. GitHub Security & Privacy

**Este repo é público-safe.** Todo o time (10 colaboradores) tem acesso ao repositório `ArchPrime-official/PrimeSquads-primeteam-ops`. Regras invioláveis:

### 1.1 Nunca hardcodar

- ❌ `SUPABASE_SERVICE_ROLE_KEY` — NUNCA no código do squad, em nenhuma circunstância
- ❌ Personal access tokens (GitHub, Stripe, Revolut, Meta, etc.)
- ❌ Senhas, private keys, JWTs de usuário
- ❌ URLs com credenciais embutidas

### 1.2 Público por design (ok no repo)

- ✅ `VITE_SUPABASE_URL` — mesma URL que aparece no JS do `primeteam.archprime.io` (site público)
- ✅ `VITE_SUPABASE_ANON_KEY` — anon key é pública por definição no modelo Supabase
- ✅ Project ref (`xmqmuxwlecjbpubjdkoj`) — aparece publicamente em requests

**Por quê é seguro:** a anon key sozinha não dá acesso a nada. Toda query passa pelas policies RLS, que exigem JWT válido de um usuário real. Sem JWT → Supabase retorna 401. O JWT pessoal fica local (`~/.primeteam/session.json`), nunca no repo.

### 1.3 Session management

Cada colaborador tem sua sessão local:

```
~/.primeteam/
└── session.json     (chmod 600, .gitignored)
    {
      "access_token": "eyJ...",
      "refresh_token": "...",
      "expires_at": "2026-04-22T15:30:00Z",
      "user": { "id": "...", "email": "sandra@archprime.io" }
    }
```

Veto conditions para session:
- ❌ `session.json` nunca pode ser committed
- ❌ `session.json` permissions DEVE ser `600` (owner-only read/write)
- ❌ Session nunca pode ser transmitida para outro serviço externo
- ❌ Refresh token rotation DEVE ser respeitada (usar sempre o mais recente)

### 1.4 .gitignore obrigatório

```
# Session local (per-user)
.primeteam/
session.json
*.session.json

# Environment
.env
.env.local
.env.*.local

# Deno/Node modules
node_modules/
.deno/

# IDE
.vscode/
.idea/
*.swp
```

### 1.5 Code review para PRs no squad

Antes de merge em qualquer PR no squad:

- [ ] `git grep` por `sbp_`, `sk_live_`, `eyJ`, `SERVICE_ROLE`, `password`, `api_key` — deve vir vazio ou só matches em comentários explicativos
- [ ] `.gitignore` cobre session files
- [ ] README/docs não mencionam credenciais reais (só placeholders tipo `<your-token>`)

---

## 2. Auth & Session

### 2.1 Flow de autenticação (Google OAuth browser-callback)

Padrão escolhido: **Opção C** — mesmo OAuth client que `primeteam.archprime.io` usa.

```
primeteam-ops login
  ↓
CLI abre http://localhost:54321/callback (servidor local temporário)
  ↓
Browser abre: https://accounts.google.com/o/oauth2/v2/auth?...
  ↓
Usuário faz login com conta @archprime.io
  ↓
Google redireciona para http://localhost:54321/callback?code=...
  ↓
CLI troca code por JWT via Supabase (supabase.auth.exchangeCodeForSession)
  ↓
JWT salvo em ~/.primeteam/session.json (600, gitignored)
  ↓
Servidor local fecha
  ↓
"Autenticado como {email} (role: {role})"
```

### 2.2 Refresh automático

O Supabase SDK (`@supabase/supabase-js`) cuida do refresh token:

```typescript
supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    // Salvar nova session em disco
    saveSession(session);
  }
});
```

**Regra:** nunca bypassar o refresh token rotation. Sempre usar a session mais recente.

### 2.3 Quando session expira

- Access token expira: SDK renova automaticamente via refresh token
- Refresh token expira (~7 dias): forçar `primeteam-ops login` de novo
- Revogação manual (logout no browser): próxima chamada retorna 401, CLI detecta e orienta re-login

### 2.4 Detecção de role

Após login, CLI faz:

```typescript
const { data: roles } = await supabase
  .from('user_roles')
  .select('role')
  .eq('user_id', session.user.id);

const userRoles = roles.map(r => r.role);
// Guardar em session.json para acesso rápido
```

**Role hierarchy** (usada para priorização de comandos):

| Role | Power | Exemplo |
|------|-------|---------|
| owner | 1 | Pablo |
| admin | 2 | (não usado atualmente no time) |
| financeiro | 2 | Joyce, Larissa, Adriana |
| comercial | 3 | Miriam, Daniel, Yuri |
| cs | 3 | Jessica, Andrea |
| marketing | 3 | Sandra |

### 2.5 Forbidden

- ❌ Nunca usar `service_role_key` mesmo "para debug"
- ❌ Nunca compartilhar session.json entre usuários
- ❌ Nunca logar o JWT no stdout/stderr
- ❌ Nunca enviar JWT para serviço externo que não seja Supabase

---

## 3. Handoff Protocol (Hub-and-Spoke)

### 3.1 Regra absoluta

**Todos os specialists retornam ao `ops-chief` ao terminar qualquer trabalho.** Nenhum specialist encadeia diretamente para outro.

```
✅ CORRETO:
  auth-specialist → ops-chief → platform-specialist → ops-chief → content-builder → ops-chief → user

❌ ERRADO:
  auth-specialist → platform-specialist (direct, sem chief) → user
```

### 3.2 Announcement obrigatório

Todo retorno começa com:

```
Retornando ao @ops-chief. {trabalho breve} concluído.
```

**Regex:** `^Retornando ao @ops-chief\. .{3,80} concluíd[oa]\.$`

Exemplos válidos:
- `Retornando ao @ops-chief. Login Google OAuth concluído.`
- `Retornando ao @ops-chief. Transação criada em finance_transactions concluída.`
- `Retornando ao @ops-chief. 4 blocos de LP inseridos concluídos.`

Exemplos inválidos:
- ❌ `Trabalho completo` (não bate regex)
- ❌ `Handoff to chief done` (não é português + sem @)
- ❌ `Retornando. Task done.` (formato errado)

### 3.3 Output Package (V11)

Todo handoff card ao chief contém os 5 elementos obrigatórios:

1. **File List** — arquivos tocados com action (created/modified/deleted)
2. **Change Log** — descrição em prosa do que e por quê (1-3 parágrafos)
3. **Convention Verification Report** — checklist de convenções
4. **Deploy Flag** — `safe-to-deploy: yes | no | with-caveats`
5. **Suggested Next** — `close`, `route_to @X`, `escalate_to_user`, ou `retry`

Template completo: [`data/handoff-card-template.md`](./handoff-card-template.md).

### 3.4 Gate de qualidade

Chief executa [`checklists/handoff-quality-gate.md`](../checklists/handoff-quality-gate.md) em cada retorno. Verdicts: PASS, REJECT, ESCALATE.

### 3.5 Status machine (6 estados)

```
Triaged → Routed → InProgress → Returned → Validated → Done
```

- **Triaged:** chief classificou demanda
- **Routed:** chief fez `*handoff @specialist`
- **InProgress:** specialist está executando
- **Returned:** specialist enviou handoff card para chief
- **Validated:** chief rodou gate e passou
- **Done:** chief fechou ciclo (close) ou transitou para próximo specialist (route_to)

### 3.6 Cycle ID

Todo ciclo tem ID único: `cyc-YYYY-MM-DD-NNN`

Exemplo: `cyc-2026-04-22-001` (primeiro ciclo do dia 22/04/2026)

Cycle ID é:
- Gerado pelo chief ao triar
- Propagado para todos os specialists envolvidos
- Logado no CHANGELOG.md
- Usado como correlation ID para debug

### 3.7 Forbidden

- ❌ Specialist fazer `*handoff @outro-specialist` direto
- ❌ Chief tentar resolver ambiguidade sozinho (deve ESCALATE)
- ❌ Handoff sem announcement prescrito
- ❌ Handoff sem 5 elementos do output package
- ❌ Pular run do gate antes de PASS/REJECT

---

## 4. Code Patterns

Quando o squad precisar ler/escrever código da plataforma PrimeTeam (ex: analisar módulo, sugerir fix), deve seguir os padrões do repo:

### 4.1 Stack

- **Frontend:** React 18 + TypeScript (strict) + Vite (SWC)
- **Styling:** Tailwind CSS + shadcn/ui (Radix UI primitives)
- **Routing:** React Router v6
- **Server state:** TanStack Query v5 (`staleTime: 60s`, `refetchOnWindowFocus: false`)
- **Forms:** react-hook-form + zod
- **i18n:** i18next (IT + PT-BR)
- **Backend:** Supabase (Auth, DB, Realtime, Storage, Edge Functions em Deno)

### 4.2 Path alias

```typescript
// ✅ CORRETO
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

// ❌ ERRADO
import { Button } from '../../components/ui/button';
```

### 4.3 Supabase client

```typescript
// ✅ CORRETO — import singleton
import { supabase } from '@/integrations/supabase/client';

const { data, error } = await supabase
  .from('tasks')
  .select('id, title, status')
  .eq('user_id', userId);

// ❌ ERRADO — createClient solto
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(url, key);
```

### 4.4 TypeScript types

Types do DB vêm de `apps/v2/src/integrations/supabase/types.ts` (auto-gerado):

```typescript
// ✅ Usar types auto-gerados
import { Database } from '@/integrations/supabase/types';
type Task = Database['public']['Tables']['tasks']['Row'];

// ❌ NUNCA editar types.ts manualmente
```

### 4.5 Forms

```typescript
// ✅ CORRETO
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  title: z.string().min(1).max(100),
  dueDate: z.date().nullable(),
});

type FormValues = z.infer<typeof schema>;

const form = useForm<FormValues>({ resolver: zodResolver(schema) });
```

### 4.6 Cache invalidation

```typescript
// ✅ CORRETO — invalidateQueriesWithDelay para post-mutation
import { invalidateQueriesWithDelay } from '@/lib/queryClient';

await supabase.from('tasks').insert({ ... });
invalidateQueriesWithDelay(['tasks']);

// Direto sem delay causa race condition com RLS + realtime
```

### 4.7 Persistência de preferências de UI

Qualquer tabs, filtros, seleções de usuário DEVEM persistir:

```typescript
// ✅ CORRETO
import { usePersistedTab } from '@/hooks/usePersistedTab';
const [activeTab, setActiveTab] = usePersistedTab('finance-tab', 'transactions');

// ❌ ERRADO — useState direto
const [activeTab, setActiveTab] = useState('transactions'); // perde ao navegar
```

### 4.8 Environment variables

```typescript
// ✅ CORRETO — via import.meta.env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

// ❌ ERRADO — hardcoded
const supabaseUrl = 'https://xmqmuxwlecjbpubjdkoj.supabase.co';
```

### 4.9 Forbidden

- ❌ SELECT `*` — sempre listar colunas explícitas
- ❌ useState para server data (usar TanStack Query)
- ❌ Redux ou Zustand (não são usados no projeto)
- ❌ Classe-based components (só functional)
- ❌ console.log em produção (apenas console.warn/error)

---

## 5. Database Rules (RLS)

**RLS é obrigatório em TODA tabela.** Sem exceções.

### 5.1 Helper functions SECURITY DEFINER

Disponíveis no banco (não recriar):

```sql
-- Owner + financeiro (admin REMOVIDO desde 2026-03-04)
has_finance_access() RETURNS boolean

-- Role específica
has_role(_user_id UUID, _role public.app_role) RETURNS boolean

-- Admin only
is_admin(_user_id UUID) RETURNS boolean

-- Owner only
is_owner(_user_id UUID) RETURNS boolean

-- Admin OR owner
is_admin_or_owner(_user_id UUID) RETURNS boolean
```

Sempre preferir esses helpers a reimplementar lógica nas policies.

### 5.2 Policy patterns

**Pattern 1: Acesso por owner (auth.uid() = user_id)**

```sql
CREATE POLICY "Users can view their own records"
ON public.my_table FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
```

**Pattern 2: Role-based (finance)**

```sql
CREATE POLICY "Finance users can view transactions"
ON public.finance_transactions FOR SELECT
TO authenticated
USING (has_finance_access());
```

**Pattern 3: Admin/owner only**

```sql
CREATE POLICY "Admin can view metrics"
ON public.cloud_function_metrics FOR SELECT
TO authenticated
USING (is_admin_or_owner(auth.uid()));
```

**Pattern 4: Via JOIN (indireto)**

```sql
CREATE POLICY "Users can view messages in their chats"
ON public.ai_chat_messages FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.ai_chats
    WHERE ai_chats.id = ai_chat_messages.chat_id
      AND ai_chats.user_id = auth.uid()
  )
);
```

### 5.3 Migrations obrigatórias-mente idempotentes

`db push` do Supabase **não** usa transactions — cada DDL commita separadamente. Migration que falha no meio fica parcialmente aplicada. Por isso:

```sql
-- ✅ CORRETO
DROP POLICY IF EXISTS "policy_name" ON public.my_table;
CREATE POLICY "policy_name" ON public.my_table ...;

-- ✅ CORRETO — para tabelas
CREATE TABLE IF NOT EXISTS public.my_table (...);

-- ✅ CORRETO — para colunas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'my_table'
      AND column_name = 'new_col'
  ) THEN
    ALTER TABLE public.my_table ADD COLUMN new_col TEXT;
  END IF;
END $$;

-- ❌ ERRADO — não idempotente
CREATE POLICY "..." ON ... ;  -- falha se policy já existe
ALTER TABLE ... ADD COLUMN ... ;  -- falha se coluna já existe
```

### 5.4 Nomenclatura

- **Tables:** snake_case, plural (`finance_transactions`, `landing_pages`)
- **Columns:** snake_case (`user_id`, `created_at`, `is_active`)
- **Policies:** descritivas em inglês (`"Users can view their own records"`)
- **Functions:** snake_case com sufixo `_rpc` se public-callable (`create_task_rpc`)
- **Indexes:** prefixo `idx_` + tabela + coluna(s) (`idx_tasks_user_id_status`)

### 5.5 Colunas obrigatórias

Toda tabela deve ter:

```sql
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
```

Se for user-owned:

```sql
user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
```

### 5.6 updated_at trigger

```sql
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at_on_my_table
BEFORE UPDATE ON public.my_table
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
```

### 5.7 Workflow obrigatório

Nunca push direto no `main`. Sempre:

1. `git checkout main && git pull origin main`
2. `git checkout -b {tipo}/descricao-YYYY-MM-DD`
3. Criar migration com timestamp `YYYYMMDDHHMMSS_description.sql`
4. Commit + push + `gh pr create --base main` + `gh pr merge <N> --squash --auto`
5. Security gate + supabase-deploy workflow rodam automaticamente

---

## 6. i18n Rules

### 6.1 Obrigatório em TODO texto visível

Nenhuma string JSX visível ao usuário pode ser hardcoded.

```typescript
// ✅ CORRETO
import { useTranslation } from 'react-i18next';
const { t } = useTranslation('finance');
return <Button>{t('newTransaction.submit')}</Button>;

// ❌ ERRADO
return <Button>Criar Transação</Button>;
```

### 6.2 Dois idiomas obrigatórios

Toda chave existe em ambos:

```
apps/v2/src/lib/i18n/
├── it/
│   ├── finance.ts       ← IT (primary — linguagem do usuário italiano)
│   ├── tasks.ts
│   └── ...
└── pt-BR/
    ├── finance.ts       ← PT-BR (secondary — linguagem do time interno)
    ├── tasks.ts
    └── ...
```

### 6.3 Namespacing por módulo

Cada módulo tem seu namespace:

```typescript
// apps/v2/src/lib/i18n/it/finance.ts
export default {
  newTransaction: {
    title: 'Nuova Transazione',
    amountLabel: 'Importo',
    submit: 'Crea',
  },
  list: {
    empty: 'Nessuna transazione',
  },
};

// Uso:
const { t } = useTranslation('finance');
t('newTransaction.title');  // "Nuova Transazione"
```

### 6.4 Detecção de missing keys

Teste automatizado: se CI detecta chave em um idioma e não no outro, PR falha.

### 6.5 Forbidden

- ❌ `alert("...")`, `console.log("mensagem para user")` — nenhum texto fora do i18n system
- ❌ Concatenação de strings traduzidas (usar interpolation: `t('key', { value })`)
- ❌ Traduzir via Google Translate e commitar — SEMPRE pedir revisão humana para IT
- ❌ Remover chave existente sem migration path (usuário pode ter cache antigo)

---

## 7. ArchPrime Design System

### 7.1 Tokens principais

```css
:root {
  /* Core Brand */
  --bg: #0F0F10;                     /* Arch Black */
  --gold: #C9995C;                   /* Arch Gold (accent) */
  --gold-hover: #D8B27A;
  --gold-pressed: #A8793E;
  --gold-soft: rgba(201, 153, 92, .18);
  --flame: #D4853A;

  /* Surfaces */
  --surface: #141416;
  --card: #1B1B1E;
  --border: rgba(245, 245, 247, .12);

  /* Text */
  --text-strong: rgba(245, 245, 247, 1);
  --text: rgba(245, 245, 247, .88);
  --text-muted: rgba(245, 245, 247, .55);

  /* Radius (Apple-like) */
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;

  /* Typography */
  --font-heading: 'Playfair Display', Georgia, serif;
  --font-body: 'Inter', -apple-system, sans-serif;

  /* Motion */
  --ease: cubic-bezier(.25, .46, .45, .94);
  --ease-out: cubic-bezier(.16, 1, .3, 1);
}
```

### 7.2 Typography hierarchy

| Classe | Font | Tamanho | Peso | Uso |
|--------|------|---------|------|-----|
| heading-xl | Playfair Display | clamp(2.8rem, 8vw, 6rem) | 800 | Hero titles |
| heading-lg | Playfair Display | clamp(2rem, 5vw, 3.5rem) | 700 | Section titles |
| body-lg | Inter | clamp(1.05rem, 1.5vw, 1.25rem) | 400 | Lead paragraphs |
| body-sm | Inter | 0.9rem | 400 | Secondary text |
| label | Inter | 0.75rem | 600 uppercase | Eyebrow labels |

### 7.3 Mobile-first obrigatório

A plataforma é **mobile-first**. Todas as decisões de layout:

1. Design primeiro para 375px (iPhone SE)
2. Adicionar breakpoints para desktop
3. Touch targets ≥ 44x44px
4. Inputs de texto: `font-size: 16px` mínimo (senão iOS faz zoom)
5. **Enter em input mobile = nova linha** (envio só via botão)

### 7.4 Dark mode first

Plataforma opera em dark mode por padrão. Light mode é opção. Tokens acima assumem dark. Light mode sobrescreve em `[data-theme="light"]`.

### 7.5 Acessibilidade (WCAG 2.1 AA)

- Contraste mínimo: 4.5:1 para texto body, 3:1 para text-muted
- Focus visible: sempre com outline ou ring (não `outline: none` sem substituto)
- `aria-label` em botões icon-only
- Forms com `label` associado (via `htmlFor` ou wrap)
- Headings sequenciais (h1 → h2 → h3, não pular)

### 7.6 Forbidden

- ❌ Cores hardcoded (`background: #000`) — SEMPRE tokens
- ❌ Gradientes com cores fixas fora do DS
- ❌ Google Fonts fora de Playfair + Inter
- ❌ Animações com `ease` diferente dos definidos
- ❌ Border-radius fora de `--radius-md`, `--radius-lg`, `--radius-xl`

---

## 8. Role-Based Access (RBAC)

### 8.1 Matriz role × agent

Quem pode usar cada agent do squad:

| Agent | owner | financeiro | comercial | cs | marketing |
|-------|:-----:|:----------:|:---------:|:--:|:---------:|
| ops-chief | ✅ | ✅ | ✅ | ✅ | ✅ |
| auth-specialist | ✅ | ✅ | ✅ | ✅ | ✅ |
| platform-specialist | ✅ | parcial | parcial | parcial | parcial |
| finance-specialist | ✅ | ✅ | ❌ | ❌ | ❌ |
| sales-specialist | ✅ | ❌ | ✅ | ❌ | ❌ |
| cs-specialist | ✅ | ❌ | ❌ | ✅ | ❌ |
| content-builder | ✅ | ❌ | ❌ | ❌ | ✅ |
| automation-specialist | ✅ | ❌ | ❌ | ❌ | ✅ |
| integration-specialist | ✅ | ✅ | ❌ | ❌ | ❌ |
| admin-specialist | ✅ | ❌ | ❌ | ❌ | ❌ |
| quality-guardian | ✅ | ✅ | ✅ | ✅ | ✅ |
| design-guardian | ✅ | ❌ | ❌ | ❌ | ✅ |

**"parcial"** = agent funciona mas RLS do Supabase limita dados retornados. Ex: `platform-specialist` para CS só vê tabelas que CS tem permissão (students, tickets, tasks próprias, etc.).

### 8.2 Como o enforcement acontece

**Não é o squad que enforça — é o Supabase RLS.** O squad pode oferecer um agent para uma role qualquer tentar; quando o agent executa a query, o RLS retorna vazio ou erro.

**Exemplo:**
```
Sandra (role: marketing) tenta: /ptOps:finance-specialist "lista contas"
→ finance-specialist executa: supabase.from('finance_bank_accounts').select('*')
→ RLS: has_finance_access() = false (marketing não é owner/financeiro)
→ Retorna: [] (array vazio)
→ Agent responde: "Nenhuma conta encontrada. Verifique se você tem permissão financeira."
```

### 8.3 UI-level hiding (opcional, cosmético)

O `ops-chief` pode **esconder** agents incompatíveis com a role do usuário ao listar opções via `*help`:

```
Sandra: /ptOps:help
ops-chief:
  Você pode usar estes agents (role: marketing):
  - /ptOps:auth              — login/logout/whoami
  - /ptOps:marketing         — campanhas, editorial, Meta sync
  - /ptOps:content           — LP blocks, forms, quiz, automation flows
  - /ptOps:quality-guardian  — validação i18n, lint, RLS
  - /ptOps:calendar          — bookings, Google Calendar
  
  (Agents de outros setores existem mas não vão retornar dados sem permissão.)
```

### 8.4 Forbidden

- ❌ Squad bypassar RLS por "conveniência"
- ❌ Usar service_role_key para "ajudar usuário a ver dados que não deveria"
- ❌ Cachear dados de um user e retornar para outro
- ❌ Nunca logar dados sensíveis do usuário (emails, telefones, valores financeiros) em stdout

---

## 9. Logging & Audit

### 9.1 CHANGELOG.md do squad

Toda execução de ciclo (request → handoffs → close) gera entry no `CHANGELOG.md`:

```markdown
## [0.1.0-cyc-2026-04-22-001] — 2026-04-22T14:30:00Z

**User:** sandra@archprime.io (role: marketing)
**Request:** "criar LP para evento immersione-roma-2026"
**Duration:** 12 min
**Status:** Done

### Handoffs executados
1. ops-chief → @content-builder → ops-chief (PASS)
2. ops-chief → @design-guardian → ops-chief (PASS)
3. ops-chief → @content-builder → ops-chief (PASS)
4. ops-chief → @quality-guardian → ops-chief (PASS)
5. ops-chief: close

### Files changed
- landing_pages (row inserted: slug='immersione-roma-2026')
- landing_pages.blocks (JSONB: 7 blocks)

### Deploy flag
safe-to-deploy: yes
```

### 9.2 Não logar dados sensíveis

```typescript
// ❌ ERRADO
console.log('Transaction:', { amount: 5000, user_email: 'pablo@...' });

// ✅ CORRETO
console.log('Transaction created:', { id: tx.id, amount_category: 'high' });
```

### 9.3 Error reporting

Erros vão para o stderr + chief decide ESCALATE ou REJECT:

```typescript
try {
  await supabase.from('tasks').insert(...);
} catch (error) {
  console.error(`[${cycleId}] Task creation failed:`, error.message);
  throw new HandoffError('Task creation failed', { cycleId, details: error });
}
```

### 9.4 Audit trail

Para ações críticas (delete, bulk update, mudanças de role), o squad SEMPRE:
1. Confirma com o usuário antes
2. Loga o resultado em CHANGELOG
3. Em caso de erro, preserva state anterior

---

## 10. Platform Conventions

### 10.1 Git workflow

Uma branch + um PR por sessão. NUNCA reusar branches de outros colaboradores.

Formato: `{tipo}/{descricao-curta}-{YYYY-MM-DD}`

Tipos: `feat/`, `fix/`, `refactor/`, `chore/`, `docs/`

### 10.2 Commit messages

Em português, descrevendo o O QUÊ (não hashes/códigos):

```
✅ feat: adicionar chat AI com suporte multi-provider
✅ fix: corrigir push notifications em browsers modernos
✅ refactor: separar componentes do calendario editorial

❌ fix: abc123
❌ update stuff
```

### 10.3 Branch base

Sempre `main`. Nunca branch de feature de outro.

### 10.4 PR deve passar

- Security gate (scans patterns perigosos)
- Type check (sem erros)
- Build (vite build)
- Lint (ESLint)

### 10.5 Auto-merge

Após abrir PR, sempre:
```bash
gh pr merge <N> --squash --auto
```

### 10.6 Forbidden

- ❌ Push direto em `main`
- ❌ Force push
- ❌ Merge commits (sempre squash)
- ❌ PRs com `Co-Authored-By` falsos
- ❌ Deletar commits do histórico público

---

## 11. Heurísticas de Arquitetura (SSoT · AI cost · UAZAPI)

> Três regras transversais que valem para TODA construção nova e todo refactor no v2. Cada uma nasceu de um incidente real — violá-las é débito técnico detectável.

### 11.1 Single Source of Truth (SSoT)

Toda integração externa que sincroniza ou cacheia dados (Meta Ads, Stripe, Revolut, Google Calendar, WhatsApp/UAZAPI, VAPI, Ringover) segue 5 cláusulas:

- **1 tabela canônica por tipo de dado.** Se duas tabelas guardam a mesma informação, uma é deprecated (vira VIEW ou é removida). Não existe "essa é mais detalhada".
- **1 writer por tabela canônica.** Só 1 Edge Function escreve nela; as outras são read-only. Webhook + cron concorrendo pela mesma tabela = anti-pattern.
- **1 cron por dado, com frequência única e explícita** (documentada em `supabase/config.toml`). Se precisar de fases (ex: campaigns antes de insights), use 1 orchestrator chamando workers em ordem — nunca crons múltiplos para o mesmo dado.
- **Hooks SEMPRE leem da tabela canônica — NUNCA chamam API externa direto.** Frontend nunca fala com Meta/Stripe/Revolut. Se o cache está stale, o bug é do sync, não do hook.
- **Cada tabela canônica tem `synced_at timestamptz NOT NULL` + `sync_source text NOT NULL`** (ex: `'meta-graph-api'`, `'stripe-webhook'`, `'revolut-cron'`). Sem isso, debug de "de onde veio esse número?" fica cego.

Caso de referência completo: `docs/architecture/meta-ads-ssot.md`. Todo PR que mexe em sync/cache/hook de integração externa passa pela checklist `squads/primeteam-improve/checklists/ssot-checklist.md`.

### 11.2 AI Cost Tracking

Toda chamada de IA paga (LLM, VAPI, geração de LP/creative, HeyGen, ElevenLabs, fal.ai, OpenAI, Gemini, Anthropic, BytePlus, etc.) DEVE registrar o custo em `creative_api_usage` (visível em `/gestao` → Creative Studio):

- **Passa pelo ai-gateway** (Edge Function `ai-gateway`). Edge Functions internas usam `logAiCall()` de `_shared/creative-usage-logger.ts` (sempre `await`, nunca fire-and-forget). Chamada não-proxeável (multipart/STT): faz direto + registra via `ai-gateway` com `operation: 'log'`.
- **NUNCA hardcodar preço.** Preço sempre da tabela canônica `ai_pricing` (UNIQUE provider+model+variant). Modelo sem linha → loga como `pricing_missing` e aparece no dashboard; adicionar a linha via migration.
- **Higgsfield** (créditos da conta, sem API key): após cada geração via MCP, registrar com `operation: 'log'`.
- Sempre com fallback direto + aviso `CUSTO NAO TRACKEADO` no stderr quando o gateway falhar.

### 11.3 Isolamento UAZAPI (WhatsApp)

Toda Edge Function que fala com a UAZAPI (receber webhook, enviar mensagem, listar/registrar grupo, backfill de membros, status de instância) é **dedicada e completamente isolada**:

- **Zero imports de `supabase/functions/_shared/`.** Qualquer utility (normalização de telefone, parsing de JID, lookup de instância) é DUPLICADA inline, com comentário explícito da duplicação.
- **1 operação UAZAPI = 1 Edge Function.** Nunca criar função guarda-chuva que trata múltiplas operações, nem adicionar uma operação nova como branch dentro de uma função existente.
- **Tabela própria** se a função persiste dados — não reusar tabela de outra função UAZAPI.
- **Motivo:** deletar ou refatorar uma função nunca pode afetar outra (defesa contra regressão silenciosa). UAZAPI/Baileys mudam o shape do payload entre versões — função pequena e dedicada é trivial de adaptar; função genérica vira pesadelo. É o caso particular mais estrito da SSoT.

---

## 12. HO-TP-002 — Required Fields Completeness (campos obrigatórios enforçados)

> Severidade: **MUST**. Complementa a HO-TP-001 (anatomy). Origem: pedido do dono da plataforma
> (Pablo, 2026-07-03) — "o pto deve OBRIGAR o usuário a preencher todos os campos de qualquer
> operação, nunca vago". O schema do DB é permissivo demais para ser o guardião (ex.: `tasks`
> só exige `title`; `landing_pages` nem `campaign_id`), então a obrigatoriedade é de NEGÓCIO e
> vive em `data/required-fields-registry.yaml` (fonte canônica), validada no CI por
> `scripts/validate-task-fields.py` (no repo PrimeTeam).

**Toda task de ESCRITA (create/update/delete/bulk/publish/manage/send/schedule/…) DEVE:**

1. **Ter entrada no registry** (`data/required-fields-registry.yaml`) com `table`, `writes` e
   `required[]`. Task de escrita sem entrada → WARN (rampa) → **FAIL** no CI (fase strict).
2. **Declarar em `input`** TODOS os campos `required` do registry (schema NOT NULL + regras de negócio).
3. **ELICITAR (perguntar)** cada campo ausente — **PROIBIDO default silencioso** em campo de
   negócio. Defaults só quando o registry NÃO listar o campo em `forbidden_defaults`. Em especial:
   - **Empresa/`brand` SEMPRE perguntada** onde a tabela tem empresa (finance, campaigns, invoices,
     products, goals, email, forms) — NUNCA assumir ArchPrime.
   - **`campaign_id` obrigatório** em toda criação de lead/landing-page/form (sem ele attribution quebra).
   - **Tarefa DEVE ter data+HORA de EXECUÇÃO** (`scheduled_start_time` + duração), não só `due_date`.
   - **`source`/atribuição** com lastro (nunca 'manual' silencioso; 'facebook' só com fbclid/fbc+referrer).
   - **`locale`/idioma** explícito; **remetente** por empresa em e-mail.
4. **Desabilitar os `hazards`** do registry pelo NOME antes do write (ver `finance-triggers-hazard`),
   nunca `DISABLE TRIGGER USER`.
5. **Verificação PÓS-AÇÃO obrigatória** — re-query confirmando o efeito (smoke). Sem isso → HIGH.
6. **Todo campo citado tem de existir no schema** (`types.ts`) — colunas/tabelas fantasma → CRITICAL.

**Ao criar uma FUNÇÃO NOVA:** copiar `tasks/_TEMPLATE-write-task.md` → preencher → registrar no
registry → o CI valida. É isto que obriga as próximas funções a nascerem completas.

---

## 13. HO-TP-003 — Domain ⇒ Brand ⇒ Design System coupling

> Severidade: **MUST**. Complementa a HO-TP-002. Origem: auditoria 2026-07-03 (5 agentes) —
> as tasks de conteúdo acertavam attribution/pixel/publish mas eram **cegas para Design System**:
> nenhuma dizia QUAL DS aplicar por domínio, e o gerador de LP por IA saía genérico. A plataforma
> serve **duas empresas** (ArchPrime e Lovarch) em domínios distintos, cada uma com seu DS, seu
> pixel e seu remetente. Confundir isso quebra identidade visual E atribuição.

**Fonte canônica:** [`data/domain-brand-ds-registry.yaml`](./domain-brand-ds-registry.yaml) — mapeia
cada domínio → `brand` → Design System → `meta_pixel_id` → remetente → renderer. Enforçado no CI por
`scripts/validate-domain-coupling.py` (repo PrimeTeam).

**Toda task que cria/edita CONTEÚDO PÚBLICO (landing page, form/moduli, e-mail, post editorial) DEVE:**

1. **Exigir `target_domain`** entre os valores do registry — **NUNCA assumir ArchPrime por default**.
2. **Resolver `brand = domains[target_domain].brand`** e aplicar, a partir de `brands[brand]`:
   - **Design System correto**: ArchPrime (Arch Black `#0F0F10` + Arch Gold `#C9995C`, Playfair+Inter)
     para `*.archprime.io`; **Lovarch DS V8** (`@archprime/lovarch-ds`, gold `#A16207`, "NO BLUE",
     Outfit/DM Sans/Playfair) para `lovarch.com`. **Proibido cruzar** (DS de uma marca em domínio da outra).
   - **`meta_pixel_id` da marca**: `1588378018327556` (ArchPrime) vs `901383099010400` (Lovarch) — nunca trocar.
   - **Remetente de e-mail da marca**: Lovarch → `info@lovarch.com`; ArchPrime → `noreply@` (transacional),
     `info@` (booking), `notifications@` (lead notify). E-mail renderiza pelo DS de marca em
     `_shared/email/tokens.ts` (`renderEmail({brand})`).
3. **Respeitar o renderer/cache do domínio**: React nativo + re-hidratação de `<script>` (nunca
   `document.write()`); `cms-revalidate` para ISR (`archprime.io`/`lovarch.com`), skip em `lp.archprime.io`.
4. **Dual-renderer Lovarch**: mexeu em renderer/schema/tracking → **PR companion em `ByPabloRuanL/lovarch`
   no mesmo dia** (a task deve avisar isso quando `target_domain = lovarch.com`).

O `content-builder` é o dono deste acoplamento (não há mais `design-guardian`). Toda task de conteúdo
referencia `domain-brand-ds-registry.yaml` — o validador de CI reprova a task que não referenciar.

---

## Versão e changelog deste documento

| Versão | Data | Mudanças |
|--------|------|----------|
| 1.0.0 | 2026-04-22 | Criação inicial (Fase 1 do squad) |
| 1.1.0 | 2026-07-02 | Seção 11 — heurísticas de arquitetura (SSoT, AI cost tracking, isolamento UAZAPI) |
| 1.2.0 | 2026-07-03 | Seção 12 — HO-TP-002 Required Fields Completeness (registry + CI enforcement) |
| 1.3.0 | 2026-07-03 | Seção 13 — HO-TP-003 Domain⇒Brand⇒Design System coupling (domain-brand-ds-registry.yaml + validate-domain-coupling.py) |

Próximas revisões são esperadas conforme a plataforma evolui. Toda mudança desta documentação passa por PR + review.

---

**FIM do documento.**

Todos os agents do squad `primeteam-ops` consultam este documento ANTES de qualquer ação. Se houver conflito entre a regra aqui e o que está no código, o código deste documento prevalece (squad corrige o código).

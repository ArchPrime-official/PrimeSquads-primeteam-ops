# Handoff Quality Gate — primeteam-ops

> Checklist blocker rodado pelo `ops-chief` em **cada retorno** de specialist. Decide se o trabalho avança, é rejeitado (retorna ao specialist) ou escala ao usuário.

**Cumpre:** V19 (squad-creator requirement)

**Verdito final:** `PASS` | `REJECT` | `ESCALATE`

---

## Instruções para o chief

Ao receber um handoff card de um specialist:

1. Ler o card completo
2. Executar **Seções 1-5** deste checklist
3. Contar checks passados vs falhados
4. Aplicar lógica de verdicto (final desta página)
5. Registrar resultado no CHANGELOG.md com Cycle ID

**Tempo estimado:** 30-90 segundos por handoff.

---

## Seção 1 — Protocol Integrity (BLOQUEADOR)

Verifica se a topologia hub-and-spoke está sendo respeitada. **Qualquer falha aqui = REJECT imediato.**

| # | Check | Regra | Pass? |
|---|-------|-------|-------|
| 1.1 | **Announcement regex** | Texto começa com `Retornando ao @ops-chief. {3-80 chars} concluíd[oa].` | [ ] |
| 1.2 | **No direct chain** | Specialist não fez `*handoff @outro-specialist` direto; retornou para chief | [ ] |
| 1.3 | **Cycle ID match** | Cycle ID no card bate com o ciclo ativo rastreado pelo chief | [ ] |
| 1.4 | **Specialist identity** | Agent que retornou é o mesmo que o chief roteou (não outro) | [ ] |

**Nenhum fail tolerável nesta seção.**

---

## Seção 2 — Output Completeness (BLOQUEADOR)

Verifica se os 5 elementos do output package (V11) estão presentes.

| # | Check | Regra | Pass? |
|---|-------|-------|-------|
| 2.1 | **File List presente** | Seção 1 do card contém lista (mesmo que "nenhum arquivo, read-only") | [ ] |
| 2.2 | **Change Log presente** | Seção 2 do card tem descrição 1-3 parágrafos explicando o quê e por quê | [ ] |
| 2.3 | **Convention Verification presente** | Seção 3 do card tem checklist com itens marcados | [ ] |
| 2.4 | **Deploy Flag presente** | Seção 4 do card declara `safe-to-deploy: yes\|no\|with-caveats` | [ ] |
| 2.5 | **Suggested Next presente** | Seção 5 do card indica `close`, `route_to @X`, `escalate_to_user`, ou `retry` | [ ] |

**Tolerância:** 0 fails (5/5 obrigatório).

---

## Seção 3 — Convention Compliance (BLOQUEADOR se HIGH)

Verifica conformidade com convenções da plataforma PrimeTeam. Checa especificamente o que o specialist DECLAROU no Convention Verification Report — o chief valida cruzando com o File List.

### 3.1 i18n (HIGH — bloqueia)

| # | Check | Regra | Pass? |
|---|-------|-------|-------|
| 3.1.1 | **Strings visíveis usam `t()`** | Nenhuma string JSX visível ao usuário hardcoded | [ ] |
| 3.1.2 | **Chaves em IT + PT-BR** | Novas keys em `src/lib/i18n/it/` E `src/lib/i18n/pt-BR/` | [ ] |
| 3.1.3 | **Namespace correto** | Keys agrupadas no namespace do módulo (`finance.`, `tasks.`, etc.) | [ ] |

### 3.2 Code style (HIGH — bloqueia)

| # | Check | Regra | Pass? |
|---|-------|-------|-------|
| 3.2.1 | **Imports `@/` alias** | Nenhum import relativo dentro de `src/` | [ ] |
| 3.2.2 | **Supabase client oficial** | `from '@/integrations/supabase/client'` (não `createClient` solto) | [ ] |
| 3.2.3 | **Sem URLs hardcoded** | Supabase URL via `import.meta.env.VITE_SUPABASE_URL` | [ ] |
| 3.2.4 | **Forms com react-hook-form + zod** | Se formulário novo: usa pattern completo | [ ] |

### 3.3 UI / Design System (HIGH — bloqueia)

| # | Check | Regra | Pass? |
|---|-------|-------|-------|
| 3.3.1 | **shadcn/ui base** | Componentes novos seguem padrão shadcn (ui primitives) | [ ] |
| 3.3.2 | **ArchPrime DS tokens** | Cores via tokens (`--gold`, `--bg`, etc.), não hex fixos | [ ] |
| 3.3.3 | **Mobile-first** | Testado em viewport 375px ou justificativa (desktop-only flag) | [ ] |

### 3.4 Database / RLS (CRITICAL — bloqueia)

| # | Check | Regra | Pass? |
|---|-------|-------|-------|
| 3.4.1 | **Tabela nova tem RLS** | Se CREATE TABLE: policies adicionadas no mesmo migration | [ ] |
| 3.4.2 | **Migration idempotente** | `DROP POLICY IF EXISTS` + `IF NOT EXISTS` + `DO/EXCEPTION` blocks | [ ] |
| 3.4.3 | **Sem SERVICE_ROLE no client** | Edge Functions: ok. Client code: PROIBIDO | [ ] |

### 3.5 State / Data layer (MEDIUM — warning se fail)

| # | Check | Regra | Pass? |
|---|-------|-------|-------|
| 3.5.1 | **TanStack Query para server state** | Dados do Supabase via hooks TanStack, não useState direto | [ ] |
| 3.5.2 | **Cache bust pós-mutation** | Mutations chamam `invalidateQueriesWithDelay()` apropriado | [ ] |
| 3.5.3 | **Persistência de preferências** | Tabs/filtros usam `usePersistedTab` ou `usePersistedState` | [ ] |

### 3.6 Secrets (CRITICAL — bloqueia)

| # | Check | Regra | Pass? |
|---|-------|-------|-------|
| 3.6.1 | **Nenhum secret no código** | Busca por padrões: `sbp_`, `sk_live_`, `eyJ...` (JWT), `SERVICE_ROLE` | [ ] |
| 3.6.2 | **`.env.example` atualizado** | Se novas vars adicionadas: exemplo inclui (valores fake) | [ ] |
| 3.6.3 | **`.gitignore` protege session** | `~/.primeteam/session.json` nunca entra em diff | [ ] |

---

## Seção 4 — Status Machine Update (BLOQUEADOR)

| # | Check | Regra | Pass? |
|---|-------|-------|-------|
| 4.1 | **Estado atual válido** | Ciclo está em `[Triaged, Routed, InProgress, Returned, Validated, Done]` | [ ] |
| 4.2 | **Transição correta** | Specialist retornou → estado vai de `InProgress` para `Returned` | [ ] |
| 4.3 | **CHANGELOG atualizado** | Entry do cycle foi adicionado em `CHANGELOG.md` | [ ] |

---

## Seção 5 — Multi-Domain Handoff (CONDICIONAL)

Aplica **apenas** se o Suggested Next for `route_to @outro-specialist` (trabalho incompleto, próximo agent precisa continuar).

| # | Check | Regra | Pass? |
|---|-------|-------|-------|
| 5.1 | **Contexto explícito** | O que o próximo specialist precisa para começar está no handoff card | [ ] |
| 5.2 | **Nenhuma ambiguidade de escopo** | Próximo specialist sabe onde começa e termina | [ ] |
| 5.3 | **Serial, não paralelo** | Só 1 specialist de cada vez (paralelo via chief só em casos documentados) | [ ] |

---

## Decisão do Verdito

### PASS (avança)

Todas as seguintes condições:
- ✅ Seção 1: **4/4**
- ✅ Seção 2: **5/5**
- ✅ Seção 3: **todos HIGH e CRITICAL passam** (MEDIUM pode ter 1-2 warnings documentados)
- ✅ Seção 4: **3/3**
- ✅ Seção 5: **3/3** (se aplicável)

**Ação:**
1. Atualizar CHANGELOG.md com Cycle ID + resumo
2. Se `suggested_next = close`: finalizar ciclo, responder ao usuário
3. Se `suggested_next = route_to @X`: iniciar próximo handoff

### REJECT (retorna ao specialist)

Qualquer uma das condições:
- ❌ Seção 1 tem algum fail (protocol quebrado)
- ❌ Seção 2 tem algum fail (output incompleto)
- ❌ Seção 3 tem fail em HIGH ou CRITICAL
- ❌ Seção 4 tem fail (status machine quebrado)

**Ação:**
1. Gerar **Gate Report** listando os fails específicos
2. Retornar ao specialist: `"Reject. Gate falhou em: [1.1, 3.1.1, 3.4.1]. Ver gate report."`
3. Specialist corrige e re-handoff

### ESCALATE (pausa, consulta usuário)

Se:
- ⚠️ Specialist retornou com `suggested_next = escalate_to_user`
- ⚠️ Há ambiguidade sobre next step que o chief não consegue resolver
- ⚠️ Múltiplos ciclos consecutivos em REJECT (specialist não consegue passar)

**Ação:**
1. Pausar ciclo (estado fica `Returned`)
2. Resumir situação ao usuário
3. Pedir decisão

---

## Gate Report Template (quando REJECT)

```markdown
## Handoff Quality Gate — REJECT

**Cycle ID:** cyc-2026-04-22-001
**Specialist:** @platform-specialist
**Verdict:** REJECT
**Timestamp:** 2026-04-22T14:30:00Z

### Fails detectados

- **1.1 Announcement regex:** Texto começa com "Tarefa completa" em vez do formato prescrito
- **3.1.1 Strings visíveis usam t():** `NewTransactionForm.tsx:42` tem string hardcoded `"Valor"`
- **3.1.2 Chaves em IT + PT-BR:** Chave `finance.newTransaction.amount` existe só em IT

### Ação requerida

1. Corrigir announcement para: `Retornando ao @ops-chief. {seu trabalho} concluído.`
2. Envolver string em `t('finance.newTransaction.amountLabel')`
3. Adicionar chave em `src/lib/i18n/pt-BR/finance.ts`

Após correção, retornar com novo handoff card.
```

---

## Logging

Toda execução do gate (PASS, REJECT, ESCALATE) é registrada em:
- `CHANGELOG.md` do squad (resumido)
- Sessão do Claude Code (full gate report)

Métricas agregadas úteis:
- Taxa de PASS no primeiro try
- Specialists com mais REJECTs (indica refinamento de instrução necessária)
- Tempo médio para PASS após REJECT

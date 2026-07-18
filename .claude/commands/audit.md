---
description: Loop auditoria → smoke test (dados) → smoke test visual, fase por fase, até TUDO 100% executado, testado e funcionando
---

Execute o escopo abaixo em **LOOP DE AUDITORIA + SMOKE TEST + SMOKE TEST VISUAL**, fase por fase, e **só pare quando TUDO estiver 100% executado, testado e funcionando como o usuário vai ver/usar**. Vale para qualquer situação: feature nova, fix, refator, auditoria de algo existente.

Escopo / tarefa: $ARGUMENTS

## Regra de ouro (não-negociável)

NUNCA diga "pronto", "funciona", "feito" ou equivalente sem ter **VISTO o resultado real** renderizado/retornado exatamente como o usuário vê. Build/lint/typecheck passar, ou "deve funcionar", **NÃO é smoke test** — é pré-requisito. Só conta "eu vi funcionar". (Regra ⛔ do CLAUDE.md.)

## Passo 1 — Auditar o escopo e quebrar em fases

- Liste TUDO que precisa estar feito **e funcionando** para o escopo estar 100%. Inclua a sub-visão concreta que foi pedida (a tabela, o card, a coluna, o número específico), não só "a página abre".
- Quebre em **fases verificáveis** — cada fase é um pedaço testável de ponta a ponta. Registre as fases (lista de tarefas) para não perder nenhuma.
- Para cada fase, defina o **critério de aceite objetivo**: o que exatamente tem de estar verdadeiro (dado / elemento / comportamento) para a fase estar fechada.

## Passo 2 — Loop por fase (NÃO avance sem fechar a fase)

Para CADA fase, em ordem:

1. **Executar** a fase (implementar / corrigir).
2. **Pré-requisitos** (portão de entrada, não é o teste): build/lint/typecheck passam. Se mexeu em backend / edge function / migration, faça o deploy conforme a regra do repo (branch + commit + push + PR); se mexeu em front, reinicie o dev server. Isso habilita o teste — não substitui.
3. **Smoke test de dados/backend**: query REST / RPC / SQL real confirmando o número ou o comportamento esperado.
4. **Smoke test VISUAL autenticado**: abra a tela **EXATA** que o usuário usa (Playwright autenticado — siga a regra de login/smoke do repo em `CLAUDE.md` e `.claude/rules/`) e confira o elemento / campo / coluna / dado específico que foi pedido. Screenshot + extração do valor real. Teste no ambiente **deployado / produção** quando aplicável — o usuário olha produção.
5. **Gate da fase** — o resultado bate 100% com o critério de aceite?
   - **NÃO** → conserte e volte ao passo 3 desta fase. Repita em **LOOP** até bater. Nunca avance com fase "quase certa" (faltou um campo, número errado, não respeitou parte do pedido).
   - **SIM** → marque a fase como **concluída-e-verificada** e vá para a próxima.

## Passo 3 — Verificação final (anti-regressão)

- Com todas as fases fechadas, re-confira o conjunto de ponta a ponta **uma vez** — o fix de uma fase não pode ter quebrado outra.
- Percorra os critérios de aceite do Passo 1, um por um, confirmando cada um com evidência real.

## Passo 4 — Só então reporte

Reporte de forma honesta e concreta:
- Cada fase e o que foi conferido nela: **esperado vs. visto**, com o valor real observado.
- Evidências do smoke visual (screenshots / valores extraídos).
- Veredito: **100% ✅ com evidência** — ou, se algo ficou de fora, diga exatamente **o quê e por quê** (nunca maquie um "pronto").

Se em qualquer ponto você travar de verdade (falta credencial, decisão de escopo genuinamente ambígua), **pare e pergunte** — não invente "pronto".

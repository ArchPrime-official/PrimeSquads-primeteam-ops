# Como usar o primeteam-ops no dia a dia

Guia prático, por papel, com exemplos reais de conversa. **Você não precisa saber programar** — só digitar em português.

> 💡 **Dica de ouro:** você não memoriza comandos. Você simplesmente **descreve o que quer** e o chief te conecta com o especialista certo.

---

## Antes de tudo — rotina de todo dia

Quando você abrir o terminal de manhã, rode **um comando só**:

```
pto
```

Isso verifica atualizações, renova seu acesso se for preciso, e te mostra onde parou ontem. Se for a primeira vez, roda `pto setup` (o passo-a-passo).

Depois, abra o Claude Code:

```
claude
```

E ative o chief digitando:

```
/pto:agents:ops-chief
```

Pronto — agora você só conversa.

---

## Marketing — Sandra 🎨

### Criar uma landing page nova

**Conversa no Claude:**

> **Você:** quero criar uma landing page para o evento Immersione Roma 2026, slug `immersione-roma-2026`
>
> **Chief:** Vou te conectar com o content-builder. Só confirmo: o slug `immersione-roma-2026` está livre, ok?
>
> **Você:** sim
>
> **Chief:** Pronto — estrutura criada, página ficou em **rascunho (desativada)**. Quer que eu abra no editor web para você colocar o conteúdo, ou prefere que o content-builder já preencha com o template de evento?

**Comandos úteis:**
- "criar landing page para {nome do evento}"
- "atualizar a LP {slug} com o novo texto"
- "listar todas as LPs do evento X"

### Ver campanhas Meta Ads

> **Você:** me mostra as campanhas Meta do último mês
>
> **Chief:** Conecto com o integration-specialist. Algum filtro (ativas, performando mal, só Roma)?
>
> **Você:** só as ativas

Resposta típica: lista com nome, orçamento, gastos, CPL — **com badge** nas que estão performando abaixo do esperado.

> ⚠️ **Lembre:** o squad só **mostra** os dados e sinaliza problemas. **Decisões estratégicas** (pausar, aumentar orçamento, criar campanha nova) você decide com o `/metaAds:ralph-burns` ou no próprio Gerenciador Meta.

### Subir uma campanha Meta nova (bulk-upload)

> ⚠️ **`pto meta-upload` está quebrado** (2026-06-12) — depende de submodule privado inacessível. Use os scripts locais abaixo.

Scripts em `scripts/meta-ads/` do repo PrimeTeam:

| Script | Quando usar |
|---|---|
| `resolve-meta-token.py` | Sempre — resolve `META_ACCESS_TOKEN` via sessão `pto` |
| `next-campaign-number.py` | Sempre — calcula próximo NUM `[XXX]` |
| `upload-camp-existing-creatives.py` | Reusar `creative_id` já existente (sem upload de arquivo) |
| `upload-lancio-mag26-2026-05-13.py` | Upload com arquivos novos (vídeo/imagem do disco) |

**Fluxo padrão:**
```bash
cd /Users/sandracarvalho/primeteam
git pull origin main
pto whoami    # sessão expirada? → pto refresh | ausente? → pto login

export META_ACCESS_TOKEN=$(python3 scripts/meta-ads/resolve-meta-token.py)

# Antes de --execute: sempre dry-run
python3 scripts/meta-ads/next-campaign-number.py
python3 scripts/meta-ads/upload-camp-existing-creatives.py --config <cfg>.json --dry-run

# Subir PAUSED, validar no Ads Manager, depois ativar
python3 scripts/meta-ads/upload-camp-existing-creatives.py --config <cfg>.json --execute
python3 scripts/meta-ads/upload-camp-existing-creatives.py --config <cfg>.json --execute --activate
```

> ⚠️ **NÃO** use `SB_PASSWORD` em env var nem em commits. Sempre `pto login` + `resolve-meta-token.py`.

---

## Financeiro — Joyce, Larissa, Adriana 💰

### Lançar um pagamento

> **Você:** lançar um pagamento de 250€ pra Jessica — bônus
>
> **Chief:** Vou confirmar com o platform-specialist:
> - valor: 250€
> - descrição: "Bonus Jessica"
> - categoria: Equipe
> - data: hoje (23/04/2026)
>
> Posso lançar?
>
> **Você:** sim
>
> **Chief:** ✅ Lançado. ID `tx-8f3a2c`. Aparece na plataforma em ~1s.

### Ver saldos Revolut

> **Você:** me mostra os saldos Revolut agora
>
> **Chief:** Conecto com o integration-specialist...

Resposta: saldos EUR/BRL/USD, **sinalizando** se a última sincronização tem mais de 15min.

> ⚠️ **Lembre:** o squad **mostra saldos** mas **nunca faz transferências**. Movimentação de dinheiro é sempre pela app do Revolut (com 2FA).

### Listar pagamentos recorrentes

> **Você:** quais pagamentos recorrem todo dia 15?
>
> **Chief:** (mostra lista)

### Conciliar uma transação

> **Você:** a transação de 1200€ de ontem — concilia com a fatura INV-458

---

## Comercial — Miriam, Daniel, Yuri 📞

### Criar um lead novo

> **Você:** novo lead: Maria Silva, maria@empresa.com, interessada no evento de Roma
>
> **Chief:** Criado (ID `l-88c1`). Campanha origem (para tracking) — quer atribuir a `Immersione Roma 2026`?

### Mover uma oportunidade no funil

> **Você:** move a oportunidade da Maria Silva pra "Proposta Enviada"
>
> **Chief:** Encontrei a oportunidade de "Maria Silva" criada há 3 dias no estágio "Contato Inicial". Mover para "Proposta Enviada"?
>
> **Você:** sim

### Ver quem vai te ligar hoje

> **Você:** quais chamadas eu tenho agendadas pra hoje?

### Disparar chamada AI

> **Você:** liga pro lead 88c1 com o script de follow-up
>
> **Chief:** ⚠️ Essa chamada é **automática via AI** (VAPI). Custa ~€0,15 e acontece imediatamente. Confirma?

---

## Customer Success — Jessica, Andrea 🌱

### Listar estudantes por saúde

> **Você:** me mostra os estudantes em risco (health score baixo)
>
> **Chief:** (lista com health score + último check-in)

### Ver onboardings pendentes de aprovação

> **Você:** quais submissões de onboarding estão esperando aprovação?

### Marcar check-in

> **Você:** marca check-in que fiz hoje com o Lucas Ferrari — tudo bem, ele gostou do último módulo

---

## Owner — Pablo 👑

Você tem acesso a tudo acima, mais:

### Ver o log de atividade do squad

> **Você:** mostra as mutations do squad nas últimas 24h

### Adicionar um novo colaborador

> **Você:** adiciona a Anna Rossi como financeiro — anna@archprime.io
>
> **Chief:** ⚠️ Operação **OWNER-ONLY**. Vou passar pro admin-specialist. Confirma criar usuário Anna Rossi com papel `financeiro`?

### Importar dados em massa (CSV)

> **Você:** preciso importar um CSV com 250 leads novos
>
> **Chief:** O imports-specialist vai fazer. Primeiro roda em **modo simulação** (não grava nada), te mostra um resumo, e aí você aprova.

---

## Erros comuns e como resolver

### "você não está logado"

Roda:
```
pto login
```

### "sua sessão expirou"

Roda:
```
pto refresh
```

Se o refresh não funcionar (raro — acontece se você deslogou de outro computador), roda `pto login` de novo.

### "a porta de login está ocupada"

Alguém (outro terminal, VS Code, Docker) está usando a porta 54321. Feche a outra janela e tente de novo. Se não souber identificar, reinicie o computador.

### "não consegui me conectar"

Sua internet caiu, ou o servidor do Supabase está fora. Espere 1 minuto. Se continuar, avise o Pablo.

### "pto: command not found" (após git pull)

Você atualizou o repo mas não rebuildou o `pto`. Rode:
```bash
cd squads/primeteam-ops && npm install && npm run build
```

### `pto meta-upload` diz "sua conta não tem role marketing/admin/owner"

Sua role no PrimeTeam está faltando. Avise o Pablo no Slack `#tech` para te adicionar como `marketing` em `user_roles`.

### `pto meta-upload` diz "account not found for ad_account_id=X"

A conta Meta que você passou em `--account` (ou que está no `config["meta"]["ad_account_id"]`) não está cadastrada em `meta_ad_accounts`. Avise o Pablo — ele cadastra via UI.

### Qualquer outro erro

Rode:
```
pto doctor
```

Copia o resultado, cola no Slack no canal `#tech`. Pablo lê e resolve.

---

## Coisas que o squad **NÃO** faz (de propósito)

- ❌ **Transferir dinheiro** via Revolut — sempre pela app com 2FA.
- ❌ **Decidir estratégia** — o squad executa, os squads de expertise pensam.
- ❌ **Criar campanhas Meta do zero** — use o Gerenciador de Anúncios Meta.
- ❌ **Escrever copy** (emails, LPs) — use `/videoCreative` ou `/metaAds:ezra-firestone`.
- ❌ **Apagar coisas sem confirmação dupla** — sempre pergunta antes.

---

## Quando chamar outro squad

| Situação | Squad |
|----------|-------|
| **Executar** algo na plataforma (criar, listar, mover) | `/pto` (este) |
| **Pensar estratégia** Meta Ads | `/metaAds` |
| **Pensar estratégia** de negócio | `/stratMgmt` |
| **Melhorar** a plataforma (código, design) | `/ptImprove` |
| **Criar** vídeos/storytelling | `/videoCreative` |

**Regra simples:** "os squads de expertise **pensam**. O primeteam-ops **faz**."

---

## Ficou perdida/o?

Rode `pto doctor` e cole no Slack pedindo ajuda. Ou fale direto com a Pablo.

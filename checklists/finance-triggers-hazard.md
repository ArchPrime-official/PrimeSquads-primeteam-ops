# Finance Triggers — Hazard Checklist

> Checklist OBRIGATÓRIO antes de qualquer UPDATE em massa (ou script de correção) sobre `finance_transactions`. Três triggers da tabela têm efeitos colaterais que corrompem dados silenciosamente. Consultar ANTES de executar — não depois de estragar.

**Mantido por:** quality-guardian
**Origem:** incidente 2026-06-30 (converted_amount corrompido em massa, pego e revertido via audit_log).

---

## Os 3 triggers perigosos de `finance_transactions`

| Trigger | O que faz | Perigo |
|---------|-----------|--------|
| `trg_recompute_converted_on_update` | Ao mudar `amount`, `card_amount` ou `currency`, recomputa `converted_amount` pela taxa de câmbio | **Corrompe valores manuais.** Um `converted_amount` ajustado à mão é sobrescrito pela taxa automática. Um UPDATE de massa que toque `amount`/`card_amount`/`currency` reconverte TUDO. |
| `auto_link_transaction_to_invoice` | Ao tocar QUALQUER campo da linha, tenta linkar a transação a uma fatura órfã compatível | **Suga fatura errada.** Um UPDATE despretensioso (ex: mudar uma nota) pode vincular a transação a uma fatura órfã não relacionada. |
| `handle_commercial_sale_pending_transactions` | Dispara a previsão de entrada (pending) de venda comercial | **Cria previsão fantasma.** Ao mexer numa linha de venda, pode disparar/duplicar a previsão de entrada. |

---

## Regra de ouro (antes de UPDATE em massa)

1. **DISABLE cirúrgico, nunca em bloco.** Desabilitar SÓ o trigger específico que interfere:

   ```sql
   ALTER TABLE finance_transactions DISABLE TRIGGER trg_recompute_converted_on_update;
   -- ... UPDATE em massa ...
   ALTER TABLE finance_transactions ENABLE TRIGGER trg_recompute_converted_on_update;
   ```

   ❌ **NUNCA** `DISABLE TRIGGER USER` (desliga TODOS os triggers de usuário de uma vez, incluindo `updated_at`, RLS-adjacentes, e os que você nem sabia que existiam). Sempre nomear o trigger exato.

2. **Sempre dentro de transação + backup.** `BEGIN; ... COMMIT;` com um `SELECT` de conferência no meio; ou snapshot da(s) linha(s) afetada(s) antes.

3. **Ao reverter, corrigir os DOIS campos.** Se um UPDATE corrompeu `converted_amount`, restaurar `amount` E `converted_amount` — não só um. Fonte de verdade da reversão: `finance_audit_log` (ou o snapshot pré-UPDATE).

4. **Dry-run primeiro.** `SELECT` das linhas que o `WHERE` vai atingir, conferir a contagem, só então rodar o `UPDATE`.

---

## Vocabulários distintos (não confundir)

`finance_transactions` e `finance_pending_transactions` são tabelas DIFERENTES com **status distintos** — misturar os vocabulários leva a queries/updates errados:

| Tabela | Valores de `status` |
|--------|---------------------|
| `finance_transactions` | `completed`, `predicted`, `delayed`, `cancelled` |
| `finance_pending_transactions` | `pending`, `paid`, `predicted` |

Ex: filtrar `status = 'paid'` em `finance_transactions` não retorna nada (esse valor vive só na tabela de pending). Confira em qual tabela você está antes de escrever o `WHERE`.

---

## Checklist de execução

- [ ] Identifiquei QUAIS dos 3 triggers meu UPDATE dispara (toco `amount`/`card_amount`/`currency`? toco qualquer campo? é linha de venda comercial?)
- [ ] `DISABLE TRIGGER <nome_específico>` (nunca `USER`) só para os que preciso silenciar
- [ ] Dry-run `SELECT` conferindo a contagem de linhas afetadas
- [ ] UPDATE dentro de transação, com snapshot/backup das linhas
- [ ] `ENABLE TRIGGER <nome_específico>` de volta ao final
- [ ] Se reverter: corrigi `amount` E `converted_amount`, com fonte no `finance_audit_log`
- [ ] Conferi que estou na tabela certa (`finance_transactions` vs `finance_pending_transactions`) para o `status` usado

# Relatório de validação da entrega

Data da validação: 05/11/2026

## Verificações executadas

- `node --check app-config.js`: aprovado.
- `node --check assets/public-orders.js`: aprovado.
- `node --check admin/admin.js`: aprovado.
- TypeScript das quatro Edge Functions/shared modules foi analisado pelo `tsc --noEmit`, com declarações locais mínimas para os tipos de runtime Deno e o módulo Supabase. Não foram reportados erros de sintaxe ou tipos no código da aplicação.
- `npm test`: 7 testes aprovados, 0 falhas.
- Suíte SQL `supabase/tests/rls_connecta.test.sql` criada com 15 verificações de grants e RLS; não executada neste ambiente, pois não há Supabase CLI/PostgreSQL local.
- Parsing estrutural de `index.html` e `admin/index.html`: aprovado; ambos têm estrutura HTML e não apresentam IDs duplicados.
- Conferência estática de IDs: 61 referências no painel e 26 no formulário, sem referências a IDs ausentes.
- Conferência do frontend: nenhum token Meta, service-role key ou senha foi encontrado no código de navegador. A configuração pública permanece vazia até receber os dados reais do projeto.
- Cópia do HTML institucional anterior incluída em `backup/` para facilitar reversão.

## Testes que dependem de ambiente externo

Não foi possível executar a migração no PostgreSQL/Supabase, publicar Edge Functions, autenticar uma conta real, fazer upload no Storage, receber eventos Realtime ou enviar uma mensagem Cloud API. O ambiente de execução não contém Deno nem Supabase CLI, e a entrega não recebeu URL/chave de um projeto Supabase nem credenciais/telefone/template aprovados da Meta.

O teste automatizado de interface ponta a ponta em navegador também não foi concluído neste ambiente. Portanto, os testes aprovados acima são validações locais de código, contrato e estrutura, não um atestado de funcionamento em produção.

## Antes de colocar em produção

1. Criar e vincular um projeto Supabase e aplicar a migração SQL.
2. Configurar `app-config.js` com URL e publishable key reais.
3. Cadastrar o primeiro usuário em Supabase Auth e autorizá-lo em `admin_users`.
4. Configurar `CORS_ALLOWED_ORIGINS` e `PUBLIC_RATE_LIMIT_SALT` e publicar as Edge Functions.
5. Configurar o telefone comercial no frontend para habilitar o fallback `wa.me`.
6. Para envio automático, configurar os secrets Meta e um template aprovado com oito variáveis.
7. Configurar domínio/HTTPS, URL de recuperação de senha e política de privacidade da Connecta.

Nenhum pedido real foi criado e nenhuma mensagem foi enviada nesta entrega.

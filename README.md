# Connecta Instalações | Plataforma de pedidos e painel administrativo

Este projeto preserva o site institucional existente e acrescenta um fluxo real de solicitação de serviços e uma área administrativa. O frontend continua sem build obrigatório: HTML, CSS e JavaScript simples. O backend usa Supabase (PostgreSQL, Auth, Storage, Realtime e Edge Functions).

## O que está implementado

- Site público preservado, com o formulário substituído por solicitação estruturada: seleção de vários serviços, dados do cliente, empresa opcional, telefone/WhatsApp, e-mail, local da execução, preferência de contato, descrição, anexos e aceite de uso dos dados.
- Etapa de revisão antes do registro e confirmação com número único `CON-000001`.
- Criação de pedido por Edge Function. O banco grava cliente, pedido, itens, histórico inicial e notificação pendente em uma única função transacional PostgreSQL.
- Chave de idempotência por envio para não criar um segundo pedido quando a resposta da primeira chamada se perde e o navegador repete a requisição.
- Painel `/admin/` com login Supabase Auth, bloqueio por vínculo ativo em `admin_users`, cards, distribuição por status, atividades, tabela pesquisável, filtros de status/data, ordenação e paginação.
- Detalhes do pedido, anexos privados, atualização de status por RPC, observações internas e histórico com administrador responsável.
- Supabase Realtime para refletir novas solicitações e movimentações sem recarregar o painel.
- Outbox de WhatsApp com estado, tentativas, erro, backoff e ação administrativa de reenvio. A Cloud API só envia quando as credenciais e o template aprovado estão configurados no backend.
- Alternativa manual: link `wa.me` com mensagem pré-preenchida. Abrir o link não envia a mensagem; o operador precisa conferir e confirmar o envio no WhatsApp.
- Políticas RLS, bucket privado, validação no servidor, limite de solicitações por origem, honeypot, limite/tipo/assinatura dos anexos e chaves privilegiadas exclusivamente no backend.

Os anexos aceitos são JPEG, PNG, WebP, PDF e DOCX, com até cinco arquivos e 5 MB no total. A função confere extensão, MIME e assinatura inicial, mas **não executa antivírus/antimalware**; para operação com documentos de alto risco, integre um scanner antes de disponibilizar a abertura dos arquivos.

## Estrutura

```text
connecta-plataforma/
├── index.html                       # Site institucional preservado + formulário novo
├── app-config.js                    # URL Supabase, chave pública e WhatsApp comercial
├── assets/public-orders.js          # Revisão, validação e envio do formulário
├── admin/
│   ├── index.html                   # Rota /admin/
│   ├── admin.css                    # Visual do painel responsivo
│   └── admin.js                     # Auth, consultas, realtime e ações administrativas
├── supabase/
│   ├── config.toml
│   ├── migrations/                  # Modelo relacional, RLS, RPCs e bucket privado
│   └── functions/
│       ├── _shared/                 # CORS, validação, autenticação e WhatsApp
│       ├── create-order/            # Recebe solicitação pública
│       └── retry-notification/      # Reenvio autenticado pelo administrador
├── tests/                           # Testes automatizados da validação de pedidos
└── package.json
```

## Configuração obrigatória do Supabase

### 1. Criar e vincular o projeto

Crie um projeto Supabase próprio da Connecta. Instale Docker e Supabase CLI e, na pasta deste projeto, execute:

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

A migração `supabase/migrations/202611050001_connecta_orders.sql` cria o catálogo de serviços, clientes, administradores, pedidos, itens, anexos, histórico, observações, outbox de notificações, tentativas, rate limit, funções RPC, políticas RLS e bucket privado.

O projeto precisa permitir acesso ao schema `public` pela Data API do Supabase. As permissões SQL e RLS da migração são o controle de acesso efetivo. Não crie políticas públicas de leitura/escrita para pedidos.

### 2. Conectar o frontend

Edite `app-config.js`:

```js
window.CONNECTA_CONFIG = Object.freeze({
  supabaseUrl: 'https://SEU_PROJECT_REF.supabase.co',
  supabaseAnonKey: 'SUA_PUBLISHABLE_KEY',
  businessWhatsAppPhone: '55DDDNUMERO',
  maxFiles: 5,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalFileBytes: 5 * 1024 * 1024,
});
```

Use a publishable key (ou a chave `anon` legada). Ela é pública por definição e só deve ser usada com RLS ativo. **Nunca** use `service_role`, `secret key`, token Meta ou senha neste arquivo.

### 3. Cadastrar o primeiro administrador

1. No Supabase, abra Authentication e crie/invite o usuário administrador com o e-mail corporativo. Não disponibilize cadastro público de administradores.
2. Copie o UUID do usuário em Authentication > Users.
3. Execute no SQL Editor, trocando o UUID e o nome:

```sql
insert into public.admin_users (user_id, display_name, active)
values ('UUID-DO-USUARIO-AUTORIZADO', 'Administrador Connecta', true);
```

Somente usuários presentes em `admin_users` com `active = true` passam da autenticação para o painel. Para revogar acesso, defina `active = false` ou remova o vínculo. Use recuperação de senha do Supabase Auth para administrar credenciais.

### 4. Publicar Edge Functions

Configure os segredos de produção no Supabase Dashboard > Edge Functions > Secrets ou via CLI. As variáveis reservadas `SUPABASE_URL` e chaves de serviço são fornecidas pelo Supabase no runtime. Não publique nem copie a chave de serviço para o navegador.

Configure pelo menos a lista de origens e um salt aleatório privado (mínimo de 24 caracteres):

```bash
npx supabase secrets set CORS_ALLOWED_ORIGINS="https://seudominio.com.br,https://www.seudominio.com.br" PUBLIC_RATE_LIMIT_SALT="GERE_UM_SEGREDO_ALEATORIO_LONGO"
```

Depois publique:

```bash
npx supabase functions deploy create-order --no-verify-jwt
npx supabase functions deploy retry-notification
```

`create-order` é pública por necessidade do formulário, mas aplica lista de origens, rate limit no banco, honeypot, validação rígida, tamanho/tipo de arquivo e gravação por service role. `retry-notification` exige JWT válido e confere o vínculo ativo em `admin_users` no backend.

Para desenvolvimento local, copie `supabase/functions/.env.example` para `supabase/functions/.env`, preencha os valores locais e não versiona esse arquivo. Não use segredos reais no ambiente de demonstração.

## Configuração do WhatsApp Business Cloud API

Para envio automático real, configure as credenciais somente em Supabase Edge Function Secrets:

```text
WHATSAPP_TOKEN=token_de_acesso_da_meta
WHATSAPP_PHONE_NUMBER_ID=id_do_numero_na_cloud_api
WHATSAPP_NOTIFY_TO=55DDDNUMERO_QUE_RECEBE_ALERTAS
WHATSAPP_TEMPLATE_NAME=connecta_novo_pedido
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
WHATSAPP_GRAPH_API_VERSION=vXX.X
```

`WHATSAPP_GRAPH_API_VERSION` deve ser uma versão Graph API ainda suportada pela Meta no momento da implantação. Não copie uma versão antiga sem verificar no painel/documentação Meta.

Crie e obtenha aprovação de um template de utilidade na conta WhatsApp Business com o nome configurado e **oito variáveis de texto na ordem abaixo**, pois a Edge Function preenche os parâmetros nessa sequência:

```text
NOVO PEDIDO | CONNECTA INSTALAÇÕES
Pedido: {{1}}
Cliente: {{2}}
Empresa: {{3}}
Telefone: {{4}}
Serviços: {{5}}
Descrição: {{6}}
Local: {{7}}
Status: {{8}}
```

A Cloud API não é considerada ativa apenas porque os campos existem: é preciso ter WABA/telefone habilitado, token válido, template aprovado e destinatário no formato internacional. A função grava o resultado e o identificador retornado pelo provedor. Falhas explícitas são registradas e recebem intervalo de espera exponencial. Em timeout ou erro HTTP 5xx, o resultado pode ser indeterminado; o painel solicita conferência humana antes de reenviar para reduzir duplicidade.

### Fallback manual

Se a Cloud API não estiver configurada, a notificação fica como `manual_required`. O administrador pode abrir o WhatsApp comercial com a mensagem pré-preenchida, desde que `businessWhatsAppPhone` esteja preenchido no `app-config.js`, e confirmar o envio manualmente. Essa alternativa **não** é envio automático nem altera o status para enviado.

## Hospedagem do frontend

Publique o conteúdo desta pasta na raiz do domínio institucional. O arquivo `admin/index.html` atende `/admin/` em hospedagens estáticas com suporte a diretórios. Em hospedagem que não faça essa resolução automaticamente, configure a regra de rewrite equivalente a:

```text
/admin  /admin/index.html  200
```

A URL exata do site deve constar em `CORS_ALLOWED_ORIGINS`. Configure também a URL do site em Supabase Auth > URL Configuration para que a recuperação de senha retorne a `/admin/`.

Teste em HTTPS na produção, principalmente upload privado, login e links de recuperação.

## Testes disponíveis e limitações atuais

Execute os testes locais de validação e a suíte SQL de permissões:

```bash
npm test
npx supabase test db
```

A suíte `supabase/tests/rls_connecta.test.sql` verifica os grants e a ativação de RLS em papéis `anon`, `authenticated` e `service_role`. Para uma auditoria completa de produção, ainda é necessário testar leitura negada/liberada com usuários reais de teste (administrador ativo, administrador desativado e visitante), além de validar o Storage e as rotas após publicar.

Eles cobrem solicitações válidas, campos obrigatórios, serviço inválido, serviços duplicados, consentimento, preferência de contato, normalização de e-mail/telefone e limites de tamanho.

Também foi feita verificação estática de sintaxe JavaScript e integridade HTML no pacote entregue. Testes end-to-end de persistência real, login real, realtime no projeto, Storage e WhatsApp Cloud API **dependem de um projeto Supabase e credenciais externas**. Nenhum pedido real foi inserido e nenhuma mensagem real foi enviada nesta entrega.

A entrega não configura domínio, projeto Supabase, conta Meta, número de telefone, template aprovado ou política de privacidade pública. Antes de operação, a Connecta deve revisar sua política de privacidade, informar canal de contato para titulares, prazo de retenção e base legal adequada ao tratamento de dados, além de restringir a administração a pessoas autorizadas.

## Observação sobre notificações

Há uma única linha de outbox por pedido/canal/evento e um claim atômico antes do envio, evitando envios concorrentes duplicados. Nenhum sistema consegue garantir exatamente uma entrega quando o provedor aceita uma mensagem mas a conexão cai antes da confirmação; nesses casos o status vira `manual_required` para conferência antes de uma nova tentativa.

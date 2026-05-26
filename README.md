# Portal Scraper — Documentação do Projeto

Bot do Discord que automatiza tarefas no **Portal Softcom** (`portal.softcomservices.com`) usando Puppeteer. O usuário dispara comandos slash no Discord (`/adicionar-produto`, `/gerar-chave-nuvem`, etc.) e o bot opera o portal em um navegador Chrome controlado, devolvendo o resultado em embeds.

O diferencial do projeto é um **pool de 5 abas** que permite atender várias solicitações ao mesmo tempo, cada usuário em uma aba isolada.

---

## 1. Arquitetura geral

O projeto tem dois módulos principais:

| Arquivo | Papel |
|---------|-------|
| `Bot.js` | Camada Discord. Registra comandos slash, recebe interações dos usuários, formata respostas (embeds) e delega o trabalho pesado ao serviço. |
| `PuppeteerService.js` | Camada de automação. Controla o navegador, o pool de abas, o login no portal e todas as operações de scraping (pesquisar, abrir detalhes, adicionar produto, gerar chave). |

O fluxo de dependência é simples: `Bot.js` importa e instancia `PuppeteerService`. Toda a lógica de navegador fica encapsulada no serviço; o bot nunca fala diretamente com o Puppeteer.

```
Usuário (Discord)
      │  comando slash
      ▼
   Bot.js  ── valida, deferReply, monta embed
      │  chama método público
      ▼
PuppeteerService  ── reserva aba do pool, opera o portal, libera aba
      │  retorna { success, message, data }
      ▼
   Bot.js  ── monta embed final e responde ao usuário
```

---

## 2. Conceito central: o pool de abas

O coração do projeto é o pool. Em vez de abrir e fechar um navegador a cada comando (lento e pesado), o serviço mantém **um único navegador com 5 abas (`MAX_TABS = 5`) já logadas e prontas**.

Cada aba é um objeto com este formato:

```js
{
  id: 1,                // 1 a 5
  page: <Page>,         // objeto Page do Puppeteer
  busy: false,          // true enquanto uma operação usa a aba
  lastUsed: null,       // timestamp do último uso
  currentUser: null,    // ID do usuário Discord que reservou
  status: 'ready'       // idle | logging_in | ready | working | error
}
```

Quando chega um comando, o serviço **reserva** uma aba livre, executa a tarefa nela e depois a **libera** de volta para o pool. Como há 5 abas, até 5 usuários podem ser atendidos simultaneamente. Se todas estiverem ocupadas, o usuário recebe a mensagem "sessões ocupadas, tente mais tarde".

### Por que isso exige cuidado com concorrência

Como as 5 abas compartilham o mesmo navegador, certas operações do Puppeteer que agem em nível de navegador (e não de aba) causam conflito quando duas abas as executam ao mesmo tempo. As principais decisões de projeto abaixo existem para evitar esses conflitos:

- **Sem `bringToFront()`**: traria a aba para o foco, e como só uma aba pode estar em foco por vez, as abas brigariam pelo foreground.
- **Sem `page.keyboard`/`page.type`**: o teclado simulado vai para a aba em foco no nível do navegador; duas abas digitando juntas travam uma à outra (erro `Runtime.callFunctionOn timed out`). Toda entrada de texto é feita via `page.evaluate`, que é isolado por aba.
- **Flags anti-throttling no launch**: como as abas ficam em background, o Chrome desaceleraria seus timers/animações; as flags `--disable-background-timer-throttling` e companhia mantêm todas em velocidade normal.
- **`reserveTab` síncrono**: garante que duas solicitações simultâneas não reservem a mesma aba.

---

## 3. `Bot.js` — função por função

### Configuração inicial
Carrega variáveis de ambiente (`.env`): `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`. Cria o cliente Discord com os intents necessários e mantém duas variáveis de estado globais: `puppeteerService` (a instância do serviço) e `isInitialized` (flag de pronto).

### `commands` (array)
Define os comandos slash via `SlashCommandBuilder`:
- **`/listar-clientes`** — lista os clientes do portal.
- **`/adicionar-produto`** — recebe `cnpj` e `produto` (lista fixa de 6 serviços: Nuvem Fiscal API, Relay Server, Tá na Mão, Softcom Backup, Integração Contábil, Drica IA).
- **`/buscar-cliente`** — recebe `nome` e filtra a lista de clientes.
- **`/status`** — mostra o estado do bot e de cada aba do pool.
- **`/gerar-chave-nuvem`** — recebe `cnpj` e `descricao` (opcional) e gera chaves de acesso Nuvem Fiscal.

Os comandos `/iniciar` e `/desligar` estão comentados (a inicialização é automática), mas o tratamento deles ainda existe no handler.

### `registerCommands()`
Registra os comandos slash no servidor Discord (guild) via REST API. Chamado uma vez quando o bot fica online.

### `initPuppeteer()`
Inicializa o serviço Puppeteer **uma única vez**. Cria a instância, chama `init()` (abre navegador e abas) e `loginAllTabs()` (loga todas as abas). Se já estiver inicializado, apenas retorna o status atual. Devolve `{ success, message }` com a contagem de sessões prontas.

### `checkInitialized()`
Guard simples: retorna `true` se o serviço existe e está inicializado. Cada comando chama isso antes de operar, para não falhar caso o portal ainda não tenha subido.

### `client.once('clientReady', ...)`
Disparado quando o bot conecta ao Discord. Registra os comandos e chama `initPuppeteer()` automaticamente — ou seja, o pool já sobe junto com o bot.

### `client.on('interactionCreate', ...)`
O handler central. Para cada comando slash:
1. Verifica se está inicializado.
2. Faz `deferReply()` (avisa ao Discord que a resposta vai demorar — operações de scraping levam segundos).
3. Confere disponibilidade de aba com `hasAvailableTab()` quando aplicável.
4. Chama o método correspondente do serviço.
5. Trata o caso `allBusy` (todas as sessões ocupadas) com um embed amarelo.
6. Monta o embed final (verde = sucesso, vermelho = erro) e responde com `editReply()`.

O bloco `try/catch` externo captura qualquer erro não tratado e responde ao usuário de forma segura, escolhendo entre `reply` e `editReply` conforme o estado da interação.

### `client.login(TOKEN)` e `process.on('SIGINT', ...)`
Conecta o bot e configura o desligamento gracioso: ao receber Ctrl+C, fecha o navegador e destrói o cliente Discord antes de sair.

---

## 4. `PuppeteerService.js` — função por função

### Constantes e `constructor()`
Define URLs do portal, credenciais (de `.env` com fallback) e `MAX_TABS = 5`. O construtor apenas inicializa `browser = null` e `tabs = []`.

### `init()`
Sobe o navegador Chrome e cria o pool:
- `puppeteer.launch(...)` com `headless: 'new'`, caminho do Chrome, `protocolTimeout: 120000` e as flags anti-throttling.
- Cria 5 abas em loop (com 1s de intervalo entre elas), define viewport e as adiciona ao array `tabs` com status `idle`.
- Fecha a aba padrão que o Chrome abre sozinho.

### `loginAllTabs()`
Faz login em todas as abas **em paralelo** (`Promise.all`). Marca cada aba como `logging_in`, chama `loginTab()` e, em caso de sucesso, marca `ready`. Conta e retorna quantas ficaram prontas.

### `loginTab(tab)`
Login em uma aba específica. Navega para a página de clientes; se o portal redirecionou para a tela de login, **preenche usuário e senha via `page.evaluate`** (não `page.type`, para evitar conflito de input entre abas), clica em submit e aguarda a navegação. Por fim chama `navegarParaClientesTab()`.

### `navegarParaClientesTab(tab)`
Garante que a aba esteja na listagem de clientes. Se a URL atual for de login, re-loga. Se não estiver em `/Clientes` (ou estiver numa página de detalhe), clica no menu "Clientes" — ou navega direto pela URL como fallback.

### `getAvailableTab()`
Retorna a primeira aba que esteja **livre e pronta** (`!busy && status === 'ready'`), ou `null`.

### `reserveTab(userId)` — **síncrono de propósito**
Pega uma aba disponível e a marca como ocupada (`busy = true`, `status = 'working'`, registra o usuário). É **intencionalmente síncrono**: como o Node é single-thread, não havendo `await` entre "achar a aba" e "marcá-la ocupada", duas solicitações simultâneas nunca conseguem reservar a mesma aba. Retorna a aba ou `null` se nenhuma estiver livre.

### `releaseTab(tab)`
Devolve a aba ao pool após o uso:
- Remove listeners de `dialog` pendentes (para não interferir na próxima operação).
- Volta para a página de clientes.
- Limpa o campo de pesquisa via `evaluate`.
- Marca `status = 'ready'` e `busy = false`.
- Em caso de erro, tenta recuperar a aba refazendo o login.

### `getPoolStatus()`
Monta um objeto-resumo do pool: total de abas, quantas disponíveis, ocupadas, com erro, e os detalhes de cada uma. Usado pelo comando `/status`.

### `hasAvailableTab()`
Retorna `true` se existe ao menos uma aba livre e pronta. Usado pelo bot para barrar comandos antes de começar quando o pool está cheio.

### `pesquisarClientePorCNPJ(tab, cnpj)`
Pesquisa um cliente no DataTables do portal:
- Normaliza o CNPJ (só números).
- Preenche o campo de busca via `evaluate`, disparando eventos `input`/`keyup`/`change` e, como reforço, chamando a API do DataTables (`.search().draw()`).
- Aguarda os resultados e o fim do loading.
- Lê as linhas da tabela e, importante, **detecta clientes BLOQUEADOS** (badge vermelho ou texto "Bloqueado"), retornando erro nesse caso.
- Retorna o cliente cujo CNPJ bate exatamente; se houver só um resultado, assume que é ele; se houver vários, retorna a lista.

### `abrirDetalhesClientePorCNPJ(tab, cnpj)`
Pesquisa o cliente (reusa a função acima) e clica no botão **Detalhes** da linha correta. Tem várias estratégias de clique (CNPJ exato, ícone, único resultado como fallback) e também reverifica bloqueio. Aguarda a navegação para a página de detalhes do cliente.

### `abrirModalNovoProduto(tab)`
Na página de detalhes, clica no botão **"Novo"** (via `evaluate`) e aguarda o modal abrir. **Não depende da animação CSS** (`.modal.fade.show`): verifica se qualquer `.modal` está funcionalmente visível e, se o modal não aparecer (caso a animação trave), **força a abertura** via `jQuery(target).modal('show')`.

### `adicionarProduto(tab, nomeProduto)`
Dentro do modal, registra um handler para o `dialog` de confirmação (que aceita automaticamente), procura o card do produto pelo nome e clica nele. Aguarda a confirmação do dialog e a navegação. Trata o caso `Execution context was destroyed` como sucesso (acontece quando a página recarrega após adicionar). Se o produto não for encontrado, assume que já estava adicionado.

### `adicionarProdutoParaClientePorCNPJ(userId, cnpj, nomeProduto)` — **método público principal**
Orquestra o fluxo completo de adicionar produto:
1. `reserveTab()` — pega uma aba (ou retorna `allBusy`).
2. `navegarParaClientesTab()` — garante a página certa.
3. `abrirDetalhesClientePorCNPJ()` — acha e abre o cliente.
4. `abrirModalNovoProduto()` — abre o modal.
5. `adicionarProduto()` — adiciona o produto.
6. `releaseTab()` — libera a aba (sempre, mesmo em erro).

### `extrairClientes(userId)` — **método público**
Reserva uma aba, navega para a listagem e extrai **todos** os clientes da tabela (título + CNPJ, normalizando o formato). Libera a aba e retorna a lista. Usado por `/listar-clientes` e `/buscar-cliente`.

### `gerarChaveNuvemFiscalParaClientePorCNPJ(userId, cnpj, descricao)` — **método público**
Fluxo mais longo, gera chaves de acesso Nuvem Fiscal:
1. Reserva aba e abre os detalhes do cliente.
2. Localiza a linha do serviço **"Nuvem Fiscal API"** e verifica se está **Ativo** (se inativo ou ausente, retorna erro).
3. Clica em Detalhes do serviço e navega para a página de chaves.
4. Clica no botão **+** (vários seletores de fallback) para abrir o modal de nova chave.
5. Preenche a descrição via `evaluate`.
6. Clica em **"Gerar Chave"**.
7. Clica nos botões de "olho" para revelar as chaves ocultas.
8. Extrai **Access Key** e **Secret Key** da tabela e retorna em `data`.

### `close()`
Fecha o navegador e limpa o array de abas. Chamado no desligamento.

---

## 5. Fluxos completos (exemplos)

### Fluxo: `/adicionar-produto`
```
Usuário: /adicionar-produto cnpj:27.994... produto:Relay Server
  → Bot.js: checkInitialized? hasAvailableTab?
  → Bot.js: deferReply + embed "Processando..."
  → Service.adicionarProdutoParaClientePorCNPJ(userId, cnpj, produto)
      → reserveTab() ............... 🔒 aba reservada
      → navegarParaClientesTab()
      → abrirDetalhesClientePorCNPJ()
          → pesquisarClientePorCNPJ() (detecta bloqueio)
          → clica em "Detalhes"
      → abrirModalNovoProduto() ..... abre/força o modal
      → adicionarProduto() .......... clica no card + aceita dialog
      → releaseTab() ............... 🔓 aba liberada
  → Bot.js: embed final ✅/❌
```

### Fluxo: inicialização (na subida do bot)
```
clientReady
  → registerCommands()
  → initPuppeteer()
      → new PuppeteerService()
      → init() ............ abre Chrome + cria 5 abas
      → loginAllTabs() .... loga as 5 abas em paralelo
  → pool pronto (5 sessões)
```

---

## 6. Notas de manutenção

- **Credenciais e tokens** ficam no `.env` (`PORTAL_USERNAME`, `PORTAL_PASSWORD`, `DISCORD_TOKEN`, etc.). Há fallback hardcoded das credenciais do portal — convém remover em produção.
- **Caminho do Chrome** está fixo em `C:/Program Files/Google/Chrome/Application/chrome.exe` (Windows). Em outro SO, ajustar `executablePath`.
- **Lista de produtos** do `/adicionar-produto` é fixa no array `commands` em `Bot.js`. Para adicionar/remover serviços, edite os `addChoices`.
- **Número de sessões simultâneas** é controlado por `MAX_TABS` em `PuppeteerService.js`.
- **Seletores do portal**: boa parte da lógica depende de seletores CSS específicos do portal (ex.: `#dataTable`, `#dt-search-0`, `#DescricaoChaveId`, `[id^="OlhoOculto-"]`). Se o portal mudar o HTML, esses pontos são os primeiros a quebrar.
- **Entrada de texto** deve sempre ser feita via `page.evaluate` (nunca `page.type`/`page.keyboard`) para preservar o isolamento entre abas simultâneas.

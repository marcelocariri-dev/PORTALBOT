import puppeteer from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();

const USER_DATA_PATH = './puppeteer_user_data';
const HOME_URL = 'https://portal.softcomservices.com/';
const CLIENTES_URL = 'https://portal.softcomservices.com/Clientes';
const LOGIN_URL = 'https://portal.softcomservices.com/Account/Login?ReturnUrl=%2F';

// CREDENCIAIS FIXAS DO PORTAL (do arquivo .env ou hardcoded)
const PORTAL_USERNAME = process.env.PORTAL_USERNAME || 'vanderson';
const PORTAL_PASSWORD = process.env.PORTAL_PASSWORD || 'franquias';

// Número máximo de abas/sessões simultâneas
const MAX_TABS = 5;

class PuppeteerService {
  constructor() {
    this.browser = null;
    this.tabs = []; // Array de { page, busy, lastUsed, id }
  }

  async init() {
    console.log('🚀 Inicializando Puppeteer com pool de abas...');
    
   // this.browser = await puppeteer.launch({  
      //headless: true, 
     // userDataDir: USER_DATA_PATH,
    //  args: ['--no-sandbox', '--disable-setuid-sandbox']

    this.browser = await puppeteer.launch({  
  headless: 'new', 
  userDataDir: USER_DATA_PATH,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
   

    // Criar as 5 abas
    for (let i = 0; i < MAX_TABS; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      const page = await this.browser.newPage();
      await page.setViewport({ width: 1080, height: 1024 });
      
      this.tabs.push({
        id: i + 1,
        page: page,
        busy: false,
        lastUsed: null,
        currentUser: null,
        status: 'idle' // idle, logging_in, ready, working
      });
      
      console.log(`📑 Aba ${i + 1} criada`);
    }

    // Fechar a aba padrão que abre com o browser
    const pages = await this.browser.pages();
    if (pages.length > MAX_TABS) {
      await pages[0].close();
    }

    console.log(`✅ Pool inicializado com ${MAX_TABS} abas`);
  }

  // Fazer login em todas as abas
  async loginAllTabs() {
    console.log('🔐 Fazendo login em todas as abas...');
    
    const loginPromises = this.tabs.map(async (tab) => {
      try {
        tab.status = 'logging_in';
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.loginTab(tab);
        tab.status = 'ready';
        console.log(`✅ Aba ${tab.id} logada e pronta!`);
      } catch (error) {
        console.error(`❌ Erro ao logar aba ${tab.id}:`, error.message);
        tab.status = 'error';
      }
    });

    await Promise.all(loginPromises);
    
    const readyTabs = this.tabs.filter(t => t.status === 'ready').length;
    console.log(`✅ ${readyTabs}/${MAX_TABS} abas prontas para uso`);
    
    return { success: true, readyTabs };
  }

  // Login em uma aba específica
  async loginTab(tab) {
    const page = tab.page;
    
    await page.goto(CLIENTES_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    
    const currentUrl = page.url();
    
    if (currentUrl.startsWith(LOGIN_URL)) {
      await page.type('#UserName', PORTAL_USERNAME);
      await page.type('#Password', PORTAL_PASSWORD);
      
      await Promise.all([
        page.click('button[type="submit"]'),
        page.waitForNavigation({ waitUntil: 'networkidle0' }),
      ]);
    }
    
    // Garantir que está na página de clientes
    await this.navegarParaClientesTab(tab);
  }

  // Navegar para clientes em uma aba específica
  async navegarParaClientesTab(tab) {
    const page = tab.page;
    const urlAtual = page.url();
    
    if (urlAtual.includes('/Account/Login')) {
      await this.loginTab(tab);
      return;
    }
    
    if (!urlAtual.includes('/Clientes') || urlAtual.includes('guid_customer')) {
      try {
        const menuClicado = await page.evaluate(() => {
          const link = document.querySelector('a[href="/Clientes"]');
          if (link) {
            link.click();
            return true;
          }
          return false;
        });
        
        if (menuClicado) {
          await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
        } else {
          await page.goto(CLIENTES_URL, { waitUntil: 'networkidle0', timeout: 15000 });
        }
      } catch (e) {
        await page.goto(CLIENTES_URL, { waitUntil: 'networkidle0', timeout: 15000 });
      }
    }
  }

  // ============================================================
  // GERENCIAMENTO DO POOL DE ABAS
  // ============================================================

  // Obter uma aba disponível
  getAvailableTab() {
    // Procurar aba livre e pronta
    const availableTab = this.tabs.find(tab => 
      !tab.busy && tab.status === 'ready'
    );
    
    return availableTab || null;
  }

  // Reservar uma aba para uso
  async reserveTab(userId) {
    const tab = this.getAvailableTab();
    
    if (!tab) {
      return null;
    }
    
    tab.busy = true;
    tab.currentUser = userId;
    tab.lastUsed = new Date();
    tab.status = 'working';
    
    // IMPORTANTE: Trazer a aba para frente (necessário no modo headless: false)
    try {
      await tab.page.bringToFront();
    } catch (e) {
      console.log(`⚠️ Não foi possível trazer aba ${tab.id} para frente`);
    }
    
    console.log(`🔒 Aba ${tab.id} reservada para usuário ${userId}`);
    return tab;
  }

  // Liberar uma aba após uso
  async releaseTab(tab) {
    if (!tab) return;
    
    console.log(`🔓 Liberando aba ${tab.id}...`);
    
    try {
      // Voltar para página de clientes
      await this.navegarParaClientesTab(tab);
      
      // Limpar campo de pesquisa se existir
      try {
        const page = tab.page;
        const searchField = await page.$('#dt-search-0');
        if (searchField) {
          await page.click('#dt-search-0', { clickCount: 3 });
          await page.keyboard.press('Backspace');
        }
      } catch (e) {
        // Ignorar erro de limpeza
      }
      
      tab.status = 'ready';
    } catch (error) {
      console.error(`❌ Erro ao preparar aba ${tab.id}:`, error.message);
      tab.status = 'error';
      
      // Tentar recuperar a aba
      try {
        await this.loginTab(tab);
        tab.status = 'ready';
      } catch (e) {
        console.error(`❌ Não foi possível recuperar aba ${tab.id}`);
      }
    }
    
    tab.busy = false;
    tab.currentUser = null;
    
    console.log(`✅ Aba ${tab.id} liberada e pronta`);
  }

  // Verificar status do pool
  getPoolStatus() {
    const status = {
      total: this.tabs.length,
      available: 0,
      busy: 0,
      error: 0,
      tabs: []
    };
    
    this.tabs.forEach(tab => {
      const tabInfo = {
        id: tab.id,
        status: tab.status,
        busy: tab.busy,
        currentUser: tab.currentUser,
        lastUsed: tab.lastUsed
      };
      
      status.tabs.push(tabInfo);
      
      if (tab.busy) {
        status.busy++;
      } else if (tab.status === 'ready') {
        status.available++;
      } else if (tab.status === 'error') {
        status.error++;
      }
    });
    
    return status;
  }

  // Verificar se há abas disponíveis
  hasAvailableTab() {
    return this.tabs.some(tab => !tab.busy && tab.status === 'ready');
  }

  // ============================================================
  // OPERAÇÕES COM POOL (usa aba disponível automaticamente)
  // ============================================================

  async pesquisarClientePorCNPJ(tab, cnpj) {
    const page = tab.page;
    
    try {
      console.log(`[Aba ${tab.id}] 🔍 Pesquisando cliente por CNPJ: ${cnpj}`);
      
      const cnpjNumeros = cnpj.replace(/\D/g, '');
      console.log(`[Aba ${tab.id}] 📋 CNPJ normalizado: ${cnpjNumeros}`);
      
      await page.waitForSelector('#dt-search-0', { visible: true, timeout: 10000 });
      
      // Limpar campo de pesquisa
      console.log(`[Aba ${tab.id}] 🧹 Limpando campo de pesquisa...`);
      await page.click('#dt-search-0', { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      await page.focus('#dt-search-0');
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.press('Delete');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      console.log(`[Aba ${tab.id}] 📝 Digitando CNPJ...`);
      await page.type('#dt-search-0', cnpjNumeros, { delay: 50 });
      
      console.log(`[Aba ${tab.id}] ⏎ Pressionando Enter...`);
      await page.keyboard.press('Enter');
      
      console.log(`[Aba ${tab.id}] ⏳ Aguardando resultados (5 segundos)...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      try {
        await page.waitForFunction(() => {
          const loading = document.querySelector('.dataTables_processing');
          return !loading || loading.style.display === 'none';
        }, { timeout: 10000 });
      } catch (e) {
        console.log(`[Aba ${tab.id}] ⚠️ Timeout aguardando tabela`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const resultadoPesquisa = await page.evaluate(() => {
        const linhas = document.querySelectorAll('table#dataTable tbody tr');
        const resultados = [];
        
        for (let linha of linhas) {
          const textoLinha = linha.innerText;
          
          if (textoLinha.includes('Nenhum registro') || 
              textoLinha.includes('No data available') ||
              textoLinha.includes('No matching records')) {
            return { encontrou: false, quantidade: 0, clientes: [] };
          }
          const bloqueado = linha.querySelector('.badge-danger, .badge.badge-pill.badge-danger, span.badge-danger');
          
          // Verificar também pelo texto da linha (backup)
          const temTextoBloqueado = textoLinha.includes('Bloqueado');
          
          if ((bloqueado && bloqueado.innerText.trim() === 'Bloqueado') || temTextoBloqueado) {
            // Pegar nome do cliente para o log
            const strongEl = linha.querySelector('p.m-0 strong');
            const nomeCliente = strongEl ? strongEl.innerText.trim() : 'Desconhecido';
            
            return { 
              encontrou: true, 
              quantidade: 1, 
              clientes: [], 
              bloqueado: true,
              nomeClienteBloqueado: nomeCliente,
              mensagemBloqueio: 'Cliente está BLOQUEADO no sistema'
            };
          }
          const strongElement = linha.querySelector('p.m-0 strong');
          const titulo = strongElement ? strongElement.innerText.trim() : '';
          
          let cnpjLinha = null;
          const cnpjMatch = textoLinha.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
          if (cnpjMatch) {
            cnpjLinha = cnpjMatch[0];
          } else {
            const cnpjNumMatch = textoLinha.match(/\b\d{14}\b/);
            if (cnpjNumMatch) {
              cnpjLinha = cnpjNumMatch[0];
            }
          }
          
          if (titulo) {
            resultados.push({
              titulo,
              cnpj: cnpjLinha,
              cnpjNumeros: cnpjLinha ? cnpjLinha.replace(/\D/g, '') : null
            });
          }
        }
        
        return {
          encontrou: resultados.length > 0,
          quantidade: resultados.length,
          clientes: resultados
        };
      });
      
      console.log(`[Aba ${tab.id}] 📊 Encontrados: ${resultadoPesquisa.quantidade} cliente(s)`);
      
      // ========== VERIFICAR SE CLIENTE ESTÁ BLOQUEADO ==========
      if (resultadoPesquisa.bloqueado) {
        const nomeCliente = resultadoPesquisa.nomeClienteBloqueado || 'Cliente';
        console.log(`[Aba ${tab.id}] 🚫 ${nomeCliente} está BLOQUEADO!`);
        return { 
          success: false, 
          message: `🚫 Cliente "${nomeCliente}" está BLOQUEADO no sistema. Não é possível adicionar produtos.`,
          bloqueado: true
        };
      }
      // ==========================================================
      
      if (!resultadoPesquisa.encontrou) {
        return { success: false, message: 'Cliente não encontrado na pesquisa' };
      }
      
      const clienteCorreto = resultadoPesquisa.clientes.find(c => 
        c.cnpjNumeros === cnpjNumeros
      );
      
      if (clienteCorreto) {
        console.log(`[Aba ${tab.id}] ✅ Cliente correto: ${clienteCorreto.titulo}`);
        return { 
          success: true, 
          message: 'Cliente encontrado',
          cliente: clienteCorreto,
          totalResultados: resultadoPesquisa.quantidade
        };
      } else if (resultadoPesquisa.quantidade === 1) {
        return { 
          success: true, 
          message: 'Cliente encontrado (único resultado)',
          cliente: resultadoPesquisa.clientes[0],
          totalResultados: 1
        };
      } else {
        return { 
          success: true, 
          message: 'Múltiplos resultados',
          clientes: resultadoPesquisa.clientes,
          totalResultados: resultadoPesquisa.quantidade
        };
      }
      
    } catch (error) {
      console.error(`[Aba ${tab.id}] ❌ Erro ao pesquisar:`, error);
      return { success: false, message: error.message };
    }
  }

  async abrirDetalhesClientePorCNPJ(tab, cnpj) {
    const page = tab.page;
    const cnpjNumeros = cnpj.replace(/\D/g, '');
    
    try {
      console.log(`[Aba ${tab.id}] 🔍 Abrindo detalhes do cliente CNPJ: ${cnpj}`);
      
      const pesquisaResult = await this.pesquisarClientePorCNPJ(tab, cnpj);
      
      // Se pesquisa falhou OU cliente está bloqueado, retornar erro
      if (!pesquisaResult.success) {
        return pesquisaResult;
      }
      
      // Verificação extra de bloqueado (caso não tenha sido pego antes)
      if (pesquisaResult.bloqueado) {
        return pesquisaResult;
      }
      
      await page.waitForSelector('table#dataTable tbody tr', { timeout: 10000 });
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log(`[Aba ${tab.id}] 🔘 Clicando em Detalhes...`);
      
      const botaoClicado = await page.evaluate((cnpjBuscado) => {
        const linhas = document.querySelectorAll('table#dataTable tbody tr');
        
        for (let linha of linhas) {
          const textoLinha = linha.innerText;
          
          if (textoLinha.includes('Nenhum registro') || 
              textoLinha.includes('No data available')) {
            continue;
          }
          
          // ========== VERIFICAR SE BLOQUEADO ==========
          if (textoLinha.includes('Bloqueado')) {
            return { clicado: false, motivo: 'cliente_bloqueado', bloqueado: true };
          }
          // ============================================
          
          let cnpjLinha = null;
          const cnpjMatch = textoLinha.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
          if (cnpjMatch) {
            cnpjLinha = cnpjMatch[0].replace(/\D/g, '');
          } else {
            const cnpjNumMatch = textoLinha.match(/\b\d{14}\b/);
            if (cnpjNumMatch) {
              cnpjLinha = cnpjNumMatch[0];
            }
          }
          
          if (cnpjLinha === cnpjBuscado) {
            const botaoDetalhes = linha.querySelector(
              'a.btn.btn-primary.btn-sm[title="Detalhes"], ' +
              'a.btn-primary[title="Detalhes"], ' +
              'a[title="Detalhes"]'
            );
            
            if (botaoDetalhes) {
              botaoDetalhes.click();
              return { clicado: true, motivo: 'cnpj_exato' };
            }
            
            const iconeDetalhes = linha.querySelector('.fa-list, .fa-eye');
            if (iconeDetalhes) {
              const link = iconeDetalhes.closest('a');
              if (link) {
                link.click();
                return { clicado: true, motivo: 'icone' };
              }
            }
          }
        }
        
        // Fallback: se só tem uma linha, clicar nela
        const linhasValidas = Array.from(linhas).filter(l => {
          const texto = l.innerText;
          return !texto.includes('Nenhum registro') && !texto.includes('No data available');
        });
        
        if (linhasValidas.length === 1) {
          // Verificar se está bloqueado antes de clicar
          if (linhasValidas[0].innerText.includes('Bloqueado')) {
            return { clicado: false, motivo: 'cliente_bloqueado', bloqueado: true };
          }
          
          const botaoDetalhes = linhasValidas[0].querySelector(
            'a.btn.btn-primary.btn-sm[title="Detalhes"], a[title="Detalhes"]'
          );
          if (botaoDetalhes) {
            botaoDetalhes.click();
            return { clicado: true, motivo: 'unico_resultado' };
          }
        }
        
        return { clicado: false, motivo: 'nao_encontrado' };
      }, cnpjNumeros);
      
      if (botaoClicado.bloqueado) {
        console.log(`[Aba ${tab.id}] 🚫 Cliente está BLOQUEADO! Não vai abrir detalhes.`);
        return { 
          success: false, 
          message: '🚫 Cliente está BLOQUEADO no sistema. Não é possível adicionar produtos.',
          bloqueado: true
        };
      }
      
      if (botaoClicado.clicado) {
        console.log(`[Aba ${tab.id}] ✅ Detalhes clicado (${botaoClicado.motivo})`);
        
        try {
          await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 });
        } catch (e) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        return { success: true, message: 'Detalhes do cliente abertos' };
      } else {
        return { success: false, message: 'Botão Detalhes não encontrado' };
      }
      
    } catch (error) {
      console.error(`[Aba ${tab.id}] ❌ Erro:`, error);
      return { success: false, message: error.message };
    }
  }

  async abrirModalNovoProduto(tab) {
    const page = tab.page;
    
    try {
      console.log(`[Aba ${tab.id}] 🔘 Procurando botão "Novo"...`);
      
      await page.waitForSelector('table#dataTable', { timeout: 10000 });
      
      const botaoNovoClicado = await page.evaluate(() => {
        const botaoNovo = document.querySelector('a.btn.btn-success.btn-icon-split.btn-sm[data-toggle="modal"][data-target^="#modal-"]');
        if (botaoNovo) {
          botaoNovo.click();
          return true;
        }
        return false;
      });
      
      if (botaoNovoClicado) {
        console.log(`[Aba ${tab.id}] ✅ Botão "Novo" clicado!`);
        
        await page.waitForSelector('.modal.fade.show', { visible: true, timeout: 5000 });
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return { success: true, message: 'Modal aberto' };
      } else {
        return { success: false, message: 'Botão Novo não encontrado' };
      }
    } catch (error) {
      console.error(`[Aba ${tab.id}] ❌ Erro:`, error);
      return { success: false, message: error.message };
    }
  }

  async adicionarProduto(tab, nomeProduto) {
    const page = tab.page;
    let dialogConfirmado = false;
    
    try {
      console.log(`[Aba ${tab.id}] 🎯 Procurando produto "${nomeProduto}"...`);
      
      page.removeAllListeners('dialog');
      
      const dialogHandler = async (dialog) => {
        console.log(`[Aba ${tab.id}] 📢 Dialog: ${dialog.message()}`);
        try {
          await dialog.accept();
          dialogConfirmado = true;
          console.log(`[Aba ${tab.id}] ✅ Dialog confirmado!`);
        } catch (error) {
          dialogConfirmado = true;
        }
      };
      
      page.once('dialog', dialogHandler);
      
      const produtoEncontrado = await page.evaluate((produto) => {
        const cards = document.querySelectorAll('.service-card, .card');
        
        for (let card of cards) {
          const titulo = card.querySelector('h3, h5, .card-title, strong');
          if (titulo && titulo.innerText.trim() === produto) {
            card.click();
            return true;
          }
        }
        return false;
      }, nomeProduto);
      
      if (produtoEncontrado) {
        console.log(`[Aba ${tab.id}] ✅ Produto clicado!`);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (dialogConfirmado) {
          console.log(`[Aba ${tab.id}] 🎉 SUCESSO! Produto adicionado!`);
          
          try {
            await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 8000 });
          } catch (e) {}
          
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          return { 
            success: true, 
            message: `Produto "${nomeProduto}" adicionado com sucesso!` 
          };
        }
        
        try {
          await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
        } catch (e) {}
        
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        if (dialogConfirmado) {
          return { 
            success: true, 
            message: `Produto "${nomeProduto}" adicionado com sucesso!` 
          };
        }
        
        return { 
          success: true, 
          message: `Produto "${nomeProduto}" adicionado com sucesso!` 
        };
        
      } else {
        return { success: false, message: 'Produto já adicionado' };
      }
    } catch (error) {
      console.error(`[Aba ${tab.id}] ❌ Erro:`, error);
      
      if (dialogConfirmado || error.message.includes('Execution context was destroyed')) {
        return { 
          success: true, 
          message: `Produto "${nomeProduto}" adicionado com sucesso!` 
        };
      }
      
      return { success: false, message: error.message };
    }
  }

  // ============================================================
  // MÉTODO PRINCIPAL - Adicionar produto (com pool)
  // ============================================================
  async adicionarProdutoParaClientePorCNPJ(userId, cnpj, nomeProduto) {
    // 1. Tentar reservar uma aba
    const tab = await this.reserveTab(userId);
    
    if (!tab) {
      console.log('❌ Todas as abas estão ocupadas!');
      return { 
        success: false, 
        message: '⏳ Todas as nossas sessões estão ocupadas no momento, tente mais tarde.',
        allBusy: true
      };
    }
    
    try {
      console.log(`[Aba ${tab.id}] 🚀 Iniciando processo para ${userId}...`);
      
      // 2. Garantir que está na página de clientes
      await this.navegarParaClientesTab(tab);
      
      // 3. Abrir detalhes do cliente
      const detalhesResult = await this.abrirDetalhesClientePorCNPJ(tab, cnpj);
      if (!detalhesResult.success) {
        await this.releaseTab(tab);
        return detalhesResult;
      }
      
      // 4. Abrir modal
      const modalResult = await this.abrirModalNovoProduto(tab);
      if (!modalResult.success) {
        await this.releaseTab(tab);
        return modalResult;
      }
      
      // 5. Adicionar produto
      const produtoResult = await this.adicionarProduto(tab, nomeProduto);
      
      // 6. Liberar aba
      await this.releaseTab(tab);
      
      return produtoResult;
      
    } catch (error) {
      console.error(`[Aba ${tab.id}] ❌ Erro geral:`, error);
      await this.releaseTab(tab);
      return { success: false, message: error.message };
    }
  }

  // ============================================================
  // EXTRAIR CLIENTES (usa aba disponível)
  // ============================================================
  async extrairClientes(userId) {
    const tab = await this.reserveTab(userId);
    
    if (!tab) {
      return { 
        success: false, 
        message: '⏳ Todas as nossas sessões estão ocupadas no momento, tente mais tarde.',
        allBusy: true
      };
    }
    
    try {
      const page = tab.page;
      
      await this.navegarParaClientesTab(tab);
      await page.waitForSelector('table#dataTable tbody tr', { timeout: 10000 });
      
      const clientes = await page.evaluate(() => {
        const data = [];  
        const linhas = document.querySelectorAll('table#dataTable tbody tr');
        
        linhas.forEach((linha) => {
          const titulo = linha.querySelector('p.m-0 strong')?.innerText.trim();
          const textoCompleto = linha.innerText;
          
          let cnpj = null;
          let cnpjMatch = textoCompleto.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
          if (cnpjMatch) {
            cnpj = cnpjMatch[0];
          } else {
            cnpjMatch = textoCompleto.match(/\b\d{14}\b/);
            if (cnpjMatch) {
              const num = cnpjMatch[0];
              cnpj = `${num.substr(0,2)}.${num.substr(2,3)}.${num.substr(5,3)}/${num.substr(8,4)}-${num.substr(12,2)}`;
            }
          }
          
          if (titulo) {
            data.push({ titulo, cnpj });
          }
        });
        
        return data;
      });
      
      await this.releaseTab(tab);
      
      console.log(`✅ ${clientes.length} clientes extraídos`);
      return { success: true, data: clientes };
      
    } catch (error) {
      console.error('❌ Erro ao extrair clientes:', error);
      await this.releaseTab(tab);
      return { success: false, message: error.message };
    }
  }
// ============================================================
  // GERAR CHAVE NUVEM FISCAL (com pool)
  // ============================================================
  async gerarChaveNuvemFiscalParaClientePorCNPJ(userId, cnpj, descricao = 'Chave automática') {
    const tab = await this.reserveTab(userId);
    
    if (!tab) {
      return { 
        success: false, 
        message: '⏳ Todas as nossas sessões estão ocupadas no momento, tente mais tarde.',
        allBusy: true
      };
    }
    
    const page = tab.page;
    
    try {
      console.log(`[Aba ${tab.id}] 🔑 Gerando chave Nuvem Fiscal para CNPJ: ${cnpj}`);
      
      // 1. Navegar para clientes
      await this.navegarParaClientesTab(tab);
      
      // 2. Abrir detalhes do cliente
      const detalhesResult = await this.abrirDetalhesClientePorCNPJ(tab, cnpj);
      if (!detalhesResult.success) {
        await this.releaseTab(tab);
        return detalhesResult;
      }
      
      // 3. Aguardar carregar a tabela de serviços do cliente
      console.log(`[Aba ${tab.id}] 📋 Procurando serviço Nuvem Fiscal API...`);
      await page.waitForSelector('table#dataTable tbody tr', { timeout: 15000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 4. Clicar em "Detalhes" do Nuvem Fiscal API
      const nuvemFiscalEncontrado = await page.evaluate(() => {
        const linhas = document.querySelectorAll('table#dataTable tbody tr');
        
        for (let linha of linhas) {
          const textoLinha = linha.innerText;
          
          // Verificar se é a linha do Nuvem Fiscal API
          if (textoLinha.includes('Nuvem Fiscal API')) {
            // Verificar se está Ativo
            const badge = linha.querySelector('.badge');
            const estaAtivo = badge && badge.innerText.trim() === 'Ativo';
            
            if (estaAtivo) {
              // Clicar no botão Detalhes
              const botaoDetalhes = linha.querySelector('a[title="Detalhes"], a.btn-primary');
              if (botaoDetalhes) {
                botaoDetalhes.click();
                return { encontrado: true, ativo: true };
              }
            } else {
              return { encontrado: true, ativo: false };
            }
          }
        }
        return { encontrado: false, ativo: false };
      });
      
      if (!nuvemFiscalEncontrado.encontrado) {
        await this.releaseTab(tab);
        return { success: false, message: '❌ Serviço "Nuvem Fiscal API" não encontrado para este cliente' };
      }
      
      if (!nuvemFiscalEncontrado.ativo) {
        await this.releaseTab(tab);
        return { success: false, message: '❌ Serviço "Nuvem Fiscal API" está INATIVO para este cliente' };
      }
      
      console.log(`[Aba ${tab.id}] ✅ Nuvem Fiscal encontrado! Abrindo detalhes...`);
      
      // 5. Aguardar navegação para página de serviços
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 });
      } catch (e) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // 6. Aguardar carregar a página de chaves
      console.log(`[Aba ${tab.id}] 🔍 Procurando botão de adicionar chave...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 7. Clicar no botão de adicionar nova chave (ícone +)
      const botaoNovoClicado = await page.evaluate(() => {
        // Tentar encontrar o botão de adicionar chave
        // Baseado no seu código gravado: div:nth-of-type(3) > div.card-body i
        const seletores = [
          '#dataTableChavesAcesso thead th a i.fa-plus',
          'a i.fa-plus',
          'i.fa-plus',
          'a[data-toggle="modal"] i',
          '.card-body a i.fa-plus'
        ];
        
        for (let seletor of seletores) {
          const icone = document.querySelector(seletor);
          if (icone) {
            const link = icone.closest('a');
            if (link) {
              link.click();
              return true;
            }
            icone.click();
            return true;
          }
        }
        return false;
      });
      
      if (!botaoNovoClicado) {
        await this.releaseTab(tab);
        return { success: false, message: '❌ Botão de adicionar chave não encontrado' };
      }
      
      console.log(`[Aba ${tab.id}] ✅ Botão + clicado! Aguardando modal...`);
      
      // 8. Aguardar o modal abrir
      await page.waitForSelector('#DescricaoChaveId', { visible: true, timeout: 10000 });
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 9. Preencher a descrição da chave
      console.log(`[Aba ${tab.id}] 📝 Preenchendo descrição: "${descricao}"`);
      await page.click('#DescricaoChaveId');
      await page.evaluate(() => {
        document.querySelector('#DescricaoChaveId').value = '';
      });
      await page.type('#DescricaoChaveId', descricao, { delay: 50 });
      
      // 10. Clicar no botão "Gerar Chave"
      console.log(`[Aba ${tab.id}] 🔘 Clicando em "Gerar Chave"...`);
      
      const botaoGerarClicado = await page.evaluate(() => {
        // Procurar botão "Gerar Chave"
        const botoes = document.querySelectorAll('button.btn-primary, button[type="submit"]');
        for (let botao of botoes) {
          if (botao.innerText.includes('Gerar Chave') || botao.innerText.includes('Gerar')) {
            botao.click();
            return true;
          }
        }
        
        // Tentar pelo formulário
        const form = document.querySelector('#FormAddChaveAcesso');
        if (form) {
          const submitBtn = form.querySelector('button[type="submit"], button.btn-primary');
          if (submitBtn) {
            submitBtn.click();
            return true;
          }
        }
        
        return false;
      });
      
      if (!botaoGerarClicado) {
        await this.releaseTab(tab);
        return { success: false, message: '❌ Botão "Gerar Chave" não encontrado' };
      }
      
      console.log(`[Aba ${tab.id}] ⏳ Aguardando chaves serem geradas...`);
      
      // 11. Aguardar a página recarregar/atualizar
      try {
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 });
      } catch (e) {
        // Se não houver navegação, apenas aguardar
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // 12. Extrair as chaves da tabela
      console.log(`[Aba ${tab.id}] 📋 Extraindo chaves geradas...`);
      
      
      console.log(`[Aba ${tab.id}] 👁️ Clicando nos botões para revelar chaves...`);
      
      const botoesOlho = await page.$$('[id^="OlhoOculto-"]');
console.log(`Encontrados ${botoesOlho.length} botões de olho`);

for (const botao of botoesOlho) {
  await botao.click();
  await new Promise(resolve => setTimeout(resolve, 500));
}
      
      // Aguardar as chaves serem reveladas
      await new Promise(resolve => setTimeout(resolve, 3600));

      const chaves = await page.evaluate(() => {
        // Aguardar a tabela de chaves
        const tabela = document.querySelector('#dataTableChavesAcesso');
        if (!tabela) return null;
        
        const linhas = tabela.querySelectorAll('tbody tr');
        if (linhas.length === 0) return null;
        
        // Pegar a primeira linha (chave mais recente)
        const primeiraLinha = linhas[0];
        const colunas = primeiraLinha.querySelectorAll('td');
        
        if (colunas.length < 3) return null;
        
        // Extrair os valores
        // Coluna 0: Descrição
        // Coluna 1: Access Key (pode ter botões de copiar junto)
        // Coluna 2: Secret Key (pode ter botões de copiar junto)
        
        const descricao = colunas[0]?.innerText.trim();
        
        // Para Access Key e Secret Key, pegar apenas o texto, não os ícones
        
        let accessKey = colunas[1]?.innerText.trim();
        let secretKey = colunas[2]?.innerText.trim();
        
        // Limpar possíveis textos extras (remover espaços e quebras de linha)
        accessKey = accessKey.split('\n')[0].trim();
        secretKey = secretKey.split('\n')[0].trim();
        
        return {
          descricao,
          accessKey,
          secretKey
        };
      });
      
      await this.releaseTab(tab);
      
      if (chaves && chaves.accessKey && chaves.secretKey) {
        console.log(`[Aba ${tab.id}] ✅ Chaves extraídas com sucesso!`);
        return { 
          success: true, 
          message: '✅ Chaves geradas com sucesso!',
          data: {
            descricao: chaves.descricao,
            accessKey: chaves.accessKey,
            secretKey: chaves.secretKey
          }
        };
      } else {
        return { success: false, message: '❌ Não foi possível extrair as chaves. Verifique manualmente no portal.' };
      }
      
    } catch (error) {
      console.error(`[Aba ${tab.id}] ❌ Erro:`, error);
      await this.releaseTab(tab);
      return { success: false, message: `❌ Erro: ${error.message}` };
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.tabs = [];
    }
  }
}

export default PuppeteerService;
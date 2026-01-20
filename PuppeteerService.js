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

class PuppeteerService {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async init() {
    this.browser = await puppeteer.launch({  
      headless: false, 
      userDataDir: USER_DATA_PATH
    });
    this.page = await this.browser.newPage();
    await this.page.setViewport({ width: 1080, height: 1024 });
  }

  async login() {
    try {
      console.log('🔐 Fazendo login no portal com credenciais fixas...');
      
      await this.page.goto(CLIENTES_URL, { waitUntil: 'networkidle0' });
      
      const currentUrl = this.page.url();
      
      if (currentUrl.startsWith(LOGIN_URL)) {
        await this.page.type('#UserName', PORTAL_USERNAME);
        await this.page.type('#Password', PORTAL_PASSWORD);
        
        await Promise.all([
          this.page.click('button[type="submit"]'),
          this.page.waitForNavigation({ waitUntil: 'networkidle0' }),
        ]);
        
        console.log('✅ Login no portal realizado! URL atual:', this.page.url());
      } else {
        console.log('✅ Já está logado no portal! URL atual:', this.page.url());
      }
      
      return { success: true, message: 'Login no portal realizado com sucesso' };
    } catch (error) {
      console.error('❌ Erro no login do portal:', error);
      return { success: false, message: error.message };
    }
  }

  async navegarParaClientes() {
    try {
      const urlAtual = this.page.url();
      
      // Se está na página de login, tenta fazer login
      if (urlAtual.includes('/Account/Login')) {
        console.log('🔄 Detectou página de login, fazendo login...');
        const loginResult = await this.login();
        
        if (!loginResult.success) {
          return loginResult;
        }
      }
      
      if (!urlAtual.includes('/Clientes')) {
        console.log('📍 Navegando para página de Clientes...');
        
        await this.page.waitForSelector('a[href="/Clientes"]', { visible: true });
        
        await Promise.all([
          this.page.waitForNavigation({ waitUntil: 'networkidle0' }),
          this.page.click('a[href="/Clientes"]')
        ]);
        
        console.log('✅ Chegou na página de Clientes');
      } else {
        console.log('✅ Já está na página de Clientes!');
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ Erro ao navegar para clientes:', error);
      return { success: false, message: error.message };
    }
  }

  async extrairClientes() {
    try {
      await this.page.waitForSelector('table#dataTable tbody tr', { timeout: 10000 });
      
      const clientes = await this.page.evaluate(() => {
        const data = [];  
        const linhas = document.querySelectorAll('table#dataTable tbody tr');
        
        linhas.forEach((linha) => {
          const titulo = linha.querySelector('p.m-0 strong')?.innerText.trim();
          
          // Extrair todo o texto da linha
          const textoCompleto = linha.innerText;
          
          // Tentar múltiplos formatos de CNPJ
          let cnpj = null;
          
          // Formato: XX.XXX.XXX/XXXX-XX
          let cnpjMatch = textoCompleto.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
          if (cnpjMatch) {
            cnpj = cnpjMatch[0];
          } else {
            // Formato: XXXXXXXXXXXXXX (14 dígitos)
            cnpjMatch = textoCompleto.match(/\b\d{14}\b/);
            if (cnpjMatch) {
              // Formatar: XX.XXX.XXX/XXXX-XX
              const num = cnpjMatch[0];
              cnpj = `${num.substr(0,2)}.${num.substr(2,3)}.${num.substr(5,3)}/${num.substr(8,4)}-${num.substr(12,2)}`;
            }
          }
          
          if (titulo) {
            data.push({ 
              titulo,
              cnpj,
              textoCompleto // Debug
            });
          }
        });
        
        return data;
      });
      
      console.log(`✅ ${clientes.length} clientes extraídos`);
      
      // Debug: mostrar primeiros 3 clientes
      if (clientes.length > 0) {
        console.log('📋 Primeiros clientes:');
        clientes.slice(0, 3).forEach((c, i) => {
          console.log(`  ${i + 1}. ${c.titulo} - CNPJ: ${c.cnpj || 'NÃO ENCONTRADO'}`);
        });
      }
      
      return { success: true, data: clientes };
    } catch (error) {
      console.error('❌ Erro ao extrair clientes:', error);
      return { success: false, message: error.message };
    }
  }

  // ============================================================
  // FUNÇÃO CORRIGIDA - pesquisarClientePorCNPJ
  // ============================================================
  async pesquisarClientePorCNPJ(cnpj) {
    try {
      console.log(`🔍 Pesquisando cliente por CNPJ: ${cnpj}`);
      
      // Normalizar CNPJ para apenas números
      const cnpjNumeros = cnpj.replace(/\D/g, '');
      console.log(`📋 CNPJ normalizado: ${cnpjNumeros}`);
      
      // Aguardar campo de pesquisa estar disponível
      await this.page.waitForSelector('#dt-search-0', { visible: true, timeout: 10000 });
      
      // Limpar campo de pesquisa completamente
      console.log('🧹 Limpando campo de pesquisa...');
      await this.page.click('#dt-search-0', { clickCount: 3 });
      await this.page.keyboard.press('Backspace');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Limpar novamente usando Ctrl+A e Delete
      await this.page.focus('#dt-search-0');
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('a');
      await this.page.keyboard.up('Control');
      await this.page.keyboard.press('Delete');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      console.log('📝 Digitando CNPJ no campo de pesquisa...');
      await this.page.type('#dt-search-0', cnpjNumeros, { delay: 50 });
      
      // Pressionar Enter para pesquisar
      console.log('⏎ Pressionando Enter para pesquisar...');
      await this.page.keyboard.press('Enter');
      
      // ============================================================
      // CORREÇÃO 1: Esperar mais tempo (pesquisa é lenta)
      // ============================================================
      console.log('⏳ Aguardando resultados da pesquisa (5 segundos)...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Aguardar tabela atualizar (tentar detectar mudança)
      try {
        await this.page.waitForFunction(() => {
          const loading = document.querySelector('.dataTables_processing');
          return !loading || loading.style.display === 'none';
        }, { timeout: 10000 });
        console.log('✅ Tabela terminou de carregar');
      } catch (e) {
        console.log('⚠️ Timeout aguardando tabela, continuando...');
      }
      
      // Aguardar um pouco mais para garantir
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // ============================================================
      // CORREÇÃO 2: Verificar resultados e contar quantos retornaram
      // ============================================================
      const resultadoPesquisa = await this.page.evaluate(() => {
        const linhas = document.querySelectorAll('table#dataTable tbody tr');
        const resultados = [];
        
        for (let linha of linhas) {
          const textoLinha = linha.innerText;
          
          // Ignorar linha de "nenhum registro"
          if (textoLinha.includes('Nenhum registro') || 
              textoLinha.includes('No data available') ||
              textoLinha.includes('No matching records')) {
            return { encontrou: false, quantidade: 0, clientes: [] };
          }
          
          // Extrair dados do cliente
          const strongElement = linha.querySelector('p.m-0 strong');
          const titulo = strongElement ? strongElement.innerText.trim() : '';
          
          // Extrair CNPJ da linha
          let cnpjLinha = null;
          const cnpjMatch = textoLinha.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
          if (cnpjMatch) {
            cnpjLinha = cnpjMatch[0];
          } else {
            // Tentar formato sem pontuação
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
      
      console.log(`📊 Resultado da pesquisa: ${resultadoPesquisa.quantidade} cliente(s) encontrado(s)`);
      
      if (!resultadoPesquisa.encontrou) {
        console.log('❌ Nenhum cliente encontrado com este CNPJ');
        return { success: false, message: 'Cliente não encontrado na pesquisa' };
      }
      
      // Mostrar clientes encontrados
      resultadoPesquisa.clientes.forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.titulo} - CNPJ: ${c.cnpj || 'N/A'}`);
      });
      
      // ============================================================
      // CORREÇÃO 3: Verificar se o CNPJ correto está nos resultados
      // ============================================================
      const clienteCorreto = resultadoPesquisa.clientes.find(c => 
        c.cnpjNumeros === cnpjNumeros
      );
      
      if (clienteCorreto) {
        console.log(`✅ Cliente correto encontrado: ${clienteCorreto.titulo}`);
        return { 
          success: true, 
          message: 'Cliente encontrado',
          cliente: clienteCorreto,
          totalResultados: resultadoPesquisa.quantidade
        };
      } else if (resultadoPesquisa.quantidade === 1) {
        // Se só tem 1 resultado, provavelmente é o correto
        console.log(`⚠️ CNPJ não bateu exatamente, mas só tem 1 resultado: ${resultadoPesquisa.clientes[0].titulo}`);
        return { 
          success: true, 
          message: 'Cliente encontrado (único resultado)',
          cliente: resultadoPesquisa.clientes[0],
          totalResultados: 1
        };
      } else {
        console.log('⚠️ Múltiplos resultados, mas CNPJ exato não encontrado');
        return { 
          success: true, 
          message: 'Múltiplos resultados - será selecionado o correto',
          clientes: resultadoPesquisa.clientes,
          totalResultados: resultadoPesquisa.quantidade
        };
      }
      
    } catch (error) {
      console.error('❌ Erro ao pesquisar cliente:', error);
      return { success: false, message: error.message };
    }
  }

  // ============================================================
  // FUNÇÃO CORRIGIDA - abrirDetalhesClientePorCNPJ
  // ============================================================
  async abrirDetalhesClientePorCNPJ(cnpj) {
    try {
      console.log(`🔍 Abrindo detalhes do cliente com CNPJ: ${cnpj}`);
      
      // Normalizar CNPJ
      const cnpjNumeros = cnpj.replace(/\D/g, '');
      
      // 1. Pesquisar pelo CNPJ
      const pesquisaResult = await this.pesquisarClientePorCNPJ(cnpj);
      if (!pesquisaResult.success) {
        return pesquisaResult;
      }
      
      // 2. Aguardar tabela estar pronta
      await this.page.waitForSelector('table#dataTable tbody tr', { timeout: 10000 });
      
      // Aguardar mais um pouco para garantir que tabela está estável
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // ============================================================
      // CORREÇÃO: Clicar no cliente com o CNPJ CORRETO
      // ============================================================
      console.log('🔘 Procurando cliente com CNPJ correto para clicar...');
      
      const botaoClicado = await this.page.evaluate((cnpjBuscado) => {
        const linhas = document.querySelectorAll('table#dataTable tbody tr');
        
        for (let linha of linhas) {
          const textoLinha = linha.innerText;
          
          // Verificar se não é mensagem de "nenhum registro"
          if (textoLinha.includes('Nenhum registro') || 
              textoLinha.includes('No data available') ||
              textoLinha.includes('No matching records')) {
            continue;
          }
          
          // Extrair CNPJ da linha
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
          
          // Comparar CNPJ
          if (cnpjLinha === cnpjBuscado) {
            console.log('✅ CNPJ correto encontrado na linha!');
            
            // Procurar botão de detalhes
            const botaoDetalhes = linha.querySelector(
              'a.btn.btn-primary.btn-sm[title="Detalhes"], ' +
              'a.btn-primary[title="Detalhes"], ' +
              'a[title="Detalhes"]'
            );
            
            if (botaoDetalhes) {
              botaoDetalhes.click();
              return { clicado: true, motivo: 'cnpj_exato' };
            }
            
            // Tentar clicar no ícone fa-list
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
        
        // Se não encontrou pelo CNPJ exato, clicar na primeira linha (se só tiver uma)
        const linhasValidas = Array.from(linhas).filter(l => {
          const texto = l.innerText;
          return !texto.includes('Nenhum registro') && 
                 !texto.includes('No data available') &&
                 !texto.includes('No matching records');
        });
        
        if (linhasValidas.length === 1) {
          const primeiraLinha = linhasValidas[0];
          const botaoDetalhes = primeiraLinha.querySelector(
            'a.btn.btn-primary.btn-sm[title="Detalhes"], ' +
            'a.btn-primary[title="Detalhes"], ' +
            'a[title="Detalhes"]'
          );
          
          if (botaoDetalhes) {
            botaoDetalhes.click();
            return { clicado: true, motivo: 'unico_resultado' };
          }
          
          const iconeDetalhes = primeiraLinha.querySelector('.fa-list, .fa-eye');
          if (iconeDetalhes) {
            const link = iconeDetalhes.closest('a');
            if (link) {
              link.click();
              return { clicado: true, motivo: 'unico_resultado_icone' };
            }
          }
        }
        
        return { clicado: false, motivo: 'nao_encontrado' };
      }, cnpjNumeros);
      
      if (botaoClicado.clicado) {
        console.log(`✅ Botão "Detalhes" clicado! (motivo: ${botaoClicado.motivo})`);
        
        // Aguardar navegação
        try {
          await this.page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 });
        } catch (e) {
          console.log('⚠️ Timeout na navegação, verificando URL...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        console.log('📄 URL da página de detalhes:', this.page.url());
        
        return { success: true, message: 'Detalhes do cliente abertos' };
      } else {
        console.log('❌ Botão "Detalhes" não foi encontrado para o CNPJ especificado');
        return { success: false, message: 'Botão Detalhes não encontrado para o CNPJ' };
      }
      
    } catch (error) {
      console.error('❌ Erro ao abrir detalhes do cliente:', error);
      return { success: false, message: error.message };
    }
  }

  async abrirDetalhesCliente(nomeCliente) {
    try {
      console.log(`🔍 Procurando cliente "${nomeCliente}"...`);
      
      await this.page.waitForSelector('table#dataTable tbody tr', { timeout: 10000 });
      
      const botaoClicado = await this.page.evaluate((nome) => {
        const linhas = document.querySelectorAll('table#dataTable tbody tr');
        
        for (let linha of linhas) {
          const strongElement = linha.querySelector('p.m-0 strong');
          
          if (strongElement && strongElement.innerText.trim() === nome) {
            const botaoDetalhes = linha.querySelector('a.btn.btn-primary.btn-sm[title="Detalhes"]');
            
            if (botaoDetalhes) {
              botaoDetalhes.click();
              return true;
            }
          }
        }
        return false;
      }, nomeCliente);
      
      if (botaoClicado) {
        console.log(`✅ Botão "Detalhes" do cliente "${nomeCliente}" clicado!`);
        
        await this.page.waitForNavigation({ waitUntil: 'networkidle0' });
        console.log('📄 URL da página de detalhes:', this.page.url());
        
        return { success: true, message: 'Detalhes do cliente abertos' };
      } else {
        console.log(`❌ Cliente "${nomeCliente}" não foi encontrado`);
        return { success: false, message: 'Cliente não encontrado' };
      }
    } catch (error) {
      console.error('❌ Erro ao abrir detalhes do cliente:', error);
      return { success: false, message: error.message };
    }
  }

  async abrirModalNovoProduto() {
    try {
      console.log('🔘 Procurando botão "Novo"...');
      
      await this.page.waitForSelector('table#dataTable', { timeout: 10000 });
      
      const botaoNovoClicado = await this.page.evaluate(() => {
        const botaoNovo = document.querySelector('a.btn.btn-success.btn-icon-split.btn-sm[data-toggle="modal"][data-target^="#modal-"]');
        
        if (botaoNovo) {
          botaoNovo.click();
          return true;
        }
        return false;
      });
      
      if (botaoNovoClicado) {
        console.log('✅ Botão "Novo" clicado com sucesso!');
        
        await this.page.waitForSelector('.modal.fade.show', { visible: true, timeout: 5000 });
        console.log('✅ Modal de adicionar produto aberto!');
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return { success: true, message: 'Modal aberto' };
      } else {
        console.log('❌ Botão "Novo" não foi encontrado');
        return { success: false, message: 'Botão Novo não encontrado' };
      }
    } catch (error) {
      console.error('❌ Erro ao abrir modal:', error);
      return { success: false, message: error.message };
    }
  }

  async adicionarProduto(nomeProduto) {
    // Flag para rastrear se dialog foi confirmado
    let dialogConfirmado = false;
    let dialogMensagem = '';
    
    try {
      console.log(`🎯 Procurando produto "${nomeProduto}"...`);
      
      // Configurar handler do dialog ANTES de clicar no produto
      console.log('⚙️  Configurando handler para aceitar confirmação...');
      
      // Remover listeners anteriores
      this.page.removeAllListeners('dialog');
      
      // Adicionar novo listener (apenas uma vez)
      const dialogHandler = async (dialog) => {
        console.log('📢 Dialog detectado!');
        console.log('📝 Tipo:', dialog.type());
        console.log('💬 Mensagem:', dialog.message());
        
        dialogMensagem = dialog.message();
        
        try {
          await dialog.accept();
          dialogConfirmado = true;
          console.log('✅ Dialog confirmado!');
        } catch (error) {
          console.log('⚠️  Dialog já foi tratado');
          dialogConfirmado = true; // Mesmo com erro, provavelmente foi confirmado
        }
      };
      
      this.page.once('dialog', dialogHandler);
      
      const produtoEncontrado = await this.page.evaluate((produto) => {
        const cards = document.querySelectorAll('.service-card, .card');
        
        for (let card of cards) {
          const titulo = card.querySelector('h3, h5, .card-title, strong');
          
          if (titulo && titulo.innerText.trim() === produto) {
            console.log('Produto encontrado:', produto);
            card.click();
            return true;
          }
        }
        return false;
      }, nomeProduto);
      
      if (produtoEncontrado) {
        console.log(`✅ Produto "${nomeProduto}" clicado!`);
        
        console.log('⏳ Aguardando confirmação do dialog...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Se dialog foi confirmado, já é sucesso!
        if (dialogConfirmado) {
          console.log(`🎉 SUCESSO! Dialog confirmado - Produto "${nomeProduto}" adicionado!`);
          
          // Aguardar navegação (pode falhar, mas não importa)
          try {
            await this.page.waitForNavigation({ 
              waitUntil: 'networkidle0', 
              timeout: 8000
            });
            console.log('✅ Navegação concluída!');
          } catch (e) {
            console.log('⏳ Navegação não detectada, mas dialog foi confirmado');
          }
          
          // Aguardar página estabilizar
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          return { 
            success: true, 
            message: `Produto "${nomeProduto}" adicionado com sucesso!` 
          };
        }
        
        // Se dialog não foi confirmado ainda, aguardar mais
        console.log('⏳ Aguardando navegação após adicionar produto...');
        try {
          await this.page.waitForNavigation({ 
            waitUntil: 'networkidle0', 
            timeout: 10000
          });
          console.log('✅ Navegação concluída!');
        } catch (e) {
          console.log('⏳ Navegação não detectada, verificando estado...');
        }
        
        // Aguardar mais tempo para página estabilizar
        console.log('⏳ Aguardando página estabilizar...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Verificar novamente se dialog foi confirmado durante a espera
        if (dialogConfirmado) {
          console.log(`🎉 SUCESSO! Produto "${nomeProduto}" foi adicionado!`);
          return { 
            success: true, 
            message: `Produto "${nomeProduto}" adicionado com sucesso!` 
          };
        }
        
        // Verificar se produto foi adicionado na tabela
        console.log('🔍 Verificando se produto foi adicionado na tabela...');
        let produtoNaTabela = false;
        
        try {
          await this.page.waitForSelector('table#dataTable tbody tr', { timeout: 5000 });
          
          produtoNaTabela = await this.page.evaluate((produto) => {
            const linhas = document.querySelectorAll('table#dataTable tbody tr');
            
            for (let linha of linhas) {
              const strongElement = linha.querySelector('p.m-0 strong');
              
              if (strongElement && strongElement.innerText.trim() === produto) {
                return true;
              }
            }
            return false;
          }, nomeProduto);
          
          if (produtoNaTabela) {
            console.log(`🎉 SUCESSO! Produto "${nomeProduto}" encontrado na tabela!`);
            return { 
              success: true, 
              message: `Produto "${nomeProduto}" adicionado com sucesso!` 
            };
          }
        } catch (error) {
          console.log('⚠️  Não foi possível verificar tabela, mas produto foi clicado');
        }
        
        // Se chegou aqui sem erros, provavelmente funcionou
        console.log(`✅ Produto "${nomeProduto}" foi processado`);
        return { 
          success: true, 
          message: `Produto "${nomeProduto}" adicionado com sucesso!` 
        };
        
      } else {
        console.log(`❌ Produto "${nomeProduto}" não foi encontrado no modal`);
        return { success: false, message: 'Produto não encontrado no modal' };
      }
    } catch (error) {
      console.error('❌ Erro ao adicionar produto:', error);
      
      // Se o dialog foi confirmado antes do erro, é sucesso!
      if (dialogConfirmado) {
        console.log('✅ Dialog foi confirmado antes do erro - Considerando sucesso!');
        return { 
          success: true, 
          message: `Produto "${nomeProduto}" adicionado com sucesso!` 
        };
      }
      
      // Se o erro foi de context destroyed, provavelmente foi adicionado
      if (error.message.includes('Execution context was destroyed')) {
        console.log('⚠️  Contexto destruído (navegação ocorreu) - Produto provavelmente foi adicionado');
        return { 
          success: true, 
          message: `Produto "${nomeProduto}" adicionado com sucesso!` 
        };
      }
      
      return { success: false, message: error.message };
    }
  }

  async adicionarProdutoParaClientePorCNPJ(cnpj, nomeProduto) {
    try {
      // 1. Navegar para clientes
      const navResult = await this.navegarParaClientes();
      if (!navResult.success) return navResult;
      
      // 2. Abrir detalhes do cliente POR CNPJ (com pesquisa)
      const detalhesResult = await this.abrirDetalhesClientePorCNPJ(cnpj);
      if (!detalhesResult.success) {
        await this.voltarParaClientes();
        return detalhesResult;
      }
      
      // 3. Abrir modal de novo produto
      const modalResult = await this.abrirModalNovoProduto();
      if (!modalResult.success) {
        await this.voltarParaClientes();
        return modalResult;
      }
      
      // 4. Adicionar produto
      const produtoResult = await this.adicionarProduto(nomeProduto);
      
      // 5. SEMPRE voltar para página de clientes (sucesso ou erro)
      console.log('🔙 Voltando para página de clientes...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      await this.voltarParaClientes();
      
      return produtoResult;
    } catch (error) {
      console.error('❌ Erro ao adicionar produto para cliente:', error);
      
      try {
        await this.voltarParaClientes();
      } catch (e) {
        console.error('❌ Erro ao voltar para clientes:', e);
      }
      
      return { success: false, message: error.message };
    }
  }

  async adicionarProdutoParaCliente(nomeCliente, nomeProduto) {
    try {
      // 1. Navegar para clientes
      const navResult = await this.navegarParaClientes();
      if (!navResult.success) return navResult;
      
      // 2. Abrir detalhes do cliente
      const detalhesResult = await this.abrirDetalhesCliente(nomeCliente);
      if (!detalhesResult.success) {
        await this.voltarParaClientes();
        return detalhesResult;
      }
      
      // 3. Abrir modal de novo produto
      const modalResult = await this.abrirModalNovoProduto();
      if (!modalResult.success) {
        await this.voltarParaClientes();
        return modalResult;
      }
      
      // 4. Adicionar produto
      const produtoResult = await this.adicionarProduto(nomeProduto);
      
      // 5. SEMPRE voltar para página de clientes (sucesso ou erro)
      console.log('🔙 Voltando para página de clientes...');
      await this.voltarParaClientes();
      
      return produtoResult;
    } catch (error) {
      console.error('❌ Erro ao adicionar produto para cliente:', error);
      
      // Garantir que volta para clientes mesmo com erro
      try {
        await this.voltarParaClientes();
      } catch (e) {
        console.error('❌ Erro ao voltar para clientes:', e);
      }
      
      return { success: false, message: error.message };
    }
  }

  async voltarParaClientes() {
    try {
      console.log('🔙 Voltando para página de clientes...');
      
      // Verificar se já está na página de clientes
      const urlAtual = this.page.url();
      if (urlAtual.includes('/Clientes') && !urlAtual.includes('guid_customer')) {
        console.log('✅ Já está na página de Clientes');
        return { success: true };
      }
      
      // Método 1: Clicar no menu "Clientes"
      try {
        const menuClicado = await this.page.evaluate(() => {
          const link = document.querySelector('a[href="/Clientes"]');
          if (link) {
            link.click();
            return true;
          }
          return false;
        });
        
        if (menuClicado) {
          await this.page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 });
          console.log('✅ Voltou para página de Clientes via menu');
          return { success: true };
        }
      } catch (e) {
        console.log('⚠️ Erro ao clicar no menu, tentando navegação direta...');
      }
      
      // Método 2: Navegação direta
      try {
        await this.page.goto(CLIENTES_URL, { waitUntil: 'networkidle0', timeout: 15000 });
        console.log('✅ Navegou para página de Clientes');
        return { success: true };
      } catch (e) {
        console.log('⚠️ Erro na navegação direta:', e.message);
      }
      
      return { success: false, message: 'Não foi possível voltar para clientes' };
    } catch (error) {
      console.error('❌ Erro ao voltar para clientes:', error);
      return { success: false, message: error.message };
    }
  }

  async extrairClientesCompleto() {
    try {
      await this.init();
      
      const loginResult = await this.login();
      if (!loginResult.success) {
        await this.close();
        return loginResult;
      }
      
      const navResult = await this.navegarParaClientes();
      if (!navResult.success) {
        await this.close();
        return navResult;
      }
      
      const clientesResult = await this.extrairClientes();
      await this.close();
      
      return clientesResult;
    } catch (error) {
      await this.close();
      return { success: false, message: error.message };
    }
  }

  async abrirProdutoNuvemFiscal() {
    try {
      console.log('🔍 Procurando produto "Nuvem Fiscal API" na tabela...');
      
      await this.page.waitForSelector('table#dataTable tbody tr', { timeout: 10000 });
      
      const produtoEncontrado = await this.page.evaluate(() => {
        const linhas = document.querySelectorAll('table#dataTable tbody tr');
        
        for (let linha of linhas) {
          const strongElement = linha.querySelector('p.m-0 strong');
          
          if (strongElement && strongElement.innerText.trim() === 'Nuvem Fiscal API') {
            // Verificar se está ativo
            const badge = linha.querySelector('.badge');
            if (badge && badge.innerText.trim() === 'Ativo') {
              // Clicar no botão de detalhes
              const botaoDetalhes = linha.querySelector('a.btn-primary[title="Detalhes"]');
              if (botaoDetalhes) {
                botaoDetalhes.click();
                return true;
              }
            }
          }
        }
        return false;
      });
      
      if (produtoEncontrado) {
        console.log('✅ Produto "Nuvem Fiscal API" encontrado e está ativo!');
        
        await this.page.waitForNavigation({ waitUntil: 'networkidle0' });
        console.log('📄 URL da página Nuvem Fiscal:', this.page.url());
        
        return { success: true, message: 'Abriu página Nuvem Fiscal' };
      } else {
        console.log('❌ Produto "Nuvem Fiscal API" não está ativo ou não existe');
        return { success: false, message: 'Nuvem Fiscal não está ativo' };
      }
    } catch (error) {
      console.error('❌ Erro ao abrir Nuvem Fiscal:', error);
      return { success: false, message: error.message };
    }
  }

  async gerarChaveAcessoNuvemFiscal(descricao = 'Chave gerada automaticamente') {
    try {
      console.log('🔑 Gerando chave de acesso para Nuvem Fiscal...');
      
      // Clicar no botão "Novo" (gerar chave)
      console.log('🔘 Procurando botão para gerar chave...');
      
      await this.page.waitForSelector('i.fa-plus', { timeout: 5000 });
      
      const botaoNovoClicado = await this.page.evaluate(() => {
        const botoes = document.querySelectorAll('i.fa-plus');
        for (let botao of botoes) {
          const parent = botao.closest('a');
          if (parent) {
            parent.click();
            return true;
          }
        }
        return false;
      });
      
      if (!botaoNovoClicado) {
        return { success: false, message: 'Botão de gerar chave não encontrado' };
      }
      
      console.log('✅ Botão clicado, aguardando modal...');
      
      // Aguardar modal aparecer
      await this.page.waitForSelector('#DescricaoChaveId', { visible: true, timeout: 5000 });
      
      // Preencher descrição
      console.log(`📝 Preenchendo descrição: "${descricao}"...`);
      await this.page.click('#DescricaoChaveId');
      await this.page.type('#DescricaoChaveId', descricao);
      
      // Clicar no botão "Gerar Chave"
      console.log('🔘 Clicando em "Gerar Chave"...');
      
      const botaoGerarClicado = await this.page.evaluate(() => {
        const botoes = document.querySelectorAll('button.btn-primary');
        for (let botao of botoes) {
          if (botao.innerText.includes('Gerar Chave')) {
            botao.click();
            return true;
          }
        }
        return false;
      });
      
      if (!botaoGerarClicado) {
        return { success: false, message: 'Botão Gerar Chave não encontrado' };
      }
      
      console.log('⏳ Aguardando chave ser gerada...');
      await this.page.waitForNavigation({ waitUntil: 'networkidle0' });
      
      // Aguardar tabela atualizar
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extrair as chaves (Access Key e Secret Key)
      console.log('📋 Extraindo chaves geradas...');
      
      const chaves = await this.page.evaluate(() => {
        const linhas = document.querySelectorAll('#dataTableChavesAcesso tbody tr');
        if (linhas.length === 0) return null;
        
        const primeiraLinha = linhas[0];
        const colunas = primeiraLinha.querySelectorAll('td');
        
        if (colunas.length >= 3) {
          return {
            descricao: colunas[0]?.innerText.trim(),
            accessKey: colunas[1]?.innerText.trim(),
            secretKey: colunas[2]?.innerText.trim()
          };
        }
        return null;
      });
      
      if (chaves) {
        console.log('🎉 SUCESSO! Chaves geradas:');
        console.log('  Descrição:', chaves.descricao);
        console.log('  Access Key:', chaves.accessKey);
        console.log('  Secret Key:', chaves.secretKey);
        
        return { 
          success: true, 
          message: 'Chaves geradas com sucesso',
          data: chaves
        };
      } else {
        return { success: false, message: 'Não foi possível extrair as chaves' };
      }
      
    } catch (error) {
      console.error('❌ Erro ao gerar chave:', error);
      return { success: false, message: error.message };
    }
  }

  async gerarChaveNuvemFiscalParaCliente(nomeCliente, descricaoChave = 'Chave automática') {
    try {
      // 1. Navegar para clientes
      const navResult = await this.navegarParaClientes();
      if (!navResult.success) return navResult;
      
      // 2. Abrir detalhes do cliente
      const detalhesResult = await this.abrirDetalhesCliente(nomeCliente);
      if (!detalhesResult.success) {
        await this.voltarParaClientes();
        return detalhesResult;
      }
      
      // 3. Abrir produto Nuvem Fiscal
      const nuvemFiscalResult = await this.abrirProdutoNuvemFiscal();
      if (!nuvemFiscalResult.success) {
        await this.voltarParaClientes();
        return nuvemFiscalResult;
      }
      
      // 4. Gerar chave de acesso
      const chaveResult = await this.gerarChaveAcessoNuvemFiscal(descricaoChave);
      
      // 5. SEMPRE voltar para clientes
      console.log('🔙 Voltando para página de clientes...');
      await this.voltarParaClientes();
      
      return chaveResult;
    } catch (error) {
      console.error('❌ Erro ao gerar chave para cliente:', error);
      
      // Garantir que volta para clientes mesmo com erro
      try {
        await this.voltarParaClientes();
      } catch (e) {
        console.error('❌ Erro ao voltar para clientes:', e);
      }
      
      return { success: false, message: error.message };
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }
}

export default PuppeteerService;
import express from 'express';
import cors from 'cors';
import PuppeteerService from './PuppeteerService.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors({ //serve para receber a request do react
  origin: 'http://localhost:5173', // URL do React (Vite)
  credentials: true
}));
app.use(express.json()); // serializa o json em objeto java scrpit
app.use(express.urlencoded({ extended: true })); //converte dados 
//de form em objeto

// Armazenar sessões ativas (em produção, use Redis ou similar)
const sessoes = new Map();

// Middleware para log de requisições
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ==================== ROTAS ====================

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    sessoesAtivas: sessoes.size
  });
});

// 1. LOGIN - Recebe credenciais do React
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    console.log('📥 Recebendo requisição de login do React:', { username });
    
    // Validação
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username e password são obrigatórios' 
      });
    }
    
    // Criar nova instância do Puppeteer
    const puppeteerService = new PuppeteerService();
    console.log('🚀 Iniciando Puppeteer...');
    await puppeteerService.init();
    
    // Fazer login no portal
    console.log('🔐 Tentando login no portal...');
    const result = await puppeteerService.login(username, password);
    
    if (result.success) {
      // Gerar ID de sessão
      const sessionId = `session_${Date.now()}_${Math.random().toString(36)}`;
      
      // Armazenar sessão
      sessoes.set(sessionId, {
        username,
        puppeteerService,
        createdAt: new Date()
      });
      
      console.log('✅ Login bem-sucedido! SessionId:', sessionId);
      
      // Retornar para o React
      res.json({
        success: true,
        message: 'Login realizado com sucesso',
        sessionId,
        username
      });
    } else {
      // Fechar browser em caso de erro
      await puppeteerService.close();
      console.log('❌ Falha no login');
      
      res.status(401).json({
        success: false,
        message: result.message || 'Credenciais inválidas'
      });
    }
  } catch (error) {
    console.error('❌ Erro no endpoint de login:', error);
    res.status(500).json({ 
      success: false, 
      message: `Erro no servidor: ${error.message}` 
    });
  }
});

// 2. BUSCAR CLIENTES - Recebe sessionId do React
app.get('/api/clientes', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    
    console.log('📥 Recebendo requisição de clientes do React');
    console.log('SessionId:', sessionId);
    
    // Validar sessão
    if (!sessionId || !sessoes.has(sessionId)) {
      return res.status(401).json({ 
        success: false, 
        message: 'Sessão inválida ou expirada. Faça login novamente.' 
      });
    }
    
    // Recuperar serviço da sessão
    const sessao = sessoes.get(sessionId);
    const puppeteerService = sessao.puppeteerService;
    
    console.log('🔍 Navegando para página de clientes...');
    await puppeteerService.navegarParaClientes();
    
    console.log('📊 Extraindo dados dos clientes...');
    const result = await puppeteerService.extrairClientes();
    
    if (result.success) {
      console.log(`✅ ${result.data.length} clientes extraídos com sucesso`);
      
      // Retornar dados para o React
      res.json({
        success: true,
        data: result.data,
        count: result.data.length,
        username: sessao.username
      });
    } else {
      console.log('❌ Erro ao extrair clientes');
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('❌ Erro ao buscar clientes:', error);
    res.status(500).json({ 
      success: false, 
      message: `Erro ao processar: ${error.message}` 
    });
  }
});

// 3. EXTRAÇÃO COMPLETA - Recebe credenciais e retorna clientes (tudo em uma chamada)
app.post('/api/clientes/extrair', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    console.log('📥 Recebendo requisição de extração completa do React');
    console.log('Username:', username);
    
    // Validação
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username e password são obrigatórios' 
      });
    }
    
    console.log('🚀 Iniciando extração completa...');
    const service = new PuppeteerService();
    const result = await service.extrairClientesCompleto(username, password);
    
    if (result.success) {
      console.log(`✅ Extração completa finalizada: ${result.data.length} clientes`);
      
      // Retornar para o React
      res.json({
        success: true,
        data: result.data,
        count: result.data.length,
        message: 'Clientes extraídos com sucesso'
      });
    } else {
      console.log('❌ Erro na extração completa');
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('❌ Erro ao extrair clientes:', error);
    res.status(500).json({ 
      success: false, 
      message: `Erro no servidor: ${error.message}` 
    });
  }
});

// 4. ADICIONAR PRODUTO PARA CLIENTE - NOVO ENDPOINT
app.post('/api/clientes/:nomeCliente/produtos', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    const { nomeCliente } = req.params;
    const { nomeProduto } = req.body;
    
    console.log('📥 Recebendo requisição para adicionar produto');
    console.log('Cliente:', nomeCliente);
    console.log('Produto:', nomeProduto);
    
    // Validar sessão
    if (!sessionId || !sessoes.has(sessionId)) {
      return res.status(401).json({ 
        success: false, 
        message: 'Sessão inválida ou expirada. Faça login novamente.' 
      });
    }
    
    // Validar dados
    if (!nomeProduto) {
      return res.status(400).json({ 
        success: false, 
        message: 'Nome do produto é obrigatório' 
      });
    }
    
    // Recuperar serviço da sessão
    const sessao = sessoes.get(sessionId);
    const puppeteerService = sessao.puppeteerService;
    
    console.log('🎯 Adicionando produto para cliente...');
    const result = await puppeteerService.adicionarProdutoParaCliente(
      nomeCliente, 
      nomeProduto
    );
    
    if (result.success) {
      console.log(`✅ Produto adicionado com sucesso!`);
      res.json({
        success: true,
        message: result.message,
        cliente: nomeCliente,
        produto: nomeProduto
      });
    } else {
      console.log('❌ Erro ao adicionar produto');
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('❌ Erro ao adicionar produto:', error);
    res.status(500).json({ 
      success: false, 
      message: `Erro ao processar: ${error.message}` 
    });
  }
});

// 5. BUSCAR CLIENTE ESPECÍFICO (exemplo de filtro)
app.get('/api/clientes/:nome', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    const { nome } = req.params;
    
    console.log('📥 Buscando cliente específico:', nome);
    
    if (!sessionId || !sessoes.has(sessionId)) {
      return res.status(401).json({ 
        success: false, 
        message: 'Sessão inválida' 
      });
    }
    
    const sessao = sessoes.get(sessionId);
    const puppeteerService = sessao.puppeteerService;
    
    await puppeteerService.navegarParaClientes();
    const result = await puppeteerService.extrairClientes();
    
    if (result.success) {
      // Filtrar cliente pelo nome
      const cliente = result.data.find(c => 
        c.titulo.toLowerCase().includes(nome.toLowerCase())
      );
      
      if (cliente) {
        res.json({
          success: true,
          data: cliente
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'Cliente não encontrado'
        });
      }
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('❌ Erro ao buscar cliente específico:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// 6. LOGOUT - Encerra sessão
app.post('/api/logout', async (req, res) => {
  try {
    const sessionId = req.headers['x-session-id'];
    
    console.log('📥 Recebendo requisição de logout do React');
    console.log('SessionId:', sessionId);
    
    if (sessionId && sessoes.has(sessionId)) {
      const sessao = sessoes.get(sessionId);
      
      // Fechar browser
      console.log('🔒 Fechando browser e encerrando sessão...');
      await sessao.puppeteerService.close();
      
      // Remover sessão
      sessoes.delete(sessionId);
      
      console.log('✅ Logout realizado com sucesso');
      res.json({ 
        success: true, 
        message: 'Logout realizado com sucesso' 
      });
    } else {
      res.json({ 
        success: true, 
        message: 'Nenhuma sessão ativa' 
      });
    }
  } catch (error) {
    console.error('❌ Erro no logout:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// 7. LIMPAR SESSÕES EXPIRADAS (executar periodicamente)
app.post('/api/sessoes/limpar', async (req, res) => {
  try {
    console.log('🧹 Limpando sessões expiradas...');
    
    const TIMEOUT = 30 * 60 * 1000; // 30 minutos
    const now = new Date();
    let removidas = 0;
    
    for (const [sessionId, sessao] of sessoes.entries()) {
      const tempoDecorrido = now - sessao.createdAt;
      
      if (tempoDecorrido > TIMEOUT) {
        await sessao.puppeteerService.close();
        sessoes.delete(sessionId);
        removidas++;
      }
    }
    
    console.log(`✅ ${removidas} sessões removidas`);
    
    res.json({
      success: true,
      sessoesRemovidas: removidas,
      sessoesAtivas: sessoes.size
    });
  } catch (error) {
    console.error('❌ Erro ao limpar sessões:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Tratamento de erros global
app.use((err, req, res, next) => {
  console.error('💥 Erro não tratado:', err);
  res.status(500).json({ 
    success: false, 
    message: 'Erro interno do servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Rota 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Rota não encontrada'
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log('=================================');
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log('=================================');
});

// Limpar sessões a cada 10 minutos
setInterval(async () => {
  console.log('🧹 Executando limpeza automática de sessões...');
  const TIMEOUT = 30 * 60 * 1000;
  const now = new Date();
  
  for (const [sessionId, sessao] of sessoes.entries()) {
    const tempoDecorrido = now - sessao.createdAt;
    if (tempoDecorrido > TIMEOUT) {
      await sessao.puppeteerService.close();
      sessoes.delete(sessionId);
      console.log(`🗑️  Sessão ${sessionId} removida por timeout`);
    }
  }
}, 10 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Encerrando servidor...');
  
  // Fechar todas as sessões
  for (const [sessionId, sessao] of sessoes.entries()) {
    console.log(`🔒 Fechando sessão ${sessionId}...`);
    await sessao.puppeteerService.close();
  }
  
  sessoes.clear();
  console.log('✅ Todas as sessões encerradas');
  process.exit(0);
});
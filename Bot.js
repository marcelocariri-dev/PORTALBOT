import { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import PuppeteerService from './PuppeteerService.js';
import dotenv from 'dotenv';

dotenv.config();

// Configurações
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// Instância única do Puppeteer (reutilizável)
let puppeteerService = null;
let isInitialized = false;

// Cliente Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Comandos Slash
const commands = [
  new SlashCommandBuilder()
    .setName('iniciar')
    .setDescription('Inicia o bot e faz login no portal'),
  
  new SlashCommandBuilder()
    .setName('listar-clientes')
    .setDescription('Lista todos os clientes do portal'),
  
  new SlashCommandBuilder()
    .setName('adicionar-produto')
    .setDescription('Adiciona um produto para um cliente')
    .addStringOption(option =>
      option.setName('cnpj')
        .setDescription('CNPJ do cliente (formato: 00.000.000/0000-00)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('produto')
        .setDescription('Nome do produto a ser adicionado')
        .setRequired(true)
        .addChoices(
          { name: 'Agendar.Ai', value: 'Agendar.Ai' },
          { name: 'API Cobrança', value: 'API Cobrança' },
          { name: 'Catálogo Digital', value: 'Catálogo Digital' },
          { name: 'Certificado Digital', value: 'Certificado Digital' },
          { name: 'Collector', value: 'Collector' },
          { name: 'Conciliador de Cartões', value: 'Conciliador de Cartões' },
          { name: 'DDA - Nuvem de Boletos', value: 'DDA - Nuvem de Boletos' },
          { name: 'Drica IA (WhatsApp)', value: 'Drica IA (WhatsApp)' },
          { name: 'EDocs (NFs-e)', value: 'EDocs (NFs-e)' },
          {
            name: 'Integration Marketplace', value: 'Integration Marketplace'
          },
          { name: 'Integração Contábil', value: 'Integração Contábil' },
          { name: 'Nuvem Fiscal API', value: 'Nuvem Fiscal API' },
          { name: 'QueroBonus', value: 'QueroBonus' },
          { name: 'Relay Server', value: 'Relay Server' },
          { name: 'Softcom Backup', value: 'Softcom Backup' },
          { name: 'SoftcomPay', value: 'SoftcomPay' },
          { name: 'SoftcomShip', value: 'SoftcomShip' },
          { name: 'SoftConnect', value: 'SoftConnect' },
          { name: 'SoftDelivery', value: 'SoftDelivery' },
          
          { name: 'Tá na Mão', value: 'Tá na Mão' },
          { name: 'Tá no Menu', value: 'Tá no Menu' },
          { name: 'Venda Mais CRM', value: 'Venda Mais CRM' },
          { name: 'Vendas360', value: 'Vendas360' },
        )),
  
  new SlashCommandBuilder()
    .setName('buscar-cliente')
    .setDescription('Busca um cliente específico por nome')
    .addStringOption(option =>
      option.setName('nome')
        .setDescription('Nome do cliente')
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Verifica o status do bot'),
  
  new SlashCommandBuilder()
    .setName('desligar')
    .setDescription('Desliga o bot e fecha o navegador'),
  
  new SlashCommandBuilder()
    .setName('gerar-chave-nuvem')
    .setDescription('Gera chave de acesso Nuvem Fiscal para um cliente')
    .addStringOption(option =>
      option.setName('cnpj')
        .setDescription('CNPJ do cliente (formato: 00.000.000/0000-00)')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('descricao')
        .setDescription('Descrição da chave (opcional)')
        .setRequired(false)),
];

// Registrar comandos
const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommands() {
  try {
    console.log('🔄 Registrando comandos slash...');
    
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands },
    );
    
    console.log('✅ Comandos registrados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao registrar comandos:', error);
  }
}

// Inicializar Puppeteer
async function initPuppeteer() {
  try {
    if (!puppeteerService) {
      puppeteerService = new PuppeteerService();
      await puppeteerService.init();
      await puppeteerService.login();
      isInitialized = true;
      console.log('✅ Puppeteer inicializado e logado!');
      return { success: true, message: 'Bot iniciado e conectado ao portal!' };
    } else {
      return { success: true, message: 'Bot já está iniciado!' };
    }
  } catch (error) {
    console.error('❌ Erro ao inicializar Puppeteer:', error);
    isInitialized = false;
    return { success: false, message: `Erro: ${error.message}` };
  }
}

// Verificar se está inicializado
function checkInitialized() {
  if (!isInitialized || !puppeteerService) {
    return false;
  }
  return true;
}

// Quando o bot estiver pronto
client.once('ready', async () => {
  console.log('=================================');
  console.log(`🤖 Bot logado como ${client.user.tag}`);
  console.log('=================================');
  
  await registerCommands();
  
  // Inicializar Puppeteer automaticamente
  console.log('🚀 Inicializando Puppeteer automaticamente...');
  await initPuppeteer();
});

// Comandos de Interação
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    // Comando: /iniciar
    if (commandName === 'iniciar') {
      await interaction.deferReply();
      
      const result = await initPuppeteer();
      
      const embed = new EmbedBuilder()
        .setTitle(result.success ? '✅ Bot Iniciado' : '❌ Erro')
        .setDescription(result.message)
        .setColor(result.success ? 0x00ff00 : 0xff0000)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
    }

    // Comando: /listar-clientes
    else if (commandName === 'listar-clientes') {
      if (!checkInitialized()) {
        await interaction.reply('❌ Bot não está iniciado! Use `/iniciar` primeiro.');
        return;
      }

      await interaction.deferReply();

      await puppeteerService.navegarParaClientes();
      const result = await puppeteerService.extrairClientes();

      if (result.success) {
        const clientes = result.data.slice(0, 10); // Primeiros 10
        
        const embed = new EmbedBuilder()
          .setTitle('📋 Lista de Clientes')
          .setDescription(`Total: ${result.data.length} clientes`)
          .setColor(0x0099ff)
          .setTimestamp();

        clientes.forEach((cliente, index) => {
          embed.addFields({
            name: `${index + 1}. ${cliente.titulo}`,
            value: cliente.cnpj || 'CNPJ não disponível',
            inline: false
          });
        });

        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply(`❌ Erro: ${result.message}`);
      }
    }

    // Comando: /adicionar-produto
    else if (commandName === 'adicionar-produto') {
      if (!checkInitialized()) {
        await interaction.reply('❌ Bot não está iniciado! Use `/iniciar` primeiro.');
        return;
      }

      const cnpj = interaction.options.getString('cnpj');
      const produto = interaction.options.getString('produto');

      await interaction.deferReply();

      const embed = new EmbedBuilder()
        .setTitle('⏳ Processando...')
        .setDescription(`Adicionando **${produto}** para o cliente **${cnpj}**`)
        .setColor(0xffff00)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Buscar cliente por CNPJ
      await puppeteerService.navegarParaClientes();
      //nst clientesResult = await puppeteerService.extrairClientes();

     
 
      
  

      // Adicionar produto usando CNPJ (com pesquisa)
      const result = await puppeteerService.adicionarProdutoParaClientePorCNPJ(
        cnpj,
        produto
      );

      const finalEmbed = new EmbedBuilder()
        .setTitle(result.success ? '✅ Sucesso!' : '❌ Erro')
        .setDescription(result.message)
        .addFields(
          { name: 'CNPJ', value: cnpj, inline: true },
          { name: 'Produto', value: produto, inline: true }
        )
        .setColor(result.success ? 0x00ff00 : 0xff0000)
        .setTimestamp();

      await interaction.editReply({ embeds: [finalEmbed] });
    }

    // Comando: /buscar-cliente
    else if (commandName === 'buscar-cliente') {
      if (!checkInitialized()) {
        await interaction.reply('❌ Bot não está iniciado! Use `/iniciar` primeiro.');
        return;
      }

      const nome = interaction.options.getString('nome');

      await interaction.deferReply();

      await puppeteerService.navegarParaClientes();
      const result = await puppeteerService.extrairClientes();

      if (result.success) {
        const clientesEncontrados = result.data.filter(c =>
          c.titulo.toLowerCase().includes(nome.toLowerCase())
        );

        if (clientesEncontrados.length === 0) {
          await interaction.editReply(`❌ Nenhum cliente encontrado com o nome: **${nome}**`);
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle('🔍 Clientes Encontrados')
          .setDescription(`Encontrados ${clientesEncontrados.length} cliente(s)`)
          .setColor(0x0099ff)
          .setTimestamp();

        clientesEncontrados.slice(0, 5).forEach((cliente, index) => {
          embed.addFields({
            name: `${index + 1}. ${cliente.titulo}`,
            value: cliente.cnpj || 'CNPJ não disponível',
            inline: false
          });
        });

        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.editReply(`❌ Erro: ${result.message}`);
      }
    }

    // Comando: /status
    else if (commandName === 'status') {
      const embed = new EmbedBuilder()
        .setTitle('📊 Status do Bot')
        .addFields(
          { name: 'Status', value: isInitialized ? '🟢 Online' : '🔴 Offline', inline: true },
          { name: 'Navegador', value: puppeteerService ? '✅ Ativo' : '❌ Inativo', inline: true },
          { name: 'Uptime', value: `${Math.floor(client.uptime / 1000 / 60)} minutos`, inline: true }
        )
        .setColor(isInitialized ? 0x00ff00 : 0xff0000)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // Comando: /desligar
    else if (commandName === 'desligar') {
      await interaction.reply('🔒 Desligando bot...');

      if (puppeteerService) {
        await puppeteerService.close();
        puppeteerService = null;
        isInitialized = false;
      }

      await client.destroy();
      process.exit(0);
    }

    // Comando: /gerar-chave-nuvem
    else if (commandName === 'gerar-chave-nuvem') {
      if (!checkInitialized()) {
        await interaction.reply('❌ Bot não está iniciado! Use `/iniciar` primeiro.');
        return;
      }

      const cnpj = interaction.options.getString('cnpj');
      const descricao = interaction.options.getString('descricao') || 'Chave gerada via Discord Bot';

      await interaction.deferReply();

      const embed = new EmbedBuilder()
        .setTitle('⏳ Processando...')
        .setDescription(`Gerando chave Nuvem Fiscal para o cliente **${cnpj}**`)
        .setColor(0xffff00)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Buscar cliente por CNPJ
      await puppeteerService.navegarParaClientes();
      const clientesResult = await puppeteerService.extrairClientes();

      if (!clientesResult.success) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Erro')
          .setDescription(`Não foi possível listar clientes: ${clientesResult.message}`)
          .setColor(0xff0000);
        
        await interaction.editReply({ embeds: [errorEmbed] });
        return;
      }

      // Encontrar cliente pelo CNPJ
      const cliente = clientesResult.data.find(c => 
        c.cnpj && c.cnpj.replace(/\D/g, '') === cnpj.replace(/\D/g, '')
      );

      if (!cliente) {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Cliente não encontrado')
          .setDescription(`Nenhum cliente encontrado com o CNPJ: **${cnpj}**`)
          .setColor(0xff0000);
        
        await interaction.editReply({ embeds: [errorEmbed] });
        return;
      }

      // Gerar chave Nuvem Fiscal
      const result = await puppeteerService.gerarChaveNuvemFiscalParaCliente(
        cliente.titulo,
        descricao
      );

      if (result.success && result.data) {
        const finalEmbed = new EmbedBuilder()
          .setTitle('✅ Chaves Geradas com Sucesso!')
          .setDescription(`Chaves de acesso Nuvem Fiscal para **${cliente.titulo}**`)
          .addFields(
            { name: '👤 Cliente', value: cliente.titulo, inline: false },
            { name: '📄 CNPJ', value: cnpj, inline: true },
            { name: '📝 Descrição', value: result.data.descricao, inline: true },
            { name: '🔑 Access Key', value: `\`\`\`${result.data.accessKey}\`\`\``, inline: false },
            { name: '🔐 Secret Key', value: `\`\`\`${result.data.secretKey}\`\`\``, inline: false }
          )
          .setColor(0x00ff00)
          .setFooter({ text: '⚠️ Guarde estas chaves em local seguro!' })
          .setTimestamp();

        await interaction.editReply({ embeds: [finalEmbed] });
      } else {
        const errorEmbed = new EmbedBuilder()
          .setTitle('❌ Erro ao Gerar Chaves')
          .setDescription(result.message || 'Nuvem Fiscal pode não estar ativo para este cliente')
          .addFields(
            { name: 'Cliente', value: cliente.titulo, inline: true },
            { name: 'CNPJ', value: cnpj, inline: true }
          )
          .setColor(0xff0000)
          .setTimestamp();

        await interaction.editReply({ embeds: [errorEmbed] });
      }
    }

  } catch (error) {
    console.error('❌ Erro ao processar comando:', error);
    
    const errorMessage = interaction.deferred || interaction.replied
      ? { content: `❌ Erro: ${error.message}`, ephemeral: true }
      : `❌ Erro: ${error.message}`;
    
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(errorMessage);
    } else {
      await interaction.reply(errorMessage);
    }
  }
});

// Login do bot
client.login(TOKEN);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Encerrando bot...');
  
  if (puppeteerService) {
    await puppeteerService.close();
  }
  
  await client.destroy();
  process.exit(0);
});
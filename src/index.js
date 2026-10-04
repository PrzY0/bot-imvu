// =================================================================
// BOT PRZ0 - IMVU AUTOMATED ASSISTANT
// =================================================================

// --- 1. CONFIGURAÇÕES E ESTADO DO REPRODUTOR ---
const playlistPadrao = [
    "https://link-da-musica-1.mp3",
    "https://link-da-musica-2.mp3",
    "https://link-da-musica-3.mp3"
];

let filaPedidos = [];          // Fila de músicas enviadas pelos usuários
let historicoTocadas = [];     // Histórico para permitir voltar a música
let musicaAtual = null;        // Música que está tocando no momento
let tocaPlaylistPadrao = true; // Define se está no Auto-Play ou nos pedidos
let indicePadrao = 0;          // Posição na playlist padrão
let estaPausado = false;       // Estado do áudio

// --- 2. VOTAÇÃO DE KICK (70% MÍNIMO) ---
let votacaoKick = {
    ativo: false,
    alvo: null,
    votosSim: new Set()
};

// --- 3. PIADAS E BRINCADEIRAS LEVES ---
const piadas = [
    "O que o zero disse para o oito? 'Belo cinto!' 😂",
    "Qual é o cúmulo da paciência? Dobrar a água para guardar na gaveta! 😅",
    "Por que o livro de matemática se suicidou? Porque tinha muitos problemas! 📖",
    "O que o café disse para o leite? 'Sem você eu fico preto de raiva!' ☕"
];

// =================================================================
// LÓGICA DO REPRODUTOR DE MÚSICA
// =================================================================

function tocarProximaMusica(quantidadePessoasNaSala) {
    if (musicaAtual) {
        historicoTocadas.push(musicaAtual);
    }
    
    estaPausado = false;

    if (quantidadePessoasNaSala <= 1 || filaPedidos.length === 0) {
        if (quantidadePessoasNaSala <= 1) {
            filaPedidos = []; // Reseta a fila se a sala esvaziar
        }
        tocaPlaylistPadrao = true;
        const url = playlistPadrao[indicePadrao];
        musicaAtual = { url: url, pedidaPor: "Auto-Play" };
        indicePadrao = (indicePadrao + 1) % playlistPadrao.length;
    } else {
        tocaPlaylistPadrao = false;
        musicaAtual = filaPedidos.shift();
    }

    executarTocador(musicaAtual.url, musicaAtual.pedidaPor);
}

function tocarMusicaAnterior() {
    if (historicoTocadas.length === 0) {
        return "Não há nenhuma música anterior no histórico para voltar!";
    }

    if (musicaAtual) {
        filaPedidos.unshift(musicaAtual);
    }

    musicaAtual = historicoTocadas.pop();
    estaPausado = false;
    executarTocador(musicaAtual.url, musicaAtual.pedidaPor);
    return `⏪ Voltando para a música anterior: ${musicaAtual.url}`;
}

function executarTocador(url, quemPediu) {
    console.log(`[REPRODUZINDO]: ${url} | Pedido por: ${quemPediu}`);
}

// =================================================================
// SAUDAÇÃO AUTOMÁTICA POR HORÁRIO
// =================================================================

function saudarNovoUsuario(nomeUsuario) {
    const hora = new Date().getHours();
    let saudacao = "Boa noite";

    if (hora >= 6 && hora < 12) {
        saudacao = "Bom dia";
    } else if (hora >= 12 && hora < 18) {
        saudacao = "Boa tarde";
    }

    return `${saudacao}, ${nomeUsuario}! Seja bem-vindo(a) à sala! 😊`;
}

// =================================================================
// PROCESSADOR DE COMANDOS DE CHAT
// =================================================================

function processarMensagemChat(usuario, mensagem, totalPessoasNaSala) {
    const msgLimpa = mensagem.trim();
    const partes = msgLimpa.split(" ");
    const comando = partes[0].toLowerCase();
    const argumento = partes.slice(1).join(" ");

    // --- 1. CONTROLES DE MÚSICA ---

    // Adicionar música: !msc, !mcsc ou msc-p
    if (comando === "!msc" || comando === "!mcsc" || comando === "msc-p") {
        if (!argumento) return "Envie o comando assim: !msc [nome ou link da música]";
        
        filaPedidos.push({ url: argumento, pedidaPor: usuario });
        
        if (tocaPlaylistPadrao) {
            tocarProximaMusica(totalPessoasNaSala);
            return `🎶 TOCANDO AGORA a música pedida por ${usuario}!`;
        }
        
        return `🎵 Música adicionada à fila por ${usuario}! Posição na fila: ${filaPedidos.length}`;
    }

    // Pausar: P, p ou MSC/P
    if (msgLimpa === "P" || msgLimpa === "p" || comando === "msc/p" || comando === "!pausa") {
        estaPausado = true;
        return "⏸️ Música pausada. Digite D para despausar.";
    }

    // Despausar: D ou d
    if (msgLimpa === "D" || msgLimpa === "d" || comando === "!play") {
        estaPausado = false;
        return "▶️ Reprodução retomada!";
    }

    // Pular / Avançar: >
    if (msgLimpa === ">" || comando === "!pular" || comando === "⏩" || comando === "!next") {
        tocarProximaMusica(totalPessoasNaSala);
        return `> ${usuario} avançou a música! Tocando a próxima...`;
    }

    // Voltar música: < ou MSC/
    if (msgLimpa === "<" || comando === "msc/" || comando === "!voltar" || comando === "⏪") {
        return tocarMusicaAnterior();
    }

    // Remover música específica da fila
    if (comando === "!remover") {
        const num = parseInt(argumento) - 1;
        if (!isNaN(num) && num >= 0 && num < filaPedidos.length) {
            const removida = filaPedidos.splice(num, 1);
            return `🗑️ A música '${removida[0].url}' foi removida da fila por ${usuario}.`;
        }
        return "Número inválido! Digite !fila para ver a ordem das músicas.";
    }

    // Ver fila de músicas
    if (comando === "!fila") {
        if (filaPedidos.length === 0) return "A fila de pedidos está vazia no momento.";
        
        let textoFila = "🎵 **Fila de Músicas:**\n";
        filaPedidos.forEach((item, index) => {
            textoFila += `${index + 1}. ${item.url} (Pedida por: ${item.pedidaPor})\n`;
        });
        return textoFila;
    }

    // --- 2. MODERAÇÃO / VOTAÇÃO DE KICK (70% DOS PRESENTES) ---

    if (comando === "!kick") {
        if (!argumento) return "Digite !kick [nome do usuário] para abrir a votação.";
        
        // Votantes elegíveis = Total na sala - Bot - Alvo
        const votantesElegiveis = totalPessoasNaSala - 2; 

        // Trava para evitar kick em duelo de 2 pessoas
        if (votantesElegiveis < 2) {
            return "Não há pessoas suficientes na sala para abrir uma votação! Mínimo necessário: 3 pessoas.";
        }

        // Calcula a meta de 70% arredondada para cima
        const votosNecessarios = Math.ceil(votantesElegiveis * 0.7);

        votacaoKick.alvo = argumento;
        votacaoKick.votosSim.clear();
        votacaoKick.votosSim.add(usuario); // Quem abriu já conta 1 voto
        votacaoKick.ativo = true;

        return `⚠ Votação iniciada para remover ${argumento}! Regra de 70%: São necessários ${votosNecessarios} votos 'SIM' de ${votantesElegiveis} pessoas elegíveis. Digite !sim para votar.`;
    }

    if (comando === "!sim" && votacaoKick.ativo) {
        if (usuario === votacaoKick.alvo) return "Você não pode votar na sua própria votação de kick!";

        votacaoKick.votosSim.add(usuario);
        
        const votantesElegiveis = totalPessoasNaSala - 2;
        const votosNecessarios = Math.ceil(votantesElegiveis * 0.7);

        // Se atingiu a marca de 70%
        if (votacaoKick.votosSim.size >= votosNecessarios) {
            const alvoRemovido = votacaoKick.alvo;
            votacaoKick.ativo = false;
            return `🚫 Votação concluída (70%+ atingido)! ${alvoRemovido} foi removido(a) da sala.`;
        }

        const faltam = votosNecessarios - votacaoKick.votosSim.size;
        return `Voto registrado por ${usuario}! Faltam ${faltam} voto(s) para atingir os 70% necessários.`;
    }

    return null;
}

// --- 3. BRINCADEIRAS AUTOMÁTICAS ---
setInterval(() => {
    const piadaSorteada = piadas[Math.floor(Math.random() * piadas.length)];
    console.log(`[BRINCADEIRA]: Pessoal, aí vai uma pra descontrair: ${piadaSorteada}`);
}, 25 * 60 * 1000);const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// Configurações do Bot
const BOT_NAME = process.env.BOT_USERNAME || 'Prz0';
const BOT_PASS = process.env.BOT_PASSWORD || '';
const ROOM_ID = process.env.ROOM_ID || '';

app.use(express.json());

// Servidor Web para manter o Render ativo
app.get('/', (req, res) => {

  res.send(`Bot ${BOT_NAME} está ativo e conectado ao IMVU!`);
});

// Função de autenticação e conexão via API IMVU
async function conectarIMVU() {
  console.log(`[IMVU] A autenticar conta do bot: ${BOT_NAME}...`);
  
  try {
    // Autenticação na API do IMVU
    const loginRes = await axios.post('https://api.imvu.com/login', {
      username: BOT_NAME,
      password: BOT_PASS
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    console.log(`[IMVU] Login efetuado com sucesso!`);

    if (ROOM_ID) {
      console.log(`[IMVU] A entrar na sala ID: ${ROOM_ID}...`);
      // Envia requisição para juntar o avatar à sala 3D
      await axios.post(`https://api.imvu.com/room/${ROOM_ID}/join`, {}, {
        headers: {
          'Cookie': loginRes.headers['set-cookie'] ? loginRes.headers['set-cookie'].join('; ') : ''
        }
      });
      console.log(`[IMVU] Bot ${BOT_NAME} entrou na sala com sucesso!`);
    } else {
      console.log(`[IMVU] AVISO: Nenhum ROOM_ID configurado nas variáveis de ambiente.`);
    }

  } catch (error) {
    console.log(`[IMVU] Erro de ligação: ${error.message}`);
    console.log(`[IMVU] O bot continuará ativo no servidor e tentará reconectar em breve...`);
  }
}

app.listen(PORT, () => {
  console.log(`[HTTP] Servidor a rodar na porta ${PORT}`);
  conectarIMVU();
});

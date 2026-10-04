// =================================================================
// BOT PRZ0 - IMVU AUTOMATED ASSISTANT
// =================================================================

const axios = require('axios');

// --- 1. CONFIGURAÇÕES E ESTADO DO REPRODUTOR ---
// Rádio/Stream dinâmico com as músicas em alta no momento
const STREAM_EM_ALTA = "https://stream.zeno.fm/f3wvbbqmdg8uv"; 

let filaPedidos = [];          // Fila de músicas enviadas pelos usuários
let historicoTocadas = [];     // Histórico para permitir voltar a música
let musicaAtual = null;        // Música que está tocando no momento
let tocaPlaylistPadrao = true; // Define se está no Auto-Play ou nos pedidos
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
// LÓGICA DO REPRODUTOR DE MÚSICA (COM AUTO-PLAY EM ALTA)
// =================================================================

function tocarProximaMusica(quantidadePessoasNaSala) {
    if (musicaAtual) {
        historicoTocadas.push(musicaAtual);
    }
    
    estaPausado = false;

    // Se o bot estiver sozinho OU a fila de pedidos estiver vazia
    if (quantidadePessoasNaSala <= 1 || filaPedidos.length === 0) {
        if (quantidadePessoasNaSala <= 1) {
            filaPedidos = []; // Reseta a fila se a sala esvaziar
        }
        tocaPlaylistPadrao = true;
        // Pega as músicas atuais em alta de forma aleatória e automática
        musicaAtual = { url: STREAM_EM_ALTA, pedidaPor: "Auto-Play (Músicas em Alta 🔥)" };
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
        if (filaPedidos.length === 0) return "A fila de pedidos está vazia no momento. Tocando Músicas em Alta 🔥!";
        
        let textoFila = "🎵 **Fila de Músicas:**\n";
        filaPedidos.forEach((item, index) => {
            textoFila += `${index + 1}. ${item.url} (Pedida por: ${item.pedidaPor})\n`;
        });
        return textoFila;
    }

    // --- 2. MODERAÇÃO / VOTAÇÃO DE KICK (70% DOS PRESENTES) ---

    if (comando === "!kick") {
        if (!argumento) return "Digite !kick [nome do usuário] para abrir a votação.";
        
        const votantesElegiveis = totalPessoasNaSala - 2; 

        if (votantesElegiveis < 2) {
            return "Não há pessoas suficientes na sala para abrir uma votação! Mínimo necessário: 3 pessoas.";
        }

        const votosNecessarios = Math.ceil(votantesElegiveis * 0.7);

        votacaoKick.alvo = argumento;
        votacaoKick.votosSim.clear();
        votacaoKick.votosSim.add(usuario);
        votacaoKick.ativo = true;

        return `⚠ Votação iniciada para remover ${argumento}! Regra de 70%: São necessários ${votosNecessarios} votos 'SIM' de ${votantesElegiveis} pessoas elegíveis. Digite !sim para votar.`;
    }

    if (comando === "!sim" && votacaoKick.ativo) {
        if (usuario === votacaoKick.alvo) return "Você não pode votar na sua própria votação de kick!";

        votacaoKick.votosSim.add(usuario);
        
        const votantesElegiveis = totalPessoasNaSala - 2;
        const votosNecessarios = Math.ceil(votantesElegiveis * 0.7);

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
}, 25 * 60 * 1000);

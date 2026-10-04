const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

// Servidor Web para manter o Render ativo 24/7
app.get('/', (req, res) => res.send('🤖 Bot IMVU Ativo com Sistema de Votação e Música!'));
app.listen(PORT, () => console.log(`[HTTP] Servidor rodando na porta ${PORT}`));

// Configurações
const CONFIG = {
  usuarioBot: process.env.IMVU_USER,
  senhaBot: process.env.IMVU_PASS,
  idSala: process.env.IMVU_ROOM_ID
};

// Controlo do Estado da Votação
let votacaoAtiva = false;
let alvoVotacao = '';
let votosSim = 0;
let votosNao = 0;
let usuariosQueVotaram = new Set();
let tempoVotacaoTimer = null;

// Função para processar os comandos do chat
function processarMensagemChat(autor, mensagem) {
  const msgLimpa = mensagem.trim();

  // 1. Comando de Música: MSC/ nome da música
  if (msgLimpa.toUpperCase().startsWith('MSC/')) {
    const nomeMusica = msgLimpa.substring(4).trim();
    if (!nomeMusica) {
      console.log(`[CHAT] ${autor}: Por favor, informe o nome da música após MSC/`);
      return;
    }
    console.log(`[MÚSICA] A tocar/pesquisar música: "${nomeMusica}" solicitada por ${autor}`);
    // Lógica de envio do stream de áudio para a sala
    return;
  }

  // 2. Comando para Iniciar Votação de Expulsão: !kick @usuario
  if (msgLimpa.toLowerCase().startsWith('!kick ')) {
    if (votacaoAtiva) {
      console.log(`[VOTAÇÃO] Já existe uma votação a decorrer contra ${alvoVotacao}!`);
      return;
    }

    alvoVotacao = msgLimpa.split(' ')[1];
    votacaoAtiva = true;
    votosSim = 0;
    votosNao = 0;
    usuariosQueVotaram.clear();

    console.log(`[VOTAÇÃO] ⚠️ Votação para expulsar ${alvoVotacao} iniciada por ${autor}!`);
    console.log(`[VOTAÇÃO] Responda no chat com 'S' para SIM ou 'N' para NÃO. Tempo limite: 30 segundos.`);

    // Tempo limite de 30 segundos para votar
    tempoVotacaoTimer = setTimeout(() => {
      finalizarVotacao();
    }, 30000);

    return;
  }

  // 3. Registo de Votos (Apenas S ou N maiúsculos/minúsculos)
  if (votacaoAtiva) {
    const voto = msgLimpa.toUpperCase();
    if (voto === 'S' || voto === 'N') {
      if (usuariosQueVotaram.has(autor)) {
        return; // O utilizador já votou
      }

      usuariosQueVotaram.add(autor);

      if (voto === 'S') votosSim++;
      if (voto === 'N') votosNao++;

      console.log(`[VOTAÇÃO] ${autor} votou (${voto}). Placar atual: S: ${votosSim} | N: ${votosNao}`);

      // Se atingir 3 ou mais votos "S", encerra e expulsa imediatamente
      if (votosSim >= 3) {
        clearTimeout(tempoVotacaoTimer);
        finalizarVotacao();
      }
    }
  }
}

// Finalizar Votação
function finalizarVotacao() {
  if (!votacaoAtiva) return;

  console.log(`[VOTAÇÃO] Votação encerrada! Resultado final - SIM: ${votosSim} | NÃO: ${votosNao}`);

  if (votosSim > votosNao && votosSim >= 2) {
    console.log(`[BOOT] 👢 O utilizador ${alvoVotacao} foi expulso da sala por votação!`);
    // Comando para boot no IMVU
  } else {
    console.log(`[VOTAÇÃO] A votação falhou. ${alvoVotacao} continua na sala.`);
  }

  // Reiniciar estado
  votacaoAtiva = false;
  alvoVotacao = '';
  usuariosQueVotaram.clear();
}

async function iniciarBot() {
  console.log('[IMVU] Módulo de comandos de música e votação carregados.');
}

iniciarBot();const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

// Servidor Web para manter o Render ativo 24/7
app.get('/', (req, res) => res.send('🤖 Bot IMVU Ativo com Sistema de Votação e Música!'));
app.listen(PORT, () => console.log(`[HTTP] Servidor rodando na porta ${PORT}`));

// Configurações
const CONFIG = {
  usuarioBot: process.env.IMVU_USER,
  senhaBot: process.env.IMVU_PASS,
  idSala: process.env.IMVU_ROOM_ID
};

// Controlo do Estado da Votação
let votacaoAtiva = false;
let alvoVotacao = '';
let votosSim = 0;
let votosNao = 0;
let usuariosQueVotaram = new Set();
let tempoVotacaoTimer = null;

// Função para processar os comandos do chat
function processarMensagemChat(autor, mensagem) {
  const msgLimpa = mensagem.trim();

  // 1. Comando de Música: MSC/ nome da música
  if (msgLimpa.toUpperCase().startsWith('MSC/')) {
    const nomeMusica = msgLimpa.substring(4).trim();
    if (!nomeMusica) {
      console.log(`[CHAT] ${autor}: Por favor, informe o nome da música após MSC/`);
      return;
    }
    console.log(`[MÚSICA] A tocar/pesquisar música: "${nomeMusica}" solicitada por ${autor}`);
    // Lógica de envio do stream de áudio para a sala
    return;
  }

  // 2. Comando para Iniciar Votação de Expulsão: !kick @usuario
  if (msgLimpa.toLowerCase().startsWith('!kick ')) {
    if (votacaoAtiva) {
      console.log(`[VOTAÇÃO] Já existe uma votação a decorrer contra ${alvoVotacao}!`);
      return;
    }

    alvoVotacao = msgLimpa.split(' ')[1];
    votacaoAtiva = true;
    votosSim = 0;
    votosNao = 0;
    usuariosQueVotaram.clear();

    console.log(`[VOTAÇÃO] ⚠️ Votação para expulsar ${alvoVotacao} iniciada por ${autor}!`);
    console.log(`[VOTAÇÃO] Responda no chat com 'S' para SIM ou 'N' para NÃO. Tempo limite: 30 segundos.`);

    // Tempo limite de 30 segundos para votar
    tempoVotacaoTimer = setTimeout(() => {
      finalizarVotacao();
    }, 30000);

    return;
  }

  // 3. Registo de Votos (Apenas S ou N maiúsculos/minúsculos)
  if (votacaoAtiva) {
    const voto = msgLimpa.toUpperCase();
    if (voto === 'S' || voto === 'N') {
      if (usuariosQueVotaram.has(autor)) {
        return; // O utilizador já votou
      }

      usuariosQueVotaram.add(autor);

      if (voto === 'S') votosSim++;
      if (voto === 'N') votosNao++;

      console.log(`[VOTAÇÃO] ${autor} votou (${voto}). Placar atual: S: ${votosSim} | N: ${votosNao}`);

      // Se atingir 3 ou mais votos "S", encerra e expulsa imediatamente
      if (votosSim >= 3) {
        clearTimeout(tempoVotacaoTimer);
        finalizarVotacao();
      }
    }
  }
}

// Finalizar Votação
function finalizarVotacao() {
  if (!votacaoAtiva) return;

  console.log(`[VOTAÇÃO] Votação encerrada! Resultado final - SIM: ${votosSim} | NÃO: ${votosNao}`);

  if (votosSim > votosNao && votosSim >= 2) {
    console.log(`[BOOT] 👢 O utilizador ${alvoVotacao} foi expulso da sala por votação!`);
    // Comando para boot no IMVU
  } else {
    console.log(`[VOTAÇÃO] A votação falhou. ${alvoVotacao} continua na sala.`);
  }

  // Reiniciar estado
  votacaoAtiva = false;
  alvoVotacao = '';
  usuariosQueVotaram.clear();
}

async function iniciarBot() {
  console.log('[IMVU] Módulo de comandos de música e votação carregados.');
}

iniciarBot();

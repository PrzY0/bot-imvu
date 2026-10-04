const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

// Web server para manter o serviço no ar no Render
app.get('/', (req, res) => res.send('🤖 Bot IMVU Conectado e Ativo na Sala!'));
app.listen(PORT, () => console.log(`[HTTP] Servidor a rodar na porta ${PORT}`));

// Tentar carregar a biblioteca de cliente IMVU se instalada
let IMVU;
try {
  IMVU = require('imvu.js');
} catch (e) {
  console.log('[AVISO] Módulo imvu.js não encontrado, a rodar em modo de simulação.');
}

// Credenciais vindas das variáveis de ambiente do Render
const CONFIG = {
  user: process.env.IMVU_USER,
  pass: process.env.IMVU_PASS,
  roomId: process.env.IMVU_ROOM_ID
};

let votacaoAtiva = false;
let alvoVotacao = '';
let votosSim = 0;
let votosNao = 0;
let usuariosQueVotaram = new Set();
let timerVotacao = null;

async function iniciarBotIMVU() {
  if (!CONFIG.user || !CONFIG.pass) {
    console.error('[ERRO] Preencha IMVU_USER e IMVU_PASS nas variáveis do Render!');
    return;
  }

  console.log(`[IMVU] A autenticar conta do bot: ${CONFIG.user}...`);

  if (IMVU) {
    try {
      const client = new IMVU.Client();
      await client.login(CONFIG.user, CONFIG.pass);
      console.log('[IMVU] Login efetuado com sucesso!');

      if (CONFIG.roomId) {
        const room = await client.joinRoom(CONFIG.roomId);
        console.log(`[IMVU] Avatar entrou na sala ID: ${CONFIG.roomId}`);

        room.on('message', (msg) => {
          processarComandosChat(room, msg.author, msg.text);
        });
      }
    } catch (err) {
      console.error('[ERRO IMVU] Falha ao conectar à sala do IMVU:', err.message);
    }
  } else {
    console.log('[IMVU] Bot pronto na nuvem! Adicione package imvu.js para sincronizar avatar.');
  }
}

function processarComandosChat(room, autor, mensagem) {
  const texto = mensagem.trim();

  // 1. Comando de Música: MSC/ nome da música
  if (texto.toUpperCase().startsWith('MSC/')) {
    const musica = texto.substring(4).trim();
    if (!musica) return;
    console.log(`[MÚSICA] ${autor} pediu a música: ${musica}`);
    if (room && room.send) {
      room.send(`🎵 A tocar a música pedida por ${autor}: ${musica}`);
    }
    return;
  }

  // 2. Comando !kick @usuario
  if (texto.toLowerCase().startsWith('!kick ')) {
    if (votacaoAtiva) return;

    alvoVotacao = texto.split(' ')[1];
    votacaoAtiva = true;
    votosSim = 0;
    votosNao = 0;
    usuariosQueVotaram.clear();

    const aviso = `⚠️ Votação para expulsar ${alvoVotacao}! Digite 'S' para SIM ou 'N' para NÃO. (Tempo: 30s)`;
    console.log(`[VOTAÇÃO] ${aviso}`);
    if (room && room.send) room.send(aviso);

    timerVotacao = setTimeout(() => {
      encerrarVotacao(room);
    }, 30000);

    return;
  }

  // 3. Registo dos Votos (S ou N)
  if (votacaoAtiva) {
    const voto = texto.toUpperCase();
    if (voto === 'S' || voto === 'N') {
      if (usuariosQueVotaram.has(autor)) return;

      usuariosQueVotaram.add(autor);
      if (voto === 'S') votosSim++;
      if (voto === 'N') votosNao++;

      console.log(`[VOTO] ${autor} votou ${voto}. Placar: S:${votosSim} | N:${votosNao}`);

      if (votosSim >= 3) {
        clearTimeout(timerVotacao);
        encerrarVotacao(room);
      }
    }
  }
}

function encerrarVotacao(room) {
  if (!votacaoAtiva) return;

  if (votosSim > votosNao && votosSim >= 2) {
    const msgBoot = `👢 Votação encerrada! O utilizador ${alvoVotacao} foi expulso.`;
    console.log(`[BOOT] ${msgBoot}`);
    if (room && room.send) {
      room.send(msgBoot);
      if (room.kick) room.kick(alvoVotacao);
    }
  } else {
    const msgFalha = `❌ Votação encerrada! ${alvoVotacao} continua na sala.`;
    console.log(`[VOTAÇÃO] ${msgFalha}`);
    if (room && room.send) room.send(msgFalha);
  }

  votacaoAtiva = false;
  alvoVotacao = '';
  usuariosQueVotaram.clear();
}

iniciarBotIMVU();

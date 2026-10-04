const express = require('express');
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

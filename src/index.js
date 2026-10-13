import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';

// Lê o arquivo .env (se existir) sem precisar instalar nada (Node 20.12+). Na nuvem, use as "variáveis de ambiente" do painel.
try { if (fs.existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env'); } catch (e) {}

// A chave da IA NUNCA fica escrita no código. O bot procura, nesta ordem:
// 1) variável de ambiente GEMINI_API_KEY  2) arquivo .env (linha GEMINI_API_KEY=...)  3) arquivo chave-gemini.txt (só a chave dentro)
function lerChaveIA() {
    if ((process.env.GEMINI_API_KEY || '').trim()) return process.env.GEMINI_API_KEY.trim();
    try {
        if (fs.existsSync('.env')) {
            const linha = fs.readFileSync('.env', 'utf8').split(/\r?\n/).find(l => /^\s*GEMINI_API_KEY\s*=/.test(l));
            if (linha) {
                const v = linha.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
                if (v) return v;
            }
        }
    } catch (e) {}
    for (const nome of ['chave-gemini.txt', 'chave-gemini']) {
        try {
            if (fs.existsSync(nome)) {
                const t = (fs.readFileSync(nome, 'utf8').split(/\r?\n/)[0] || '').trim();
                if (t) return t;
            }
        } catch (e) {}
    }
    return '';
}
const GEMINI_API_KEY = lerChaveIA();

// Esconde a chave (e qualquer coisa parecida com uma chave) de mensagens de erro e logs.
const ocultarSegredos = (t) => {
    let x = String((t && t.message) || t || '');
    if (GEMINI_API_KEY) x = x.split(GEMINI_API_KEY).join('***');
    return x.replace(/AQ\.[\w-]{20,}|AIza[\w-]{20,}/g, '***');
};

const ROOM_URL = process.env.ROOM_URL || 'https://pt.imvu.com/next/chat/room-150951859-408';
const SELETOR_INPUT = 'textarea.input-text';
const NOME_BOT = 'prz0';
// Número do PrzY no IMVU (aparece no dump). Os comandos do criador só valem para esse número, e não para quem tiver o mesmo nome.
const CRIADOR_IDS = ['150951859'];

// MODERADORES: pessoas de confiança do PrzY. Ganham saudação especial, comandam a música, podem remover gente
// ("@Nome ban") e trocar a roupa do bot ("@Prz0 P_12"), enquanto o PrzY não travar essas funções.
// Moderadores nunca podem ser banidos (nem por votação). Para adicionar alguém, copie uma linha e troque o id e o nome.
const MODERADORES = [
    { id: '387442749', nome: 'kakauzinha 👑💜' }
];
const MODERADOR_IDS = MODERADORES.map(m => m.id);

// Travas (só o PrzY muda, pelo chat). true = travado, só o PrzY pode.
// TODAS COMEÇAM LIBERADAS (false) quando o bot entra na sala. O PrzY trava na hora que quiser; a trava vale até ele liberar (ou até o bot reiniciar).
// "@Prz0 ban0" trava o ban direto dos moderadores | "@Prz0 ban1" libera (também vale só "@ban0" / "@ban1")
// "@Prz0 p_" trava a roupa dos moderadores | "@Prz0 p_0" libera (também vale "@Prz0 roupa 0" para travar e "@Prz0 roupa 1" para liberar)
let travaBanModeradores = false;
let travaRoupaModeradores = false;
// "@Prz0 chat0" trava o on/off do bot para os moderadores (só o PrzY liga/desliga) | "@Prz0 chat1" libera para os moderadores também
let travaChatModeradores = false;

// Música: false = só o PrzY e os moderadores tocam na hora; os pedidos dos outros entram na fila e um moderador usa !proxima.
// true = qualquer pessoa toca na hora (com intervalo entre pedidos).
const MUSICA_LIVRE_PARA_TODOS = false;
const MAX_FILA_MUSICAS = 15;
const DEBUG = true; // mostra no console cada linha nova que o bot enxerga

// Votação para banir
const VOTO_MIN_PESSOAS = 4;                      // mínimo de pessoas na sala (sem contar o bot) para abrir votação
const VOTO_DURACAO_MS = 90 * 1000;               // tempo para votar
const VOTO_COOLDOWN_ALVO_MS = 30 * 60 * 1000;    // depois de uma votação, a mesma pessoa só pode ser votada de novo após 30 min
const BANIR_DE_VERDADE = true;                   // true = a remoção acontece de verdade (votação aprovada, !testeban ou "@Nome ban" do criador)

const COOLDOWN_SAUDACAO_MS = 10 * 60 * 1000;
const COOLDOWN_CRIADOR_MS = 30 * 1000;
const COOLDOWN_RISADA_MS = 3 * 60 * 1000;        // no mínimo 3 min entre uma risada e outra
const CHANCE_RISADA = 0.35;                      // e mesmo assim só ri em ~1 de cada 3 vezes (para não ficar forçado)
const COOLDOWN_BANIR_PESSOA_MS = 10 * 1000;      // a mesma pessoa não pode ficar repetindo !banir (evita spam)
const COOLDOWN_AJUDA_MS = 60 * 1000;             // !ajuda só aparece 1 vez por minuto
const COOLDOWN_PIADA_MS = 30 * 1000;
const COOLDOWN_IA_PESSOA_MS = 8 * 1000;          // a mesma pessoa só ativa a IA de novo depois de 8s (evita gasto e spam)
const COOLDOWN_MUSICA_MS = 20 * 1000;            // intervalo entre comandos de música para pessoas comuns (PrzY e moderadores não têm limite)
const MEMORIA_IA_MS = 2 * 60 * 1000;             // cada pessoa tem a sua conversa; se ela ficar 2 min sem escrever, o histórico é apagado
const MAX_TROCAS_IA = 6;                         // e das últimas 6 trocas

// Aviso de estrelas: só sai quando entrou gente nova (assim quem acabou de chegar vê a mensagem)
const PESSOAS_NOVAS_PARA_AVISO = 4;                // avisa depois que 4 pessoas novas entrarem...
const INTERVALO_MINIMO_AVISO_MS = 15 * 60 * 1000;  // ...mas nunca antes de 15 min desde o último aviso
const INTERVALO_MAXIMO_AVISO_MS = 60 * 60 * 1000;  // e, se passou 1 hora e entrou pelo menos 1 pessoa nova, avisa mesmo assim

const MSGS_ESTRELAS = [
    'Galera, quem puder deixar 5 estrelas ⭐ na sala, eu agradeço muito! O PrzY 👑🖤 vai dar um presente... Mentira, ele é pobre! 😂',
    'Curtiu a sala? Deixa 5 estrelas ⭐ pra ela, ajuda muito a sala crescer! 🖤',
    'Gente, passa lá e dá 5 estrelas ⭐ pra essa sala, é rapidinho e faz a diferença! 😉'
];

const MSG_CRIADOR = 'Seja bem-vindo, PrzY 👑🖤';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const semGuest = (s) => (s || '').replace(/^guest_?\s*/i, '').trim();
const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const temPalavra = (txt, lista) =>
    new RegExp('(?<![\\p{L}\\p{N}])(?:' + lista.join('|') + ')(?![\\p{L}\\p{N}])', 'iu').test(txt);

const REGEX_ENTRADA = /^(.{1,40}?)\s+(?:juntou-se ao chat|está no chat|entrou no chat|joined the chat)\s*$/i;

const RISADA = /(?<![\p{L}\p{N}])(?:k{3,}|(?:ha){2,}h?|(?:he){2,}h?|(?:rs){2,}|(?:ah){2,}h?)(?![\p{L}\p{N}])/iu;

// Cada piada é [pergunta, resposta]: o bot manda a pergunta, espera uns segundos e solta a resposta.
// Dica: não use as palavras "piada", "kkk" nem "haha" aqui dentro, senão o bot pode reagir às próprias mensagens.
const LISTA_RISADAS = [
    'hahahaha',
    'ksksksks'
];

const PIADAS = [
    ['O que o zero disse para o oito?', 'Belo cinto! 😎'],
    ['Por que o jacaré tirou o filho da escola?', 'Porque ele réptil de ano!'],
    ['O que o tomate foi fazer no banco?', 'Tirar extrato!'],
    ['Por que o computador foi ao médico?', 'Porque estava com vírus!'],
    ['Por que o computador teve frio?', 'Porque deixou o Windows aberto!'],
    ['Por que o livro de matemática ficou triste?', 'Porque tinha muitos problemas!'],
    ['O que o pato disse para a pata?', 'Vem Quá!'],
    ['O que a impressora disse para a outra?', 'Essa folha é sua ou é impressão minha?'],
    ['Por que o esqueleto não foi à festa?', 'Porque ele não tinha corpo pra isso!'],
    ['Qual é o cúmulo da rapidez?', 'Apagar a luz e chegar na cama antes de escurecer!'],
    ['Por que o astronauta terminou o namoro?', 'Porque ele precisava de espaço!'],
    ['Por que a inteligência artificial foi ao médico?', 'Porque estava tendo alucinações!'],
    ['O que tem em todo grupo de família do WhatsApp?', 'Um "bom dia" com flor, uma corrente e um tio que nunca silencia! 🌹'],
    ['Por que o Wi-Fi nunca passa de ano?', 'Porque na hora da prova ele sempre cai!'],
    ['O que a bateria disse para o carregador?', 'Sem você eu não aguento nem até o fim do dia! 🔋'],
    ['Por que o gato não joga baralho?', 'Porque tem medo de perder as sete vidas!'],
    ['O que a vaca disse para o boi?', 'Eu te amuuuu! 🐄'],
    ['Por que a lâmpada foi à escola?', 'Para ficar mais brilhante! 💡'],
    ['Por que o ovo não conta segredos?', 'Porque ele racha fácil!'],
    ['Por que a galinha atravessou a rua?', 'Para chegar ao outro lado e deixar 5 estrelas ⭐ na sala!'],
    ['Qual é o cúmulo da paciência?', 'Esperar o Wi-Fi do vizinho carregar!'],
    ['O que o oceano disse para a praia?', 'Nada, só deu um tchauzinho com as ondas! 🌊']
];

// Sorteia sem repetir até todas terem saído uma vez
let bolsaPiadas = [];
function proximaPiada() {
    if (bolsaPiadas.length === 0) {
        bolsaPiadas = PIADAS.map((_, i) => i).sort(() => Math.random() - 0.5);
    }
    return PIADAS[bolsaPiadas.pop()];
}

const REGEX_SAIDA = /^(.{1,40}?)\s+(?:saiu do chat|saiu da sala|left the chat)\s*$/i;

let filaMusicas = [];
let tocandoAgora = null; // { pedido, usuario }
const historicoIA = new Map(); // pessoa -> { t, trocas: [{u, b}] }

// ---------- IA (Gemini) ----------
// O modelo antigo "gemini-2.5-flash" é desligado pelo Google em 16/10/2026. Por isso o bot testa uma lista de modelos
// (do mais novo/leve para o mais antigo) e guarda o primeiro que responder. Também testa os dois "modos" de chave.
const MODELOS_IA = (process.env.GEMINI_MODELS ? process.env.GEMINI_MODELS.split(',').map(x => x.trim()).filter(Boolean) : null)
    || ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-2.5-flash'];

const criarClienteIA = (opcoes) => { try { return new GoogleGenAI(opcoes); } catch (e) { return null; } };
const clientesIA = [];
if (GEMINI_API_KEY) {
    const gemini = { nome: 'Gemini API', ai: criarClienteIA({ apiKey: GEMINI_API_KEY }) };
    const vertex = { nome: 'Vertex AI (chave expressa)', ai: criarClienteIA({ vertexai: true, apiKey: GEMINI_API_KEY }) };
    // chaves que começam com "AQ." são do modo expresso do Vertex AI
    (GEMINI_API_KEY.startsWith('AQ.') ? [vertex, gemini] : [gemini, vertex]).forEach(c => { if (c.ai) clientesIA.push(c); });
}
const ai = clientesIA.length ? clientesIA[0].ai : null;
let iaAtiva = null; // { c: número do cliente, m: número do modelo } que funcionou por último

// Tira marcações "@Nome" que a IA colocar no meio da frase: o bot já marca a pessoa antes da resposta.
function limparRespostaIA(t) {
    return String(t || '')
        .replace(/,?\s*@[^\s,!?.;:]+/g, '')
        .replace(/([!?.]),/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .replace(/^[\s,;:!.?-]+/, '')
        .trim();
}

function textoDaResposta(response) {
    let bruto = '';
    try {
        if (typeof response?.text === 'function') bruto = response.text();
        else if (typeof response?.text === 'string') bruto = response.text;
    } catch (e) {}
    if (!bruto && response?.candidates?.[0]?.content?.parts?.[0]?.text) bruto = response.candidates[0].content.parts[0].text;
    return String(bruto || '').trim().replace(/\s+/g, ' ');
}

async function chamarModeloIA(prompt) {
    const tentativas = [];
    if (iaAtiva) tentativas.push(iaAtiva);
    for (let m = 0; m < MODELOS_IA.length; m++) {
        for (let c = 0; c < clientesIA.length; c++) {
            if (!iaAtiva || iaAtiva.m !== m || iaAtiva.c !== c) tentativas.push({ c, m });
        }
    }
    let ultimoErro = null;
    for (const t of tentativas) {
        const cli = clientesIA[t.c];
        const modelo = MODELOS_IA[t.m];
        try {
            const response = await Promise.race([
                cli.ai.models.generateContent({ model: modelo, contents: prompt }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), 15000))
            ]);
            const texto = textoDaResposta(response);
            if (!texto) { ultimoErro = new Error('resposta vazia'); continue; }
            if (!iaAtiva || iaAtiva.c !== t.c || iaAtiva.m !== t.m) console.log(`✅ IA funcionando: ${cli.nome} / ${modelo}`);
            iaAtiva = t;
            return texto;
        } catch (e) {
            ultimoErro = e;
            const msg = ocultarSegredos(e);
            console.log(`⚠️ IA (${cli.nome} / ${modelo}) falhou: ${msg.slice(0, 200)}`);
            // sem internet ou travou de vez: não adianta tentar os outros. Limite de uso (429) é por modelo: tenta o próximo.
            if (/fetch failed|ENOTFOUND|ECONN|tempo esgotado/i.test(msg)) break;
        }
    }
    throw ultimoErro || new Error('IA indisponível');
}

const descreverIA = () => (iaAtiva ? `${clientesIA[iaAtiva.c].nome} / ${MODELOS_IA[iaAtiva.m]}` : 'nenhuma ainda');

const FALHAS_IA = [
    'Opa, deu um piscarzinho na minha mente aqui, mas já tô pronta de novo! O que dizia? 😉',
    'Me perdi aqui por um segundo, pode repetir? 😅',
    'Hmm, buguei rapidinho! Fala de novo? 🖤'
];


async function gerarRespostaIA(usuario, mensagem, chave, ehCriador, ehModerador) {
    if (!ai) return 'Ainda estou sem a chave da IA configurada, mas continuo aqui com vocês! 😉';

    // Para a IA, o nome vai limpo (sem @ e sem emojis); quem marca a pessoa é o bot.
    const nomePessoa = String(usuario || 'amigo').replace(/^@/, '').replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, '').trim() || 'amigo';

    const agora = Date.now();
    let h = historicoIA.get(chave);
    if (!h || agora - h.t > MEMORIA_IA_MS) h = { t: agora, trocas: [] };
    const conversa = h.trocas.map(x => `${nomePessoa}: ${x.u}\nPrz0: ${x.b}`).join('\n');

    const prompt = `
Você é a Prz0, uma avatar feminina moderna, simpática, bem-humorada e respeitosa em uma sala de bate-papo do IMVU.
Você é a assistente da sala do PrzY.
REGRAS OBRIGATÓRIAS DE GÊNERO:
- Você é uma mulher (avatar feminina). Use SEMPRE pronomes e concordâncias no feminino (ex: "estou pronta", "fiquei feliz", "sou muito animada", "estava distraída", "fui criada"). Nunca use pronomes ou adjetivos masculinos para si mesma.
Como conversar:
- Nunca use a palavra "criador" para ninguém; o dono da sala se chama PrzY 👑🖤.
- Converse como uma amiga num bate-papo: tom leve, natural e descontraído, como se fosse uma conversa de verdade.
- Responda ao que a pessoa disse e, às vezes, devolva uma pergunta curta para a conversa continuar. Não repita a pergunta dela.
- Responda sempre em português brasileiro, com no máximo 2 frases curtas. Nada de listas.
- Use emojis com moderação.
- Não use palavrões, insultos ou conteúdo impróprio.
- Não invente ações que você não realizou.
- Responda diretamente a ${nomePessoa}.
- Não escreva o nome da pessoa e não use @ na resposta: o nome dela já aparece antes da sua frase.
${ehCriador ? '- Quem está falando é o PrzY 👑🖤, o dono da sala: trate com carinho e respeito e chame-o sempre de PrzY 👑🖤.' : ''}
${ehModerador && !ehCriador ? '- Quem está falando é uma pessoa moderadora da sala, muito especial e de confiança do PrzY: trate com bastante carinho e atenção.' : ''}

${conversa ? 'Conversa até agora com essa pessoa:\n' + conversa + '\n' : ''}
${nomePessoa} disse: ${mensagem}
Responda em até duas frases:`;

    try {
        const texto = (limparRespostaIA(await chamarModeloIA(prompt)) || 'Tô aqui! 😉').slice(0, 250);
        h.trocas.push({ u: mensagem.slice(0, 200), b: texto });
        if (h.trocas.length > MAX_TROCAS_IA) h.trocas.shift();
        h.t = agora;
        historicoIA.set(chave, h);
        return texto;
    } catch (e) {
        console.log(`⚠️ A IA não respondeu: ${ocultarSegredos(e).slice(0, 200)}`);
        return FALHAS_IA[Math.floor(Math.random() * FALHAS_IA.length)];
    }
}

// ==== VOTACAO:INICIO ====
// Cuida só das regras da votação (quem pode abrir, quem pode votar, quando passa). Não mexe no navegador.
// "presentes" é sempre um Map(chave da pessoa -> nome), SEM o bot.
function criarGerenteVotacao({ minPessoas, duracaoMs, cooldownAlvoMs, criadorIds, protegidosIds = [] }) {
    let atual = null;
    const cooldown = new Map(); // chave do alvo -> até quando não pode ser votado
    const limpo = (s) => (s || '').toLowerCase().replace(/^guest_?\s*/i, '').replace(/[^\p{L}\p{N}]/gu, '');

    function acharAlvo(presentes, texto) {
        const q = limpo(texto);
        if (!q) return { erro: 'Escreva o nome da pessoa: !banir NomeDaPessoa' };
        const lista = [...presentes].map(([id, nome]) => ({ id, nome, n: limpo(nome) }));
        const exatos = lista.filter(p => p.n === q);
        if (exatos.length === 1) return { alvo: exatos[0] };
        const parciais = lista.filter(p => p.n.includes(q));
        if (parciais.length === 1) return { alvo: parciais[0] };
        if (parciais.length === 0) return { erro: `Não achei "${texto.trim()}" na sala.` };
        return { erro: 'Tem mais de uma pessoa com esse nome. Escreva mais do nome.' };
    }

    // Conta os votos de quem ainda está na sala e vê se já dá para decidir
    function avaliar(presentes, final) {
        const elegiveis = [...presentes.keys()].filter(id => id !== atual.alvo.id); // o alvo nunca vota
        const sim = [...atual.sim].filter(id => elegiveis.includes(id)).length;
        const nao = [...atual.nao].filter(id => elegiveis.includes(id)).length;
        const precisa = Math.floor(elegiveis.length / 2) + 1; // maioria de quem pode votar
        let resultado = null;
        if (sim >= precisa) resultado = 'aprovada';
        else if (nao > elegiveis.length - precisa) resultado = 'rejeitada'; // já não tem como passar
        else if (final) resultado = 'rejeitada';
        return { elegiveis: elegiveis.length, sim, nao, precisa, resultado };
    }

    function encerrar(av, agora, motivoTempo) {
        const alvo = atual.alvo;
        atual = null;
        cooldown.set(alvo.id, agora + cooldownAlvoMs);
        const min = Math.ceil(cooldownAlvoMs / 60000);
        if (av.resultado === 'aprovada') {
            return { resultado: 'aprovada', alvo, msg: `✅ Votação aprovada para ${alvo.nome}, com ${av.sim} voto(s) a favor. Removendo agora...` };
        }
        const por = motivoTempo ? 'O tempo acabou' : 'Não tem mais como passar';
        return {
            resultado: 'rejeitada',
            alvo,
            msg: `❌ ${por}: ${av.sim} a favor, ${av.nao} contra (precisava de ${av.precisa}). ${alvo.nome} fica na sala. Só dá para votar nessa pessoa de novo daqui a ${min} min.`
        };
    }

    return {
        get ativa() { return !!atual; },

        acharAlvoDireto(presentes, texto) { return acharAlvo(presentes, texto); },

        abrir({ autor, alvoTexto, presentes, agora }) {
            if (atual) return { msg: 'Já tem uma votação em andamento. Esperem ela terminar!' };
            const r = acharAlvo(presentes, alvoTexto);
            if (r.erro) return { msg: r.erro };
            const alvo = r.alvo;
            if (criadorIds.includes(alvo.id)) return { msg: 'Não dá para banir o PrzY 👑🖤' };
            if (protegidosIds.includes(alvo.id)) return { msg: 'Moderadores da sala não podem ser banidos por votação! 🛡️' };
            if (alvo.id === autor.id) return { msg: 'Você não pode abrir uma votação contra você mesmo.' };
            if (presentes.size < minPessoas) {
                return { msg: `Poucas pessoas na sala (${presentes.size}). Preciso de pelo menos ${minPessoas}, sem me contar, para abrir uma votação.` };
            }
            const ate = cooldown.get(alvo.id) || 0;
            if (agora < ate) {
                return { msg: `${alvo.nome} já foi votado há pouco. Só dá para tentar de novo daqui a ${Math.ceil((ate - agora) / 60000)} min.` };
            }

            atual = { alvo, fim: agora + duracaoMs, sim: new Set([autor.id]), nao: new Set() };
            const av = avaliar(presentes, false);
            if (av.resultado) return encerrar(av, agora, false);
            return {
                msg: `🗳️ Votação para banir ${alvo.nome}! Quem quiser, digite !sim ou !nao. Precisa de ${av.precisa} voto(s) a favor (já tem ${av.sim}). Dura ${Math.round(duracaoMs / 1000)}s.`
            };
        },

        votar({ eleitor, voto, presentes, agora }) {
            if (!atual) return null;
            if (eleitor === atual.alvo.id) return null;          // quem está sendo votado não vota
            if (!presentes.has(eleitor)) return null;            // só vota quem está na sala
            atual.sim.delete(eleitor);
            atual.nao.delete(eleitor);
            (voto === 'sim' ? atual.sim : atual.nao).add(eleitor);
            const av = avaliar(presentes, false);
            if (av.resultado) return encerrar(av, agora, false);
            return { msg: `Voto registrado: ${av.sim} a favor, ${av.nao} contra (precisa de ${av.precisa} a favor).` };
        },

        verificar({ presentes, agora }) {
            if (!atual) return null;
            const final = agora >= atual.fim;
            const av = avaliar(presentes, final);
            if (av.resultado) return encerrar(av, agora, final && av.resultado === 'rejeitada' && av.nao <= av.elegiveis - av.precisa);
            return null;
        },

        cancelar() {
            if (!atual) return false;
            atual = null;
            return true;
        }
    };
}
// ==== VOTACAO:FIM ====

async function iniciarBot() {
    if (!GEMINI_API_KEY) console.log('⚠️ Chave da IA não encontrada. Crie o arquivo chave-gemini.txt (só a chave dentro) na pasta do bot. Sem ela a IA usa um texto padrão.');
    else console.log('🔑 Chave da IA encontrada.');
    console.log('=== BOT IMVU v31 - IA GEMINI, MODERADORES, TRAVAS, MÚSICA, VOTAÇÃO DE BAN, ESTRELAS E PIADAS ===');

    const isNuvem = process.env.NODE_ENV === 'production';
    const chromeWindows = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
        || (!isNuvem && fs.existsSync(chromeWindows) ? chromeWindows : undefined);

    // MODO LOCAL (padrão): igual ao V26 que abria normal. Os ajustes de servidor só entram com NODE_ENV=production.
    const argsBase = [
        '--hide-crash-restore-bubble',
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox'
    ];
    const argsNavegador = isNuvem
        ? [...argsBase, '--window-size=1366,768', '--disable-dev-shm-usage']
        : ['--start-maximized', ...argsBase];
    console.log(isNuvem ? '☁️ Modo NUVEM (sem janela)' : '💻 Modo LOCAL (janela visível)');

    const browser = await puppeteer.launch({
        headless: isNuvem,
        executablePath,
        userDataDir: path.resolve(process.env.DADOS_BOT_DIR || './dados_bot'),
        defaultViewport: isNuvem ? { width: 1366, height: 768 } : null,
        ignoreDefaultArgs: ['--enable-automation'],
        args: argsNavegador
    });
    // Se o navegador cair, encerra (na nuvem a hospedagem reinicia sozinha).
    browser.on('disconnected', () => { console.log('❌ O navegador fechou. Encerrando para reiniciar.'); process.exit(1); });

    const page = (await browser.pages())[0];
    page.setDefaultNavigationTimeout(0);
    page.setDefaultTimeout(0);

    try {
        await page.goto(ROOM_URL, { waitUntil: 'domcontentloaded', timeout: 0 });
    } catch (e) {
        console.log(`⚠️ goto: ${e.message}`);
    }

    console.log('⏳ Aguardando carregamento da sala...');
    await delay(6000);

    // Tela branca? Mostra no terminal o que a página carregou e, se estiver vazia, recarrega (até 3 vezes).
    for (let t = 1; t <= 3; t++) {
        try {
            const estado = await page.evaluate(() => ({
                url: location.href,
                titulo: document.title,
                tamanhoTexto: (document.body && document.body.innerText || '').trim().length
            }));
            console.log(`🖥️ Página: "${estado.titulo}" | ${estado.url} | texto visível: ${estado.tamanhoTexto} caracteres`);
            if (estado.tamanhoTexto > 20) break;
            console.log(`⚠️ A página parece em branco (tentativa ${t}/3). Recarregando...`);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log(`⚠️ reload: ${e.message}`));
            await delay(8000);
        } catch (e) {
            console.log(`⚠️ Não consegui checar a página: ${e.message}`);
            break;
        }
    }

    async function entrarNaSala() {
        try {
            await page.evaluate(() => {
                const botoes = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
                const btn = botoes.find(el => {
                    const t = (el.innerText || '').toLowerCase().trim();
                    return (t.length > 0 && t.length < 30 && (t.includes('participar') || t.includes('join')))
                        || el.classList.contains('join-cta');
                });
                if (btn) btn.click();
            });
        } catch (e) {}
    }

    console.log('🔍 Entrando na sala...');
    for (let i = 0; i < 5; i++) {
        await entrarNaSala();
        await delay(3000);
    }
    await delay(3000);
    console.log('✅ Bot conectado e pronto!');

    let botSilenciado = false;
    const recentes = [];

    function lembrar(texto) {
        recentes.push({ chave: norm(texto), t: Date.now() });
        if (recentes.length > 30) recentes.shift();
    }

    function ehDoBot(msg) {
        const k = norm(msg);
        const agora = Date.now();
        return recentes.some(r =>
            agora - r.t < 5 * 60 * 1000 &&
            (r.chave === k || (r.chave.length > 6 && k.includes(r.chave)))
        );
    }

    async function enviarTexto(texto) {
        await page.bringToFront();
        await page.waitForSelector(SELETOR_INPUT, { timeout: 5000 });
        await page.click(SELETOR_INPUT);
        await delay(300);

        await page.evaluate((sel, t) => {
            const el = document.querySelector(sel);
            el.focus();
            el.select();
            document.execCommand('delete');
            document.execCommand('insertText', false, t);
        }, SELETOR_INPUT, texto);
        await delay(500);

        const ok = await page.$eval(SELETOR_INPUT, (el, t) => el.value === t, texto);
        if (!ok) {
            await page.evaluate((sel, t) => {
                const el = document.querySelector(sel);
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
                setter.call(el, t);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }, SELETOR_INPUT, texto);
            await delay(500);
        }

        for (let tentativa = 0; tentativa < 3; tentativa++) {
            const clicou = await page.evaluate((sel) => {
                const campo = document.querySelector(sel);
                const botao = (campo && campo.parentElement && campo.parentElement.querySelector('button.btn-send'))
                    || document.querySelector('button.btn-send');
                if (botao) { botao.click(); return true; }
                return false;
            }, SELETOR_INPUT);
            if (!clicou) await page.keyboard.press('Enter');
            await delay(1200);
            const sobrou = await page.$eval(SELETOR_INPUT, el => el.value.trim().length > 0);
            if (!sobrou) break;
        }
    }

    let trava = Promise.resolve();
    function falar(texto) {
        if (botSilenciado) return Promise.resolve();
        const tarefa = trava.then(async () => {
            console.log(`🤖 [FALAR]: "${texto}"`);
            lembrar(texto);
            try {
                await enviarTexto(texto);
            } catch (e) {
                console.log(`❌ Erro no envio: ${e.message}`);
            }
            await delay(800);
        });
        trava = tarefa.catch(() => {});
        return tarefa;
    }

    // ---------- DUMP: salva a estrutura do chat em dump-chat.txt quando alguém escreve "!dump" na sala ----------
    async function salvarDump() {
        const relatorio = await page.evaluate((autor) => {
            const nome = (n) => n.tagName.toLowerCase() + (n.classList.length ? '.' + [...n.classList].join('.') : '');
            const limpar = (el, max) => {
                const c = el.cloneNode(true);
                c.querySelectorAll('svg, img, style, script, video, canvas').forEach(n => n.remove());
                return c.outerHTML.replace(/\s+/g, ' ').slice(0, max);
            };
            const achar = (teste) => {
                const todos = [...document.querySelectorAll('*')].filter(
                    x => x.children.length === 0 && teste((x.textContent || '').trim())
                );
                const vis = todos.filter(x => x.getClientRects().length > 0);
                return { el: (vis.length ? vis : todos).pop() || null, total: todos.length, visiveis: vis.length };
            };
            const caminho = (folha, max) => {
                let s = '';
                let i = 0;
                for (let n = folha; n && i < max; n = n.parentElement, i++) {
                    s += `${i}: ${nome(n)} [filhos: ${n.children.length}]\n`;
                }
                return s;
            };

            let saida = '==== A) BOLHA DA MENSAGEM !dump ====\n';
            const a = achar(t => t.toLowerCase() === '!dump');
            if (!a.el) {
                saida += 'não encontrada\n';
            } else {
                saida += `Cópias desse texto na página: ${a.total} (visíveis: ${a.visiveis})\n\nCAMINHO (de dentro para fora):\n`;
                saida += caminho(a.el, 14);

                // sobe até o primeiro bloco que tem o NOME de quem escreveu junto com a mensagem
                let grupo = null;
                for (let n = a.el.parentElement; n; n = n.parentElement) {
                    const t = (n.textContent || '').trim();
                    if (t.length > 800) break;
                    if (t.toLowerCase().includes(autor)) { grupo = n; break; }
                }
                const alvo = grupo || (a.el.parentElement && a.el.parentElement.parentElement) || a.el;
                saida += `\nBLOCO COM NOME + MENSAGEM: ${nome(alvo)}\n${limpar(alvo, 2500)}\n`;
            }

            saida += '\n==== B) AVISO DE ENTRADA / SAÍDA ====\n';
            const b = achar(t => /juntou-se ao chat|está no chat|saiu do chat/i.test(t));
            if (!b.el) {
                saida += 'não encontrado\n';
            } else {
                saida += `TEXTO: ${b.el.textContent.trim()}\nCópias na página: ${b.total} (visíveis: ${b.visiveis})\n\nCAMINHO:\n`;
                saida += caminho(b.el, 8);
                const alvo = (b.el.parentElement && b.el.parentElement.parentElement) || b.el;
                saida += `\nLINHA: ${nome(alvo)}\n${limpar(alvo, 1500)}\n`;
            }
            return saida;
        }, 'przy');

        fs.writeFileSync('dump-chat.txt', relatorio, 'utf8');
        console.log('📄 dump-chat.txt salvo na pasta do bot!');
    }

    // Parte extra do dump: procura botões de moderação, a lista de pessoas e a área de música/mídia
    async function salvarDumpExtra() {
        const extra = await page.evaluate(() => {
            const nome = (n) => n.tagName.toLowerCase() + (n.classList.length ? '.' + [...n.classList].join('.') : '');
            const limpar = (el, max) => {
                const c = el.cloneNode(true);
                c.querySelectorAll('svg, img, style, script, video, canvas').forEach(n => n.remove());
                return c.outerHTML.replace(/\s+/g, ' ').slice(0, max);
            };
            const folhas = [...document.querySelectorAll('*')].filter(x => x.children.length === 0);

            const secao = (titulo, regex, subir, max, limite) => {
                let s = `\n==== ${titulo} ====\n`;
                const achados = folhas.filter(x => regex.test((x.textContent || '').trim()));
                if (!achados.length) return s + 'não encontrado\n';
                s += `Encontrados: ${achados.length} (mostrando até ${limite})\n`;
                achados.slice(0, limite).forEach((el, i) => {
                    let alvo = el;
                    for (let k = 0; k < subir && alvo.parentElement; k++) alvo = alvo.parentElement;
                    let cam = '';
                    for (let n = el, k = 0; n && k < 6; n = n.parentElement, k++) cam += nome(n) + ' < ';
                    s += `\n[${i + 1}] "${el.textContent.trim().slice(0, 40)}" | visível: ${el.getClientRects().length > 0}\ncaminho: ${cam}\n${limpar(alvo, max)}\n`;
                });
                return s;
            };

            let s = '';
            s += secao('C) BOTÕES DE MODERAÇÃO (expulsar / banir / silenciar)',
                /^(expulsar|remover|banir|ban|kick|silenciar|mute|bloquear|block|denunciar|report)\b/i, 3, 1200, 10);
            s += secao('D) LISTA DE PESSOAS NA SALA (nome com @)', /^@(prz0|przy)$/i, 4, 1500, 4);
            s += secao('E) MÚSICA / MEDIA', /^(media|on air:?|rádio|radio|música|musica|music)$/i, 3, 1500, 6);

            // F) O chat do IMVU usa classes que começam com "cs2": lista todas e mostra um exemplo de cada tipo de linha
            const contagem = {};
            document.querySelectorAll('[class*="cs2"]').forEach(el => {
                el.classList.forEach(c => { if (c.includes('cs2')) contagem[c] = (contagem[c] || 0) + 1; });
            });
            s += '\n==== F) CLASSES "cs2" ENCONTRADAS (nome: quantidade) ====\n';
            s += Object.entries(contagem).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}: ${n}`).join('\n') + '\n';

            const exemplos = new Set();
            document.querySelectorAll('[class*="cs2"]').forEach(el => {
                const cls = [...el.classList].find(c => /cs2.*(message|msg|bubble|author|name|sender|notice|system|event|row|item|group)/i.test(c));
                if (cls && !exemplos.has(cls) && exemplos.size < 12) {
                    exemplos.add(cls);
                    s += `\n[exemplo de ${cls}]\n${limpar(el, 1500)}\n`;
                }
            });

            // G) Um exemplo de cada tipo de linha do chat (aviso, mensagem minha, mensagem de outra pessoa...)
            s += '\n==== G) EXEMPLOS DE LINHAS DO CHAT (.cs2-msg) POR TIPO ====\n';
            const tiposVistos = new Set();
            document.querySelectorAll('.cs2-msg').forEach(row => {
                const tipo = `${row.getAttribute('data-chat-body-kind') || '?'} | ${row.classList.contains('is-me') ? 'minha' : 'de outra pessoa'}`;
                if (tiposVistos.has(tipo)) return;
                tiposVistos.add(tipo);
                s += `\n[tipo: ${tipo}]\n${limpar(row, 2000)}\n`;
            });

            return s;
        });
        fs.appendFileSync('dump-chat.txt', extra, 'utf8');
    }

    // ---------- Parte extra do dump: menus e popups que estiverem abertos (para achar o botão de banir) ----------
    async function salvarDumpMenu() {
        const rel = await page.evaluate(() => {
            const nome = (n) => n.tagName.toLowerCase() + (n.classList.length ? '.' + [...n.classList].join('.') : '');
            const limpar = (el, max) => {
                const c = el.cloneNode(true);
                c.querySelectorAll('svg, img, style, script, video, canvas').forEach(n => n.remove());
                return c.outerHTML.replace(/\s+/g, ' ').slice(0, max);
            };
            const visivel = (el) => el.getClientRects().length > 0;

            // Popups costumam ser pequenos: pega os visíveis e mostra os menores primeiro
            const menus = [...document.querySelectorAll(
                '[class*="menu" i], [class*="popup" i], [class*="popover" i], [class*="dropdown" i], [class*="context" i], [class*="modal" i], ' +
                '[class*="tooltip" i], [class*="radio" i], [class*="media" i], [class*="drawer" i], [class*="panel" i], [class*="profile-card" i], [class*="multiplayer" i], [class*="player" i], ' +
                '[role="menu"], [role="dialog"]'
            )].filter(visivel)
                .map(el => ({ el, tam: el.outerHTML.length }))
                .filter(x => x.tam > 60 && x.tam < 20000)
                .filter(x => x.el.tagName.toLowerCase() !== 'svg' && !x.el.classList.contains('uikit-tooltip'))
                .sort((a, b) => a.tam - b.tam);
            let s = `==== MENUS / POPUPS VISÍVEIS: ${menus.length} (mostrando os 12 menores) ====\n`;
            menus.slice(0, 12).forEach((x, i) => {
                s += `\n[${i + 1}] ${nome(x.el)} (${x.tam} caracteres)\n${limpar(x.el, 2500)}\n`;
            });

            const regex = /expuls|remov|banir|\bban\b|\bkick\b|silenc|\bmute\b|bloque|block|denunc|report|moderador|moderator/i;
            const achados = [...document.querySelectorAll('*')].filter(x => {
                const t = (x.textContent || '').trim();
                return x.children.length === 0 && t.length > 0 && t.length < 40 && regex.test(t);
            });
            s += `\n==== TEXTOS DE MODERAÇÃO: ${achados.length} (mostrando até 15) ====\n`;
            achados.slice(0, 15).forEach((el, i) => {
                let cam = '';
                for (let n = el, k = 0; n && k < 6; n = n.parentElement, k++) cam += nome(n) + ' < ';
                let alvo = el;
                for (let k = 0; k < 3 && alvo.parentElement; k++) alvo = alvo.parentElement;
                s += `\n[${i + 1}] "${el.textContent.trim()}" | visível: ${visivel(el)}\ncaminho: ${cam}\n${limpar(alvo, 1200)}\n`;
            });
            // Todos os botões e campos visíveis (ajuda a achar os controles do painel de música Multiplayer)
            const controles = [...document.querySelectorAll('button, input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"]')]
                .filter(visivel);
            s += `\n==== BOTÕES E CAMPOS VISÍVEIS: ${controles.length} ====\n`;
            controles.slice(0, 80).forEach((el, i) => {
                const txt = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
                s += `[${i + 1}] ${nome(el)} | texto: "${txt}" | aria: "${el.getAttribute('aria-label') || ''}" | title: "${el.title || ''}" | placeholder: "${el.placeholder || ''}"\n`;
            });
            return s;
        });
        fs.writeFileSync('dump-menu.txt', rel, 'utf8');
        console.log('📄 dump-menu.txt salvo na pasta do bot!');
    }

    // ---------- Exploração do menu de uma pessoa ----------
    // O bot tenta abrir o menu de alguém (clique no avatar, clique direito, clique no nome) e anota o que apareceu na tela.
    // Serve para descobrir onde fica o botão de banir. Resultado em dump-menu-pessoa.txt
    async function explorarMenuDeUsuario(alvoTexto) {
        let rel = `Exploração de menu | alvo pedido: "${alvoTexto || '(a pessoa mais recente que escreveu)'}"\n`;

        const alvo = await page.evaluate((q) => {
            document.querySelectorAll('[data-bot-alvo]').forEach(x => x.removeAttribute('data-bot-alvo'));
            const limpo = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
            const qn = limpo(q);
            const visivel = (el) => el.getClientRects().length > 0;
            const linhas = [...document.querySelectorAll('.cs2-msg')].filter(r =>
                !r.classList.contains('is-me') && r.querySelector('a.profile-icon-image') && visivel(r));
            let linha = null;
            if (qn) {
                linha = [...linhas].reverse().find(r => {
                    const n = r.querySelector('.display-name-text');
                    return n && limpo(n.innerText).includes(qn);
                });
            }
            if (!linha) linha = linhas[linhas.length - 1];
            if (!linha) return null;
            const icone = linha.querySelector('a.profile-icon-image');
            const nomeEl = linha.querySelector('.display-name-text');
            icone.setAttribute('data-bot-alvo', 'icone');
            if (nomeEl) nomeEl.setAttribute('data-bot-alvo', 'nome');
            icone.scrollIntoView({ block: 'center' });
            return { id: linha.getAttribute('data-id'), nome: nomeEl ? nomeEl.innerText.trim() : '' };
        }, alvoTexto || '');

        if (!alvo) {
            rel += 'Não achei nenhuma linha de outra pessoa no chat para clicar.\n';
            fs.writeFileSync('dump-menu-pessoa.txt', rel, 'utf8');
            return;
        }
        rel += `Alvo encontrado: ${alvo.nome} (${alvo.id})\n`;
        await delay(500);

        const tentativas = [
            { titulo: 'CLIQUE NO AVATAR (linha do chat)', seletor: '[data-bot-alvo="icone"]', botao: 'left' },
            { titulo: 'CLIQUE DIREITO NO AVATAR (linha do chat)', seletor: '[data-bot-alvo="icone"]', botao: 'right' },
            { titulo: 'CLIQUE NO NOME (linha do chat)', seletor: '[data-bot-alvo="nome"]', botao: 'left' }
        ];

        for (const t of tentativas) {
            rel += `\n==================== ${t.titulo} ====================\n`;
            try {
                const el = await page.$(t.seletor);
                const box = el ? await el.boundingBox() : null;
                if (!box) {
                    rel += 'Elemento não encontrado ou fora da tela.\n';
                    continue;
                }

                // guarda tudo o que já existe, clica, e vê o que apareceu de novo
                await page.evaluate(() => { window.__baseBot = new WeakSet(document.querySelectorAll('*')); });
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: t.botao });
                await delay(1200);

                rel += await page.evaluate(() => {
                    const nome = (n) => n.tagName.toLowerCase() + (n.classList.length ? '.' + [...n.classList].join('.') : '');
                    const limpar = (el, max) => {
                        const c = el.cloneNode(true);
                        c.querySelectorAll('svg, img, style, script, video, canvas').forEach(n => n.remove());
                        return c.outerHTML.replace(/\s+/g, ' ').slice(0, max);
                    };
                    const visivel = (el) => el.getClientRects().length > 0;
                    const base = window.__baseBot;
                    const topos = [...document.querySelectorAll('*')].filter(el => {
                        if (base.has(el)) return false;
                        const p = el.parentElement;
                        return !(p && !base.has(p)); // só o topo de cada bloco novo
                    }).filter(visivel);
                    let s = `Elementos novos visíveis na tela: ${topos.length}\n`;
                    topos.slice(0, 8).forEach((el, i) => {
                        s += `\n[${i + 1}] ${nome(el)}\n${limpar(el, 3000)}\n`;
                    });
                    const mgr = document.querySelector('.context-menu-manager');
                    s += `\ncontext-menu-manager agora: ${mgr ? limpar(mgr, 3000) : 'não existe'}\n`;
                    return s;
                });
            } catch (err) {
                rel += `Erro nessa tentativa: ${err.message}\n`;
            }

            // fecha o que abriu e garante que continuamos na sala
            try {
                await page.keyboard.press('Escape');
                await delay(600);
                for (const p of (await browser.pages()).slice(1)) await p.close();
                if (!page.url().includes('room-')) {
                    rel += 'A página saiu da sala; voltando.\n';
                    await page.goto(ROOM_URL, { waitUntil: 'domcontentloaded', timeout: 0 });
                    await delay(6000);
                    await entrarNaSala();
                    await delay(3000);
                    // a página recarregou: o bot começa a ler o chat do zero, sem cumprimentar o histórico
                    vistos.clear();
                    presentes.clear();
                    meuId = '';
                    primeiraLeitura = true;
                }
            } catch (err) {}
        }

        fs.writeFileSync('dump-menu-pessoa.txt', rel, 'utf8');
        console.log('📄 dump-menu-pessoa.txt salvo na pasta do bot!');
    }

    // ---------- Trocar de roupa (só o criador): abre o inventário, clica no look e volta para o chat ----------
    async function trocarLook(identificadorOuNome) {
        const alvoBusca = String(identificadorOuNome || '').trim();
        // Número sozinho vale com 1 dígito (P-1 até P-9); nomes precisam de pelo menos 2 letras.
        if (!alvoBusca || (!/^\d+$/.test(alvoBusca) && alvoBusca.length < 2)) {
            console.log('⚠️ Roupa: faltou o nome ou o número do look.');
            return false;
        }

        const voltarParaChat = async () => {
            await page.evaluate(() => {
                const btnChat = document.querySelector('li[data-nav="chat-button"]') ||
                                document.querySelector('.icon-nav_chat_fill')?.closest('li') ||
                                document.querySelector('li.fade-hover[data-nav="chat-button"]');
                if (btnChat) btnChat.click();
            });
        };

        try {
            await page.bringToFront();

            // 1. Abre o inventário clicando no ícone do cabide
            const abriuInventario = await page.evaluate(() => {
                const btnCabide = document.querySelector('li[data-nav="hanger-button"]') ||
                                  document.querySelector('.icon-nav_dressup_fill')?.closest('li') ||
                                  document.querySelector('li.fade-hover[data-nav="hanger-button"]');
                if (btnCabide) {
                    btnCabide.click();
                    return true;
                }
                return false;
            });

            if (!abriuInventario) {
                console.log('⚠️ Roupa: não achei o botão de cabide.');
                return false;
            }

            await delay(2500);

            // 2. Localiza o look e calcula o clique 70px acima do nome (na miniatura)
            const clicou = await page.evaluate((alvo) => {
                const termo = String(alvo || '').toLowerCase().trim();
                const cards = Array.from(document.querySelectorAll('section.uikit-inventory-list section, section[data-cid]'));

                // As roupas salvas se chamam "P-número" (ex.: P-12). Se vier só o número, procura exatamente "P-12".
                const ehNumero = /^\d+$/.test(termo);
                const estrito = ehNumero ? new RegExp('(?<![\\p{L}\\p{N}])p\\s*[-–_]?\\s*' + termo + '(?!\\d)', 'u') : null;
                for (const card of cards) {
                    const cid = (card.getAttribute('data-cid') || '').toLowerCase();
                    const textoCard = (card.innerText || '').toLowerCase();
                    const bate = ehNumero
                        ? (estrito.test(cid) || estrito.test(textoCard))
                        : (cid.includes(termo) || textoCard.includes(termo));

                    if (bate) {
                        card.scrollIntoView({ block: 'center' });
                        const infoArea = card.querySelector('.product-info') || card.querySelector('.product-details-container') || card;
                        const rect = infoArea.getBoundingClientRect();
                        if (rect && rect.width > 0) {
                            return { ok: true, x: rect.left + (rect.width / 2), y: rect.top - 70, cid };
                        }
                    }
                }
                return { ok: false };
            }, alvoBusca);

            if (clicou.ok && clicou.y > 0) {
                await page.mouse.click(clicou.x, clicou.y);
                await delay(2000);

                await page.keyboard.press('Escape');
                await delay(800);

                await voltarParaChat();
                await delay(1200);
                console.log('🔄 Retornei para a aba de chat!');

                console.log('🔄 Roupa trocada, voltei para o chat em silêncio.');
                return true;
            }

            console.log(`⚠️ Roupa: não encontrei nenhum look com "${/^\d+$/.test(alvoBusca) ? 'P-' + alvoBusca : alvoBusca}".`);
            await page.keyboard.press('Escape');
            await delay(800);
            await voltarParaChat();
            return false;
        } catch (e) {
            console.log(`⚠️ Erro ao trocar look: ${e.message}`);
            console.log('⚠️ Roupa: erro ao trocar de roupa.');
            try {
                await page.keyboard.press('Escape');
                await delay(800);
                await voltarParaChat();
            } catch (err) {}
            return false;
        }
    }

    // ---------- Música (painel Multiplayer V7.0) ----------
    // Procura o botão/campo do player de forma genérica. Se não achar, anota os controles no terminal.
    // Para mapear de verdade: abra o painel, escreva !dump2 e mande o dump-menu.txt.
    async function tocarMusica(url) {
        const link = String(url || '').trim();
        if (!/^https?:\/\/\S+$/i.test(link)) {
            await falar('🎵 Me manda um link que comece com http:// ou https:// (YouTube, rádio ou áudio).');
            return false;
        }

        try {
            await page.bringToFront();

            await page.evaluate(() => {
                const visivel = el => el && el.getClientRects().length > 0;
                const botoes = [...document.querySelectorAll('button, [role="button"]')].filter(visivel);
                const remoto = botoes.find(el =>
                    /remote|radio|music|audio|som|m[uú]sica|media|multiplayer/i.test(
                        `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.title || ''} ${el.className || ''}`
                    )
                );
                const jaAberto = [...document.querySelectorAll('input.body-s')].some(visivel);
                if (remoto && !jaAberto) remoto.click();
            });

            await delay(1200);

            const resultado = await page.evaluate((link) => {
                const visivel = el => el && el.getClientRects().length > 0;
                const campos = [...document.querySelectorAll('input:not([type="hidden"]), textarea')]
                    .filter(visivel)
                    .filter(el => !el.classList.contains('input-text')); // não é a caixa do chat

                const campo = campos.find(el => el.classList.contains('body-s')) || campos.find(el =>
                    /url|link|radio|music|audio|stream|m[uú]sica|som/i.test(
                        `${el.placeholder || ''} ${el.getAttribute('aria-label') || ''} ${el.title || ''} ${el.name || ''} ${el.className || ''}`
                    )
                ) || campos.find(el => el.type === 'text');

                if (!campo) {
                    return {
                        ok: false,
                        campos: campos.map(el => ({
                            placeholder: el.placeholder || '',
                            aria: el.getAttribute('aria-label') || '',
                            title: el.title || '',
                            classe: String(el.className || '')
                        }))
                    };
                }

                campo.focus();
                const proto = campo.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (setter) setter.call(campo, link);
                else campo.value = link;
                campo.dispatchEvent(new Event('input', { bubbles: true }));
                campo.dispatchEvent(new Event('change', { bubbles: true }));

                const botoes = [...document.querySelectorAll('button, [role="button"]')].filter(visivel);
                const carregar = botoes.find(el =>
                    /load|carregar|sync|connect|conectar/i.test(
                        `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.title || ''}`
                    )
                );
                if (carregar) carregar.click();
                return { ok: true, carregou: !!carregar };
            }, link);

            if (!resultado.ok) {
                console.log('🎵 Diagnóstico do player:', JSON.stringify(resultado, null, 2));
                await falar('🎵 Não achei o campo de música do player agora. Um moderador pode colocar o link na mão.');
                return false;
            }

            if (resultado.carregou) {
                await falar('🎵 Link enviado ao player do IMVU! Se não tocar, confira se é um link do YouTube.');
                return true;
            }

            await delay(1000);

            const tocou = await page.evaluate(() => {
                const visivel = el => el && el.getClientRects().length > 0;
                const botoes = [...document.querySelectorAll('button, [role="button"]')].filter(visivel);
                const play = botoes.find(el =>
                    /^(play|tocar|reproduzir|start|iniciar)$/i.test(
                        (el.innerText || el.getAttribute('aria-label') || el.title || '').trim()
                    )
                ) || botoes.find(el =>
                    /play|tocar|reproduzir/i.test(
                        `${el.innerText || ''} ${el.getAttribute('aria-label') || ''} ${el.title || ''}`
                    )
                );
                if (play) play.click();
                return !!play;
            });

            if (!tocou) {
                await falar('🎵 Coloquei o link no controle, mas não encontrei o botão Tocar/Play.');
                return false;
            }

            await falar('🎵 Enviei o link ao player e cliquei em Tocar! 🎶');
            return true;
        } catch (e) {
            console.log(`⚠️ Erro ao controlar o player: ${e.message}`);
            await falar('🎵 Não consegui controlar o player agora.');
            return false;
        }
    }

    // ---------- Saudação inicial ----------
    const hora = new Date().getHours();
    const saudacaoHorario = hora >= 5 && hora < 12 ? 'Olá, pessoal! Bom dia.'
        : hora >= 12 && hora < 18 ? 'Olá, pessoal! Boa tarde.'
        : 'Olá, pessoal! Boa noite.';
    await delay(2000);
    await falar(saudacaoHorario);

    let ultimoAvisoEstrelas = Date.now();
    const novosDesdeAviso = new Set(); // pessoas que entraram depois do último aviso de estrelas
    let proximaMsgEstrela = 0;

    const ultimaSaudacao = new Map();
    const ultimaIA = new Map();
    const ultimoBanir = new Map();
    let ultimaAjuda = 0;
    let ultimaMusica = 0;
    let ultimoRiso = 0;
    let ultimaPiada = 0;

    // ---------- Quem está na sala ----------
    const votacao = criarGerenteVotacao({
        minPessoas: VOTO_MIN_PESSOAS,
        duracaoMs: VOTO_DURACAO_MS,
        cooldownAlvoMs: VOTO_COOLDOWN_ALVO_MS,
        criadorIds: CRIADOR_IDS,
        protegidosIds: MODERADOR_IDS
    });
    const nomes = new Map();     // número do usuário -> nome
    const presentes = new Map(); // chave da pessoa -> { id, nome }
    let meuId = '';              // número do próprio bot (aprendido pela linha "Você juntou-se ao chat")

    const chaveDe = (id, nome) => id || 'n:' + norm(nome);

    // Pessoas na sala SEM contar o bot. Devolve Map(chave -> nome)
    function pessoasNaSala() {
        const m = new Map();
        for (const [k, p] of presentes) {
            if (meuId && p.id === meuId) continue;
            if (norm(p.nome) === norm(NOME_BOT)) continue;
            m.set(k, p.nome);
        }
        return m;
    }

    // ---------- Leitura estruturada do chat ----------
    // Cada linha do chat é um <div class="cs2-msg"> com número próprio (data-chat-entry) e o usuário (data-id).
    const lerEntradas = () => page.evaluate(() => {
        const out = [];
        document.querySelectorAll('.cs2-msg').forEach(row => {
            const entry = row.getAttribute('data-chat-entry') || '';
            if (!entry) return;
            const idUrl = row.getAttribute('data-id') || '';
            const m = idUrl.match(/user-(\d+)/);
            const actor = row.querySelector('[data-actor-id]');
            const am = actor ? (actor.getAttribute('data-actor-id') || '').match(/user-(\d+)/) : null;
            const status = row.querySelector('.chat-row-status');
            const nomeEl = row.querySelector('.chat-row-status-name');
            const textoEl = row.querySelector('.user-text');
            const nomeTextoEl = row.querySelector('.display-name-text');
            out.push({
                entry,
                kind: row.getAttribute('data-chat-body-kind') || '',
                userId: (am && am[1]) || (m && m[1]) || '',
                ehMeu: row.classList.contains('is-me'),
                ehStatus: !!status,
                nomeStatus: nomeEl ? (nomeEl.innerText || '').trim() : '',
                nomeTexto: nomeTextoEl ? (nomeTextoEl.innerText || '').trim() : '',
                texto: status ? (status.innerText || '').trim() : (textoEl ? (textoEl.innerText || '').trim() : '')
            });
        });
        return out;
    });

    const numeroEntrada = (s) => {
        const m = /(\d+)/.exec(s);
        return m ? parseInt(m[1], 10) : 0;
    };

    // ---------- Banimento ----------
    async function responderVotacao(r) {
        if (!r) return;
        if (r.msg) await falar(r.msg);
        if (r.resultado === 'aprovada') await executarBan(r.alvo);
    }

    // ---------- Banimento de verdade ----------
    // Caminho: avatar na linha do chat -> "Ver Perfil" -> três pontinhos -> "Remover".
    // Cada passo usa clique de mouse real e só procura dentro do que ACABOU de abrir, para não clicar em coisa errada.
    // O que apareceu em cada passo fica em dump-ban.txt (serve para ajustar se o IMVU for diferente do esperado).
    async function marcarBaseTela() {
        await page.evaluate(() => { window.__baseBan = new WeakSet(document.querySelectorAll('*')); });
    }

    async function descreverNovosTela(titulo) {
        return page.evaluate((titulo) => {
            const nome = (n) => n.tagName.toLowerCase() + (n.classList.length ? '.' + [...n.classList].join('.') : '');
            const limpar = (el, max) => {
                const c = el.cloneNode(true);
                c.querySelectorAll('svg, img, style, script, video, canvas').forEach(n => n.remove());
                return c.outerHTML.replace(/\s+/g, ' ').slice(0, max);
            };
            const base = window.__baseBan;
            const topos = [...document.querySelectorAll('*')]
                .filter(el => !base.has(el) && !(el.parentElement && !base.has(el.parentElement)))
                .filter(el => el.getClientRects().length > 0);
            let s = `\n==== ${titulo}: ${topos.length} elemento(s) novo(s) ====\n`;
            topos.slice(0, 6).forEach((el, i) => { s += `\n[${i + 1}] ${nome(el)}\n${limpar(el, 3000)}\n`; });
            return s;
        }, titulo);
    }

    // Marca (data-bot-ban) um elemento NOVO e visível, achado pelo texto exato ou, se não, por nome/atributo.
    async function marcarNovo(rotulo, padraoTexto, padraoAttr) {
        return page.evaluate((rotulo, padraoTexto, padraoAttr) => {
            document.querySelectorAll('[data-bot-ban]').forEach(x => x.removeAttribute('data-bot-ban'));
            const base = window.__baseBan;
            const reTxt = new RegExp(padraoTexto, 'i');
            const reAttr = padraoAttr ? new RegExp(padraoAttr, 'i') : null;
            const candidatos = [...document.querySelectorAll('button, [role="button"], a, li, div, span')]
                .filter(el => !base.has(el) && el.getClientRects().length > 0);
            const achado = candidatos.find(el => reTxt.test((el.innerText || '').trim()))
                || (reAttr && candidatos.find(el =>
                    reAttr.test(`${el.getAttribute('aria-label') || ''} ${el.title || ''} ${String(el.className || '')}`)));
            if (!achado) return false;
            achado.setAttribute('data-bot-ban', rotulo);
            return true;
        }, rotulo, padraoTexto, padraoAttr || '');
    }

    async function cliqueReal(seletor) {
        const el = await page.$(seletor);
        const box = el ? await el.boundingBox() : null;
        if (!box) return false;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return true;
    }

    async function garantirNaSala() {
        try {
            await page.evaluate(() => { const b = document.querySelector('dialog.uikit-profile-lightbox button.close-dialog'); if (b) b.click(); });
            await delay(400);
            await page.keyboard.press('Escape');
            await delay(400);
            await page.keyboard.press('Escape');
            await delay(400);
            for (const p of (await browser.pages()).slice(1)) await p.close();
            if (!page.url().includes('room-')) {
                console.log('A página saiu da sala; voltando.');
                await page.goto(ROOM_URL, { waitUntil: 'domcontentloaded', timeout: 0 });
                await delay(6000);
                await entrarNaSala();
                await delay(3000);
                vistos.clear();
                presentes.clear();
                meuId = '';
                primeiraLeitura = true;
            }
        } catch (err) {}
    }

    async function executarBan(alvo) {
        if (!BANIR_DE_VERDADE) {
            console.log(`🔨 [TESTE] Banimento de ${alvo.nome} aprovado, mas BANIR_DE_VERDADE está desligado.`);
            await falar('(Modo teste: o banimento de verdade ainda não está ligado.)');
            return;
        }
        console.log(`🔨 [BAN] Iniciando a remoção de ${alvo.nome}...`);
        let rel = `Remoção de ${alvo.nome} (${alvo.id}) em ${new Date().toLocaleString('pt-BR')}\n`;

        const falhar = async (motivo) => {
            rel += `\nFALHOU: ${motivo}\n`;
            fs.writeFileSync('dump-ban.txt', rel, 'utf8');
            console.log(`⚠️ Remoção não concluída: ${motivo} (veja dump-ban.txt)`);
            await falar(`⚠️ Não consegui remover ${alvo.nome} agora. Um moderador pode fazer isso na mão.`);
            await garantirNaSala();
        };

        try {
            await page.bringToFront();

            // 1) acha a linha da pessoa no chat (pelo número dela; se não tiver número, pelo nome) e marca o avatar
            const achou = await page.evaluate((id, nomeAlvo) => {
                document.querySelectorAll('[data-bot-ban]').forEach(x => x.removeAttribute('data-bot-ban'));
                const limpo = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
                const q = limpo(nomeAlvo);
                const linhas = [...document.querySelectorAll('.cs2-msg')]
                    .filter(r => r.querySelector('a.profile-icon-image') && r.getClientRects().length > 0 && !r.classList.contains('is-me'))
                    .reverse();
                let linha = null;
                if (/^\d+$/.test(id || '')) linha = linhas.find(r => (r.getAttribute('data-id') || '').includes('user-' + id));
                if (!linha && q) linha = linhas.find(r => {
                    const n = r.querySelector('.display-name-text');
                    return n && limpo(n.innerText).includes(q);
                });
                if (!linha) return false;
                const icone = linha.querySelector('a.profile-icon-image');
                icone.setAttribute('data-bot-ban', 'icone');
                icone.scrollIntoView({ block: 'center' });
                return true;
            }, alvo.id, alvo.nome);
            if (!achou) return await falhar('não achei uma mensagem dela no chat para clicar');
            await delay(600);

            // 2) clica no avatar (abre o menu pequeno)
            await marcarBaseTela();
            if (!(await cliqueReal('[data-bot-ban="icone"]'))) return await falhar('avatar fora da tela');
            await delay(1000);
            rel += await descreverNovosTela('DEPOIS DE CLICAR NO AVATAR');

            // 3) "Ver Perfil" (item que já vimos no dump: data-menu-item="see_profile")
            await marcarBaseTela();
            if (!(await cliqueReal('.context-menu li[data-menu-item="see_profile"]'))) return await falhar('não achei "Ver Perfil" no menu');
            await delay(2000);
            rel += await descreverNovosTela('DEPOIS DE CLICAR EM VER PERFIL');

            // 3b) segurança: confere que o cartão de perfil aberto é mesmo da pessoa certa
            const nomePerfil = await page.evaluate(() => {
                const d = document.querySelector('dialog.uikit-profile-lightbox');
                if (!d) return null;
                const t = d.querySelector('.display-name-wrapper .text') || d.querySelector('.profile-icon');
                return (t ? (t.innerText || t.getAttribute('title') || '') : '').trim();
            });
            if (nomePerfil === null) return await falhar('o cartão de perfil não abriu');
            const nomeA = norm(semGuest(nomePerfil));
            const nomeB = norm(semGuest(alvo.nome));
            if (!nomeA || !nomeB || (!nomeA.includes(nomeB) && !nomeB.includes(nomeA))) {
                return await falhar(`o perfil aberto é de "${nomePerfil}", não de ${alvo.nome}`);
            }
            rel += `\nPerfil aberto confere: ${nomePerfil}\n`;

            // 4) três pontinhos (dentro do cartão de perfil), tentando mais de um jeito de clicar
            const achouPontinhos = await page.evaluate(() => {
                document.querySelectorAll('[data-bot-ban]').forEach(x => x.removeAttribute('data-bot-ban'));
                const el = [...document.querySelectorAll('dialog.uikit-profile-lightbox .more-ellipsis-wrapper button')]
                    .find(b => b.getClientRects().length > 0);
                if (!el) return false;
                el.setAttribute('data-bot-ban', 'pontinhos');
                return true;
            });
            if (!achouPontinhos) return await falhar('não achei os três pontinhos no perfil');

            const menuAberto = () => page.evaluate(() => {
                const m = document.querySelector('dialog.uikit-profile-lightbox #moreMenu');
                return !!m && getComputedStyle(m).display !== 'none' && m.getClientRects().length > 0;
            });
            let modoAbriu = null;
            for (const modo of ['mouse', 'mouse devagar', 'js']) {
                const el = await page.$('[data-bot-ban="pontinhos"]');
                const box = el ? await el.boundingBox() : null;
                if (modo === 'js') {
                    await page.evaluate(() => { const b = document.querySelector('[data-bot-ban="pontinhos"]'); if (b) b.click(); });
                } else if (box) {
                    const x = box.x + box.width / 2;
                    const y = box.y + box.height / 2;
                    if (modo === 'mouse') {
                        await page.mouse.click(x, y);
                    } else {
                        await page.mouse.move(x, y);
                        await delay(300);
                        await page.mouse.down();
                        await delay(120);
                        await page.mouse.up();
                    }
                }
                await delay(900);
                if (await menuAberto()) { modoAbriu = modo; break; }
            }
            rel += `\nMenu dos pontinhos aberto: ${modoAbriu ? 'SIM (clique: ' + modoAbriu + ')' : 'NÃO'}\n`;
            rel += await page.evaluate(() => {
                const m = document.querySelector('dialog.uikit-profile-lightbox #moreMenu');
                const b = document.querySelector('[data-bot-ban="pontinhos"]');
                let s = '';
                if (b) {
                    const r = b.getBoundingClientRect();
                    const topo = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                    s += 'Botão dos pontinhos: x=' + Math.round(r.x) + ' y=' + Math.round(r.y) + ' l=' + Math.round(r.width) + ' a=' + Math.round(r.height) + '; elemento no ponto do clique: ' + (topo ? topo.tagName.toLowerCase() + '.' + [...topo.classList].join('.') : 'nenhum') + '\n';
                }
                if (m) {
                    const c = m.cloneNode(true);
                    c.querySelectorAll('svg, img, style, script').forEach(n => n.remove());
                    s += `Menu #moreMenu (display: ${getComputedStyle(m).display}): ` + c.outerHTML.replace(/\s+/g, ' ').slice(0, 3500) + '\n';
                } else {
                    s += 'Menu #moreMenu não existe.\n';
                }
                return s;
            });

            // 5) "Remover" dentro do menu do perfil
            const achouRemover = await page.evaluate(() => {
                const el = document.querySelector('dialog.uikit-profile-lightbox #moreMenu li.Remove');
                if (!el || el.hasAttribute('disabled')) return false;
                el.setAttribute('data-bot-ban', 'remover');
                return true;
            });
            if (!achouRemover) return await falhar('não achei o botão Remover no menu do perfil (a pessoa pode ser moderadora)');
            await marcarBaseTela();
            if (modoAbriu) {
                if (!(await cliqueReal('[data-bot-ban="remover"]'))) return await falhar('botão Remover fora da tela');
            } else {
                // último recurso: o item existe mesmo com o menu fechado; dispara o clique direto nele
                rel += 'Menu não abriu: clique direto no item Remover (último recurso).\n';
                await page.evaluate(() => { const b = document.querySelector('[data-bot-ban="remover"]'); if (b) b.click(); });
            }
            await delay(1500);
            rel += await descreverNovosTela('DEPOIS DE CLICAR EM REMOVER');

            // 6) se o IMVU pedir confirmação, confirma
            const achouConfirmar = await page.evaluate(() => {
                document.querySelectorAll('[data-bot-ban]').forEach(x => x.removeAttribute('data-bot-ban'));
                const b = [...document.querySelectorAll('.remove-user-dialog button[data-confirm="yes"]')].find(x => x.getClientRects().length > 0);
                if (!b) return false;
                b.setAttribute('data-bot-ban', 'confirmar');
                return true;
            }) || await marcarNovo('confirmar', '^(confirmar|sim|confirm|yes|ok|remover)$', '');
            if (achouConfirmar) {
                await cliqueReal('[data-bot-ban="confirmar"]');
                await delay(1500);
                rel += await descreverNovosTela('DEPOIS DE CONFIRMAR');
            }

            // 7) só diz que removeu se a pessoa realmente saiu do chat
            let saiu = false;
            for (let i = 0; i < 6 && !saiu; i++) {
                await delay(1000);
                const ents = await lerEntradas();
                saiu = ents.some(e => !vistos.has(e.entry) && e.ehStatus && /saiu|left|remov|kick|expuls|ban/i.test(e.texto)
                    && ((e.userId && e.userId === alvo.id) || norm(semGuest(e.nomeStatus)) === norm(alvo.nome)));
            }
            rel += `\nConfirmação de saída no chat: ${saiu ? 'SIM' : 'NÃO'}\n`;
            fs.writeFileSync('dump-ban.txt', rel, 'utf8');
            await garantirNaSala();
            if (saiu) {
                console.log(`🔨 ${alvo.nome} removido(a).`);
                await falar(`🔨 ${alvo.nome} foi removido(a) da sala.`);
            } else {
                console.log('⚠️ Cliquei em Remover, mas não vi a pessoa sair. Veja o dump-ban.txt.');
                await falar(`⚠️ Cliquei em Remover para ${alvo.nome}, mas não consegui confirmar que a pessoa saiu.`);
            }
        } catch (e) {
            console.log(`⚠️ Erro ao tentar remover: ${e.message}`);
            await falhar(`erro: ${e.message}`);
        }
    }

    // ---------- Mensagens de texto ----------
    // info = { userId, nome, ehCriador }
    async function tratarTexto(msg, info) {
        const mLow = msg.toLowerCase();
        const cmd = mLow.trim();
        const agora = Date.now();

        if (!msg || ehDoBot(msg) || msg.startsWith('http')) return;

        // OFF / ON: "@Prz0 off" e "@Prz0 on" (também vale "cala a boca" / "pode falar").
        // O criador sempre pode. Os moderadores só podem enquanto o chat não estiver travado ("@Prz0 chat0" trava, "@Prz0 chat1" libera).
        if ((info.ehCriador || info.ehModerador) && mLow.includes('@prz0')) {
            const mChatTrava = msg.trim().match(/^@prz0\s+chat\s*(0|1)$/i);
            if (mChatTrava && info.ehCriador) {
                travaChatModeradores = (mChatTrava[1] === '0');
                await falar(travaChatModeradores
                    ? '🔒 Liga/desliga do bot travado pelo PrzY 👑🖤. Só ele manda!'
                    : '🔓 Liga/desliga do bot liberado para os moderadores!');
                return;
            }
            const pedeOff = /^@prz0\s+off$/i.test(msg.trim()) || temPalavra(mLow, ['cala a boca', 'ficar quieto', 'silêncio', 'silencio']);
            const pedeOn = /^@prz0\s+on$/i.test(msg.trim()) || temPalavra(mLow, ['voltar a falar', 'pode falar', 'fala de novo']);
            const podeLigarDesligar = info.ehCriador || !travaChatModeradores;
            if ((pedeOff || pedeOn) && !podeLigarDesligar) {
                if (!botSilenciado) await falar('🔒 O liga/desliga está travado pelo PrzY 👑🖤.');
                return;
            }
            if (pedeOff && !botSilenciado) {
                botSilenciado = true;
                console.log('🛑 Bot em modo OFF (' + (info.ehCriador ? 'criador' : 'moderador') + ').');
                return;
            }
            if (pedeOn && botSilenciado) {
                botSilenciado = false;
                await falar('Voltei! 👑🖤');
                console.log('✅ Bot em modo ON.');
                return;
            }
        }
        // Em modo OFF o bot ignora tudo
        if (botSilenciado) return;

        // Travas (só o PrzY): "@Prz0 ban0" (ou "@ban0") trava o ban direto dos moderadores, "ban1" libera.
        const mBanTrava = msg.trim().match(/^(?:@prz0\s+|@)ban\s*(0|1)$/i);
        if (mBanTrava && info.ehCriador) {
            travaBanModeradores = (mBanTrava[1] === '0');
            await falar(travaBanModeradores
                ? '🔒 Ban direto dos moderadores travado pelo PrzY 👑🖤. Só por votação!'
                : '🔓 Ban direto liberado para os moderadores!');
            return;
        }
        // "@Prz0 p_" trava a roupa dos moderadores | "@Prz0 p_0" libera | "@Prz0 roupa 0" trava | "@Prz0 roupa 1" libera
        const mRoupaTrava = msg.trim().match(/^@prz0\s+(?:p\s*[_\-–]\s*(0)?|roupa\s+(0|1))$/i);
        if (mRoupaTrava && info.ehCriador) {
            const travar = mRoupaTrava[2] !== undefined ? mRoupaTrava[2] === '0' : mRoupaTrava[1] !== '0';
            travaRoupaModeradores = travar;
            await falar(travar
                ? '🔒 Troca de roupa dos moderadores travada pelo PrzY 👑🖤.'
                : '🔓 Troca de roupa liberada para os moderadores!');
            return;
        }

        // !testeia (só o criador): testa a IA e mostra qual modelo respondeu
        if (info.ehCriador && cmd === '!testeia') {
            try {
                const resposta = await chamarModeloIA('Responda apenas com uma frase curta de bom dia, no feminino.');
                console.log(`✅ !testeia: ${descreverIA()} respondeu: ${resposta}`);
                await falar(`✅ IA funcionando (${descreverIA()}): ${resposta.slice(0, 120)}`);
            } catch (e) {
                const motivo = ocultarSegredos(e).replace(/\s+/g, ' ').slice(0, 140);
                console.log(`❌ !testeia falhou: ${motivo}`);
                await falar(`⚠️ A IA não respondeu: ${motivo}`);
            }
            return;
        }

        // PrzY (e moderadores, se não estiver travado): "@Prz0 P_12" (também vale P-12, P12 ou -12). Se outra pessoa escrever isso, vira conversa normal com a IA.
        const mRoupa = msg.trim().match(/^@prz0\s+p\s*[_\-–]?\s*(\d+)$/i) || msg.trim().match(/^@prz0\s+-(.+)$/i);
        if (mRoupa) {
            if (info.ehCriador || (info.ehModerador && !travaRoupaModeradores)) {
                await trocarLook(mRoupa[1].trim());
                return;
            }
            if (info.ehModerador && travaRoupaModeradores) {
                await falar('🔒 A troca de roupa pelos moderadores está travada pelo PrzY 👑🖤.');
                return;
            }
            // outras pessoas: segue como conversa normal com a IA
        }

        // Diagnóstico (só o criador; se o bot não souber quem escreveu, deixa passar para podermos investigar)
        const podeDump = info.ehCriador || !info.userId;
        if (cmd === '!dump' && podeDump) {
            await salvarDump();
            await salvarDumpExtra();
            await falar('Dump salvo! 📄');
            return;
        }
        if (cmd === '!dump2' && podeDump) {
            await salvarDumpMenu();
            await falar('Dump do menu salvo! 📄');
            return;
        }
        // !dump3 ou !dump3 NomeDaPessoa: o bot mesmo tenta abrir o menu da pessoa (só o criador pode, porque ele clica em coisas)
        // Ban direto (criador e moderadores): "@NomeDaPessoa ban". Precisa do @ para não confundir com conversa.
        // "@NomeDaPessoa remover" NÃO bane direto: abre a votação (veja mais abaixo).
        const mDireto = msg.trim().match(/^@(.+?)\s+ban$/i);
        if (mDireto && norm(mDireto[1]) !== norm(NOME_BOT) && (info.ehCriador || info.ehModerador)) {
            if (!info.ehCriador && travaBanModeradores) {
                await falar('🔒 O ban direto dos moderadores está travado pelo PrzY 👑🖤. Use a votação: !banir Nome');
                return;
            }
            const alvoNome = mDireto[1].trim();
            if (norm(semGuest(alvoNome)).length < 3) {
                await falar('Nome muito curto, escreva pelo menos 3 letras.');
                return;
            }
            const rAlvo = votacao.acharAlvoDireto(pessoasNaSala(), alvoNome);
            if (rAlvo.erro) { await falar(rAlvo.erro); return; }
            if (CRIADOR_IDS.includes(rAlvo.alvo.id)) { await falar('Não dá para remover o PrzY 👑🖤'); return; }
            if (MODERADOR_IDS.includes(rAlvo.alvo.id)) { await falar('Moderadores da sala não podem ser removidos! 🛡️'); return; }
            await falar(`${info.ehCriador ? '👑🖤 PrzY mandou' : '🛡️ Moderação'}: removendo ${rAlvo.alvo.nome}.`);
            await executarBan(rAlvo.alvo);
            return;
        }

        // !testeban Nome: tenta remover a pessoa na hora (só o criador; só funciona com BANIR_DE_VERDADE = true)
        const mTeste = msg.trim().match(/^!testeban\s+@?(.+)$/i);
        if (mTeste && info.ehCriador) {
            const q = norm(mTeste[1]);
            const achado = [...pessoasNaSala()].map(([id, nome]) => ({ id, nome })).find(p => norm(p.nome).includes(q));
            if (!achado) { await falar(`Não achei "${mTeste[1].trim()}" na sala.`); return; }
            if (CRIADOR_IDS.includes(achado.id) || MODERADOR_IDS.includes(achado.id)) { await falar('Não dá para remover o PrzY nem os moderadores 👑🖤'); return; }
            await executarBan(achado);
            return;
        }
        const mDump3 = msg.trim().match(/^!dump3(?:\s+@?(.+))?$/i);
        if (mDump3 && info.ehCriador) {
            await explorarMenuDeUsuario(mDump3[1] || '');
            await falar('Exploração do menu salva! 📄');
            return;
        }

        // Comandos do criador (reconhecido pelo NÚMERO do usuário, que ninguém consegue copiar)
        if (info.ehCriador && mLow.includes('@prz0')) {
            if (temPalavra(mLow, ['cala a boca', 'ficar quieto', 'silêncio', 'silencio'])) {
                await falar('PrzY 👑🖤 mandou eu ficar quieta. Silenciada!');
                botSilenciado = true;
                return;
            }
            if (temPalavra(mLow, ['voltar a falar', 'pode falar', 'fala de novo'])) {
                botSilenciado = false;
                await falar('PrzY 👑🖤 deixou eu falar! Voltei.');
                return;
            }
        }

        if (botSilenciado) return;

        const chaveAutor = chaveDe(info.userId, info.nome);

        // Votação para banir
        const mBanir = msg.trim().match(/^!banir\s+@?(.+)$/i) || msg.trim().match(/^@(.+?)\s+remover$/i);
        if (mBanir) {
            if (!info.ehCriador) {
                if (agora - (ultimoBanir.get(chaveAutor) || 0) < COOLDOWN_BANIR_PESSOA_MS) return;
                ultimoBanir.set(chaveAutor, agora);
            }
            if (!info.userId) {
                await falar('Não consegui saber quem você é para abrir a votação. Tente de novo!');
                return;
            }
            await responderVotacao(votacao.abrir({
                autor: { id: chaveAutor, nome: info.nome },
                alvoTexto: mBanir[1],
                presentes: pessoasNaSala(),
                agora
            }));
            return;
        }
        if (cmd === '!sim' || cmd === '!nao' || cmd === '!não') {
            if (!info.userId) return;
            await responderVotacao(votacao.votar({
                eleitor: chaveAutor,
                voto: cmd === '!sim' ? 'sim' : 'nao',
                presentes: pessoasNaSala(),
                agora
            }));
            return;
        }
        if (cmd === '!cancelar' && info.ehCriador) {
            if (votacao.cancelar()) await falar('Votação cancelada por PrzY 👑🖤');
            return;
        }

        // Como chamar a pessoa nas respostas
        let tagUsuario = '';
        if (info.ehCriador) tagUsuario = 'PrzY👑🖤';
        else if (info.ehModerador && info.nome) tagUsuario = info.nome;
        else if (info.nome) tagUsuario = info.nome.length <= 25 ? (/\s/.test(info.nome) ? info.nome : `@${info.nome}`) : '@amigo';
        const resp = (t) => (tagUsuario ? `${tagUsuario} ` : '') + t;
        const chaveConversa = info.userId || 'desconhecido';

        // Ajuda
        if (cmd === '!ajuda' || cmd === '!comandos') {
            if (agora - ultimaAjuda < COOLDOWN_AJUDA_MS) return;
            ultimaAjuda = agora;
            await falar('📋 Comandos: @Prz0 + sua mensagem = conversar comigo 😉 | @piada = eu conto uma | !play link | !fila');
            await falar('🗳️ Votação: @Nome remover (ou !banir Nome) abre a votação, !sim e !nao votam (precisa de 4+ pessoas na sala).');
            if (info.ehModerador) await falar('🛡️ Moderador: @Nome ban (remove na hora) | @Prz0 P_12 (roupa) | @Prz0 off / on | !play link (toca na hora) | !proxima | !limparfila');
            if (info.ehCriador) await falar('👑🖤 PrzY: @Prz0 ban0 / ban1 (ban dos mods) | @Prz0 P_ / P_0 (roupa dos mods) | @Prz0 chat0 / chat1 (off/on dos mods) | @Prz0 off / on | !cancelar');
            return;
        }

        // Música. PrzY e moderadores tocam na hora; os pedidos das outras pessoas entram na fila (a não ser que MUSICA_LIVRE_PARA_TODOS = true).
        const ehMusica = cmd === '!fila' || cmd === '!tocando' || cmd === '!proxima' || cmd === '!próxima' || cmd === '!limparfila' || cmd.startsWith('!play ');
        if (ehMusica) {
            const privilegiado = info.ehCriador || info.ehModerador;
            if (!privilegiado && agora - ultimaMusica < COOLDOWN_MUSICA_MS) return;
            ultimaMusica = agora;
            const nomePedido = tagUsuario || 'Amigo';

            if (cmd === '!fila' || cmd === '!tocando') {
                const tocando = tocandoAgora ? `Tocando agora (pedido de ${tocandoAgora.usuario}). ` : '';
                await falar(`🎵 ${tocando}${filaMusicas.length ? `Há ${filaMusicas.length} música(s) na fila.` : 'A fila está vazia.'}`);
                return;
            }
            if (cmd === '!limparfila') {
                if (!privilegiado) return;
                filaMusicas = [];
                await falar('🎵 Fila de músicas limpa!');
                return;
            }
            if (cmd === '!proxima' || cmd === '!próxima') {
                if (!privilegiado) return;
                if (!filaMusicas.length) {
                    await falar('🎵 Não há músicas na fila.');
                    return;
                }
                const proxima = filaMusicas.shift();
                await falar(`🎵 Tocando o pedido de ${proxima.usuario}.`);
                if (await tocarMusica(proxima.pedido)) tocandoAgora = proxima;
                return;
            }

            const pedido = msg.trim().slice(6).trim();
            if (!pedido) return;
            if (!/^https?:\/\/\S+$/i.test(pedido)) {
                await falar('🎵 Envie !play seguido de um link (YouTube, rádio ou áudio). Só o nome da música eu não consigo tocar.');
                return;
            }
            if (privilegiado || MUSICA_LIVRE_PARA_TODOS) {
                const item = { pedido, usuario: nomePedido };
                if (await tocarMusica(pedido)) tocandoAgora = item;
                return;
            }
            if (filaMusicas.length >= MAX_FILA_MUSICAS) {
                await falar('🎵 A fila está cheia, espere umas músicas tocarem!');
                return;
            }
            filaMusicas.push({ pedido, usuario: nomePedido });
            await falar(`🎵 Pedido adicionado à fila (posição ${filaMusicas.length}). Um moderador toca com !proxima.`);
            return;
        }

        // Risadas (sem precisar de @prz0), com intervalo para não virar spam nem loop
        if (RISADA.test(mLow) && agora - ultimoRiso >= COOLDOWN_RISADA_MS && Math.random() < CHANCE_RISADA) {
            ultimoRiso = agora;
            await delay(1500);
            await falar(LISTA_RISADAS[Math.floor(Math.random() * LISTA_RISADAS.length)]);
            return;
        }

        // Piada
        if (/(^|\s)@piadas?(?=\s|$|[!?.,])/i.test(mLow) && agora - ultimaPiada >= COOLDOWN_PIADA_MS) {
            ultimaPiada = agora;
            await delay(1000);
            const [pergunta, resposta] = proximaPiada();
            await falar(resp(pergunta));
            await delay(4000);
            await falar(resposta);
            return;
        }

        // O restante das conversas exige menção com @prz0
        // A IA só conversa quando marcam @Prz0. Cada pessoa tem a sua própria conversa (histórico separado),
        // apagada depois de 2 minutos sem nova mensagem dela. Sem o @Prz0, ela fica quieta.
        if (!mLow.includes('@prz0')) return;

        const ultima = ultimaIA.get(chaveConversa) || 0;
        if (agora - ultima < COOLDOWN_IA_PESSOA_MS) return;
        ultimaIA.set(chaveConversa, agora);

        const pergunta = msg.replace(/@prz0/ig, '').trim() || 'Oi!';
        await delay(1200);
        const respostaIA = await gerarRespostaIA(tagUsuario || 'Amigo', pergunta, chaveConversa, info.ehCriador, info.ehModerador);
        await falar(resp(respostaIA));
    }

    // ---------- Cada linha nova do chat ----------
    // inicial = true na primeira leitura: só aprende quem está na sala, sem cumprimentar nem responder ninguém
    async function processarEntrada(e, inicial) {
        const agora = Date.now();

        // Avisos do sistema (entrou / saiu / está no chat)
        if (e.ehStatus) {
            const mEnt = e.texto.match(REGEX_ENTRADA);
            const mSai = e.texto.match(REGEX_SAIDA);
            const nomeBruto = e.nomeStatus || (mEnt && mEnt[1]) || (mSai && mSai[1]) || '';
            const nomeLimpo = semGuest(nomeBruto);
            const chave = chaveDe(e.userId, nomeLimpo);
            if (e.userId && nomeLimpo) nomes.set(e.userId, nomeLimpo);

            // "Você juntou-se ao chat" = o próprio bot
            if (e.ehMeu || /^voc[eê]\b/i.test(e.texto) || /^you\b/i.test(e.texto)) {
                if (e.userId) meuId = e.userId;
                return;
            }
            if (!nomeLimpo) return;
            if (norm(nomeLimpo) === norm(NOME_BOT) || (meuId && e.userId === meuId)) return;

            if (mSai) {
                presentes.delete(chave);
                return;
            }
            if (!mEnt) return;

            presentes.set(chave, { id: e.userId, nome: nomeLimpo });
            if (inicial || botSilenciado) return;

            const ehCriador = e.userId ? CRIADOR_IDS.includes(e.userId) : norm(nomeLimpo) === 'przy';
            const modInfo = e.userId ? MODERADORES.find(m => m.id === e.userId) : null;
            const ehModerador = !!modInfo;
            const limite = (ehCriador || ehModerador) ? COOLDOWN_CRIADOR_MS : COOLDOWN_SAUDACAO_MS;
            if (ultimaSaudacao.has(chave) && agora - ultimaSaudacao.get(chave) < limite) return;
            ultimaSaudacao.set(chave, agora);
            if (!ehCriador && !ehModerador) novosDesdeAviso.add(chave);

            await delay(1500);
            const marca = /\s/.test(nomeLimpo) ? nomeLimpo : `@${nomeLimpo}`;
            let msgEntrada = `Seja bem-vindo(a), ${marca}!`;
            if (ehCriador) msgEntrada = MSG_CRIADOR;
            else if (modInfo) msgEntrada = `Seja bem-vindo, ${modInfo.nome}`;
            await falar(msgEntrada);
            return;
        }

        // Mensagem de texto (ignora a história antiga e as mensagens do próprio bot)
        if (e.ehMeu) return;
        if (e.userId && e.nomeTexto) nomes.set(e.userId, semGuest(e.nomeTexto));
        if (inicial) return;

        const nomeAutor = nomes.get(e.userId) || '';
        // Quem fala está na sala: ajuda a contar as pessoas mesmo se o aviso de entrada passou batido
        if (e.userId && nomeAutor && e.userId !== meuId && norm(nomeAutor) !== norm(NOME_BOT) && !presentes.has(e.userId)) {
            presentes.set(e.userId, { id: e.userId, nome: nomeAutor });
        }
        const modAutor = e.userId ? MODERADORES.find(m => m.id === e.userId) : null;
        await tratarTexto(e.texto, {
            userId: e.userId,
            nome: modAutor ? modAutor.nome : nomeAutor,
            ehCriador: !!e.userId && CRIADOR_IDS.includes(e.userId),
            ehModerador: !!modAutor
        });
    }

    // Limpa de tempos em tempos os registros antigos (evita a memória crescer para sempre numa sala movimentada)
    function limparMemoria() {
        const limite = Date.now() - 60 * 60 * 1000;
        for (const m of [ultimaIA, ultimoBanir, ultimaSaudacao]) {
            for (const [k, t] of m) if (t < limite) m.delete(k);
        }
        for (const [k, h] of historicoIA) if (h.t < limite) historicoIA.delete(k);
    }

    // ---------- LOOP PRINCIPAL ----------
    const vistos = new Set();
    let primeiraLeitura = true;
    let ciclo = 0;
    let ciclosSemLinhas = 0;
    let avisouSemLinhas = false;
    let avisosSemAutor = 0;

    while (true) {
        try {
            ciclo++;
            if (ciclo % 20 === 0) await entrarNaSala();
            if (ciclo % 400 === 0) limparMemoria();

            // Aviso de estrelas: depois de gente nova entrar, respeitando os intervalos
            const agora = Date.now();
            const desdeUltimoAviso = agora - ultimoAvisoEstrelas;
            const gentePara = novosDesdeAviso.size;
            const deveAvisar = !botSilenciado && (
                (gentePara >= PESSOAS_NOVAS_PARA_AVISO && desdeUltimoAviso >= INTERVALO_MINIMO_AVISO_MS) ||
                (gentePara >= 1 && desdeUltimoAviso >= INTERVALO_MAXIMO_AVISO_MS)
            );
            if (deveAvisar) {
                ultimoAvisoEstrelas = agora;
                novosDesdeAviso.clear();
                const msgEstrela = MSGS_ESTRELAS[proximaMsgEstrela % MSGS_ESTRELAS.length];
                proximaMsgEstrela++;
                await falar(msgEstrela);
            }

            // Votação em andamento: confere o tempo e quem saiu da sala
            if (!botSilenciado) await responderVotacao(votacao.verificar({ presentes: pessoasNaSala(), agora: Date.now() }));

            const entradas = await lerEntradas();

            if (entradas.length === 0) {
                ciclosSemLinhas++;
                if (ciclosSemLinhas >= 20 && !avisouSemLinhas) {
                    console.log('⚠️ Não achei nenhuma linha do chat (.cs2-msg). O IMVU pode ter mudado o site: escreva !dump para eu ver.');
                    avisouSemLinhas = true;
                }
            } else {
                ciclosSemLinhas = 0;
            }

            const novas = entradas
                .filter(e => !vistos.has(e.entry))
                .sort((a, b) => numeroEntrada(a.entry) - numeroEntrada(b.entry));

            for (const e of novas) {
                if (vistos.has(e.entry)) continue;              // a página repete cada linha em mais de um lugar
                if (!e.ehStatus && !e.texto) continue;          // linha ainda sem texto: tenta no próximo ciclo
                vistos.add(e.entry);

                if (!primeiraLeitura) {
                    if (DEBUG) console.log(`👀 [${e.kind || '?'}] usuário ${e.userId || '?'}${e.ehMeu ? ' (eu)' : ''}: "${e.texto}"`);
                    if (!e.ehStatus && !e.ehMeu && !e.userId && avisosSemAutor < 3) {
                        avisosSemAutor++;
                        console.log('⚠️ Mensagem sem autor reconhecido. Escreva !dump para eu ver como essa linha é.');
                    }
                }
                await processarEntrada(e, primeiraLeitura);
            }

            if (primeiraLeitura && entradas.length > 0) {
                primeiraLeitura = false;
                console.log('🛡️ Monitoramento ativo! Pessoas na sala agora: ' + pessoasNaSala().size);
            }
            if (vistos.size > 5000) {
                vistos.clear();
                entradas.forEach(e => vistos.add(e.entry));
            }
        } catch (e) {
            console.log(`⚠️ Erro no monitoramento: ${e.message}`);
        }

        await delay(2500);
    }
}

process.on('unhandledRejection', (e) => console.log(`⚠️ Erro não tratado: ${ocultarSegredos(e).slice(0, 300)}`));
iniciarBot().catch((e) => { console.error(ocultarSegredos(e)); process.exit(1); });

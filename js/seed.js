// Dados de demonstração. Nomes, CNPJs, endereços e setores são fictícios.
import { today, addDays } from './ui.js';
import { pointInPolygon, dist, ordenarRota } from './geo.js';
import { aplicarResultado } from './dominio.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const VISTORIADORES = [
  { id: 'v1', nome: 'Sd Almeida', cor: '#2563EB' },
  { id: 'v2', nome: 'Cb Barbosa', cor: '#EA580C' },
  { id: 'v3', nome: 'Sgt Carvalho', cor: '#0D9488' },
  { id: 'v4', nome: 'Sd Duarte', cor: '#7C3AED' },
];

// Setores ilustrativos ([lat, lng]). Substitua pelos setores reais no painel (Ajustes > Setores).
const SETORES = [
  { id: 's1', nome: 'Centro', poligono: [[-9.368, -40.523], [-9.367, -40.510], [-9.369, -40.497], [-9.380, -40.496], [-9.390, -40.498], [-9.391, -40.511], [-9.389, -40.524], [-9.378, -40.525]] },
  { id: 's2', nome: 'Leste', poligono: [[-9.369, -40.497], [-9.367, -40.487], [-9.368, -40.476], [-9.377, -40.475], [-9.384, -40.477], [-9.386, -40.488], [-9.390, -40.498], [-9.380, -40.496]] },
  { id: 's3', nome: 'Oeste', poligono: [[-9.368, -40.523], [-9.378, -40.525], [-9.389, -40.524], [-9.390, -40.538], [-9.388, -40.552], [-9.377, -40.553], [-9.367, -40.551], [-9.366, -40.537]] },
  { id: 's4', nome: 'Norte', poligono: [[-9.368, -40.523], [-9.367, -40.510], [-9.369, -40.497], [-9.356, -40.496], [-9.342, -40.498], [-9.341, -40.511], [-9.343, -40.524], [-9.355, -40.525]] },
  { id: 's5', nome: 'Nordeste', poligono: [[-9.369, -40.497], [-9.367, -40.487], [-9.368, -40.476], [-9.356, -40.474], [-9.344, -40.477], [-9.342, -40.488], [-9.342, -40.498], [-9.356, -40.496]] },
  { id: 's6', nome: 'Noroeste', poligono: [[-9.368, -40.523], [-9.355, -40.525], [-9.343, -40.524], [-9.342, -40.538], [-9.344, -40.552], [-9.356, -40.554], [-9.367, -40.551], [-9.366, -40.537]] },
  { id: 's7', nome: 'Perímetro irrigado', poligono: [[-9.250, -40.640], [-9.245, -40.590], [-9.280, -40.565], [-9.320, -40.575], [-9.335, -40.620], [-9.320, -40.680], [-9.280, -40.690]] },
];

const NOMES = {
  comercio: [['Restaurante Sabor do Vale', '5611201'], ['Mercadinho Central', '4711302'], ['Supermercado Ponto Certo', '4711302'], ['Academia Movimento', '9313100'], ['Bar do Espetinho', '5611204'], ['Materiais de Construção Alicerce', '4744099'], ['Oficina Motor Forte', '4520001'], ['Restaurante Tempero Sertanejo', '5611201'], ['Churrascaria Brasa Viva', '5611201'], ['Supermercado Família', '4711302'], ['Hipermercado Vale Shop', '4711301'], ['Lanchonete Trigo Bom', '5611201'], ['Pizzaria Forno a Lenha', '5611201'], ['Mercado São Francisco', '4711302'], ['Academia Corpo em Forma', '9313100'], ['Bar da Esquina', '5611204'], ['Restaurante Bode Assado', '5611201'], ['Depósito de Construção Rocha', '4744099'], ['Auto Center Rodoviário', '4520001'], ['Supermercado Economia', '4711302'], ['Self-service Sabor Caseiro', '5611201'], ['Cantina Sertão Grill', '5611201'], ['Mercadinho Bairro Novo', '4711302'], ['Academia Ritmo', '9313100'], ['Bar Ponto de Encontro', '5611204'], ['Restaurante Peixe do Rio', '5611201'], ['Construmais Materiais', '4744099'], ['Lanchonete Ponto do Açaí', '5611201'], ['Retífica Pistão', '4520001'], ['Restaurante Cozinha da Vovó', '5611201']],
  publico: [['Casa de shows Forró Pé de Serra', '9329801'], ['Bar e Petiscaria Estação', '5611205'], ['Salão de festas Primavera', '8230002'], ['Igreja Comunidade da Fé', '9491000'], ['Clube Recreativo Sertão', '9312300'], ['Espaço de eventos Jardim', '8230002'], ['Danceteria Vibe', '9329801'], ['Templo Boa Esperança', '9491000'], ['Bar Seresta do Rio', '5611205'], ['Buffet Recepções Estrela', '8230002'], ['Igreja Missão Viva', '9491000'], ['Associação Atlética Vale', '9312300'], ['Choperia Ponto Alto', '5611205'], ['Cine Vale (exemplo)', '5914600'], ['Arena de Eventos Sertão', '8230002'], ['Paróquia Exemplo', '9491000'], ['Bar Pé de Manga', '5611205']],
  inflamaveis: [['Posto Rota Norte', '4731800'], ['Posto Avenida', '4731800'], ['Gás Bom Revenda', '4784900'], ['Distribuidora Chama Azul', '4682600'], ['Fogos e Artigos Juninos', '4789006'], ['Posto Bairro Novo', '4731800'], ['Gás Já Revenda', '4784900'], ['Posto Trevo', '4731800'], ['Revenda de Gás Nordeste', '4784900']],
  vulneraveis: [['Colégio Saber', '8513900'], ['Escola Pequeno Príncipe', '8512100'], ['Creche Arco-Íris', '8511200'], ['Hotel Avenida', '5510801'], ['Pousada Caminho do Sol', '5510801'], ['Hospital Clínica Vida', '8610101'], ['Faculdade Vale do Saber', '8531700'], ['Lar de Idosos Bem Viver', '8711502'], ['Colégio Nova Geração', '8520100'], ['Escola Mundo Encantado', '8512100'], ['Hotel Vale do São Francisco (exemplo)', '5510801'], ['Clínica Pronto Atendimento Saúde', '8610102'], ['Colégio Integração', '8513900'], ['Pousada das Águas', '5510801'], ['Centro Educacional Aprender', '8513900'], ['Creche Cantinho Feliz', '8511200'], ['Motel Oásis', '5510803']],
  agro: [['Packing house Vale Verde', '0163600'], ['Packing house Manga Rosa', '0163600'], ['Câmara fria Frutas do Sertão', '5211799'], ['Packing house Uva Doce', '0163600'], ['Depósito Agrícola Irrigação', '5211799'], ['Fábrica de Polpas Caatinga', '1033302'], ['Vinícola Exemplo do Vale', '1112700']],
};
const RUAS = ['Rua das Acácias', 'Rua dos Ipês', 'Av. das Mangueiras', 'Rua Projetada 12', 'Travessa do Comércio', 'Rua dos Juazeiros', 'Av. Principal', 'Rua das Carnaubeiras', 'Rua do Mandacaru', 'Rua das Umburanas', 'Rua São João', 'Rua da Feira'];

export function gerarDemo() {
  const r = rng(20261025);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const hoje = today();
  let seq = 0;
  const id = (p) => `${p}${++seq}`;

  const pontoEm = (setor) => {
    const lats = setor.poligono.map((p) => p[0]), lngs = setor.poligono.map((p) => p[1]);
    const [a, b, c, d] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    for (let i = 0; i < 500; i++) {
      const p = { lat: a + r() * (b - a), lng: c + r() * (d - c) };
      if (pointInPolygon(p, setor.poligono)) return { lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) };
    }
    return { lat: (a + b) / 2, lng: (c + d) / 2 };
  };
  const cnpjFicticio = () => {
    let s = '99';
    for (let i = 0; i < 6; i++) s += Math.floor(r() * 10);
    return s + '0001' + '00'; // dígitos verificadores propositalmente inválidos
  };

  // ---------- estabelecimentos ----------
  const usados = new Set();
  const nomeLivre = (cat) => {
    const pool = NOMES[cat].filter(([n]) => !usados.has(n));
    const [n, c] = pool.length ? pick(pool) : [`${pick(NOMES[cat])[0]} ${Math.floor(r() * 90 + 10)}`, pick(NOMES[cat])[1]];
    usados.add(n);
    return [n, c];
  };
  const estabelecimentos = [];
  const novoEstab = (setor, cat) => {
    const [nome, cnae] = nomeLivre(cat);
    const p = pontoEm(setor);
    const sorte = r();
    const situacao = sorte < 0.45 ? 'desconhecida' : sorte < 0.70 ? 'valido' : sorte < 0.85 ? 'vencido' : sorte < 0.95 ? 'em_andamento' : 'sem_documento';
    const e = {
      id: id('e'), cnpj: cnpjFicticio(), nome, cnae,
      endereco: setor.id === 's7' ? `Lote ${Math.floor(r() * 300 + 1)}, Núcleo ${Math.floor(r() * 11 + 1)}` : `${pick(RUAS)}, ${Math.floor(r() * 1500 + 10)}`,
      bairro: setor.nome, lat: p.lat, lng: p.lng,
      abertura: addDays(hoje, -Math.floor(r() * 3000 + 90)),
      origem: 'receita', situacao_doc: situacao,
      validade_doc: situacao === 'valido' ? addDays(hoje, Math.floor(r() * 600 + 20)) : null,
      ultima_fiscalizacao: r() < 0.5 ? null : addDays(hoje, -Math.floor(r() * 1100 + 40)),
      notificacoes: r() < 0.75 ? 0 : (r() < 0.6 ? 1 : 2),
      ultimo_resultado: null,
    };
    estabelecimentos.push(e);
    return e;
  };
  const urbanos = SETORES.filter((s) => s.id !== 's7');
  const mix = ['comercio', 'comercio', 'comercio', 'publico', 'vulneraveis', 'inflamaveis', 'publico', 'comercio', 'vulneraveis'];
  for (const s of urbanos) for (let i = 0; i < 11; i++) novoEstab(s, mix[(i + s.id.charCodeAt(1)) % mix.length]);
  const rural = SETORES.find((s) => s.id === 's7');
  for (let i = 0; i < 7; i++) novoEstab(rural, i === 6 ? 'inflamaveis' : 'agro');
  // Alguns CNPJs abertos neste mês, ainda sem registro conhecido no CBMPE
  estabelecimentos.filter((e) => ['publico', 'inflamaveis', 'agro'].some((c) => NOMES[c].some(([n]) => n === e.nome))).slice(0, 5)
    .forEach((e, i) => { e.abertura = addDays(hoje, -(8 + i * 9)); e.situacao_doc = 'desconhecida'; e.validade_doc = null; e.ultima_fiscalizacao = null; e.notificacoes = 0; });

  const doSetor = (sid) => estabelecimentos.filter((e) => pointInPolygon(e, SETORES.find((s) => s.id === sid).poligono));

  // ---------- missões ----------
  const missoes = [];
  const processo = () => `SAC ${new Date().getFullYear()}.0${Math.floor(r() * 90000 + 10000)}`;
  const desloc = (p, metros) => {
    const ang = r() * Math.PI * 2;
    return { lat: +(p.lat + (metros / 111320) * Math.cos(ang)).toFixed(6), lng: +(p.lng + (metros / (111320 * Math.cos(p.lat * Math.PI / 180))) * Math.sin(ang)).toFixed(6) };
  };
  const hora = (data, h, m) => { const [y, mo, d] = data.split('-').map(Number); return new Date(y, mo - 1, d, h, m).getTime(); };
  const novaMissao = (estab, o) => {
    const m = {
      id: id('m'), estab_id: estab.id, tipo: 'regularizacao', prioridade: 'media', status: 'pendente',
      data: null, vistoriador_id: null, ordem: 0, processo: null, prazo: null, notas: '',
      origem: 'manual', criado_em: addDays(hoje, -Math.floor(r() * 12 + 1)), checkin: null, checkout: null, ...o,
    };
    missoes.push(m);
    return m;
  };
  const concluir = (m, estab, h0, resultado, situacao) => {
    const ci = desloc(estab, 15 + r() * 50);
    m.status = 'concluida';
    m.checkin = { ts: hora(m.data, h0, Math.floor(r() * 50)), lat: ci.lat, lng: ci.lng, precisao: 8 + Math.round(r() * 12), distancia: Math.round(dist(ci, estab)), dentro: true };
    m.checkout = { ts: m.checkin.ts + (25 + Math.floor(r() * 30)) * 60000, resultado, situacao_doc: situacao, validade: situacao === 'valido' ? addDays(hoje, 365) : null, obs: '', fotos: [] };
    aplicarResultado(estab, m.checkout, m.data);
  };

  // Ontem: tudo concluído
  const ontem = addDays(hoje, -1);
  const escalaOntem = { s5: 'v1', s6: 'v2', s1: 'v3', s2: 'v4' };
  const resultadosOntem = [['regular', 'valido'], ['notificado', 'vencido'], ['regular', 'valido'], ['fechado', 'desconhecida'], ['regular', 'em_andamento'], ['notificado', 'sem_documento']];
  const BASE = { lat: -9.3800, lng: -40.5030 };
  for (const [sid, vid] of Object.entries(escalaOntem)) {
    ordenarRota(BASE, doSetor(sid).slice(5, 9)).forEach((e, i) => {
      const m = novaMissao(e, { data: ontem, vistoriador_id: vid, ordem: i + 1, processo: processo(), criado_em: addDays(ontem, -6) });
      const [res, sit] = resultadosOntem[(i + vid.charCodeAt(1)) % resultadosOntem.length];
      concluir(m, e, 8 + i * 2, res, sit);
    });
  }

  // Hoje
  const escalaHoje = { s1: 'v1', s4: 'v2', s3: 'v3', s2: 'v4' };
  const planoTipos = ['regularizacao', 'regularizacao', 'regularizacao', 'retorno', 'fiscalizacao'];
  for (const [sid, vid] of Object.entries(escalaHoje)) {
    ordenarRota(BASE, doSetor(sid).slice(0, 5)).forEach((e, i) => {
      const tipo = planoTipos[i];
      novaMissao(e, {
        data: hoje, vistoriador_id: vid, ordem: i + 1, tipo,
        prioridade: tipo === 'retorno' ? 'alta' : 'media',
        processo: tipo === 'regularizacao' ? processo() : null,
        prazo: tipo === 'regularizacao' ? addDays(hoje, Math.floor(r() * 8 + 2)) : tipo === 'retorno' ? addDays(hoje, 1) : null,
        origem: tipo === 'fiscalizacao' ? 'sugestao' : 'manual',
        notas: tipo === 'retorno' ? 'Conferir extintores e sinalização exigidos na notificação anterior.' : '',
      });
    });
  }
  const deHoje = (vid) => missoes.filter((m) => m.data === hoje && m.vistoriador_id === vid);
  const E = (m) => estabelecimentos.find((e) => e.id === m.estab_id);
  // Sd Almeida: 2 concluídas, 1 no local
  deHoje('v1').forEach((m, i) => {
    if (i === 0) concluir(m, E(m), 8, 'regular', 'valido');
    if (i === 1) concluir(m, E(m), 9, 'notificado', 'vencido');
    if (i === 2) { const ci = desloc(E(m), 30); m.status = 'no_local'; m.checkin = { ts: hora(hoje, 10, 40), lat: ci.lat, lng: ci.lng, precisao: 11, distancia: Math.round(dist(ci, E(m))), dentro: true }; }
  });
  deHoje('v2').forEach((m, i) => { if (i === 0) concluir(m, E(m), 8, 'regular', 'valido'); });
  // Sgt Carvalho: uma chegada fora do raio, com pedido de correção do ponto
  const correcoes = [];
  deHoje('v3').forEach((m, i) => {
    if (i === 0) concluir(m, E(m), 8, 'regular', 'em_andamento');
    if (i === 1) {
      concluir(m, E(m), 9, 'fechado', 'desconhecida');
      const fora = desloc(E(m), 420);
      Object.assign(m.checkin, { lat: fora.lat, lng: fora.lng, distancia: Math.round(dist(fora, E(m))), dentro: false, justificativa: 'Endereço no mapa não confere. Estabelecimento fica no fim da rua, próximo à praça.' });
      correcoes.push({ id: id('c'), estab_id: m.estab_id, missao_id: m.id, lat: fora.lat, lng: fora.lng, vistoriador_id: 'v3', ts: m.checkin.ts, status: 'pendente' });
    }
    if (i === 2) concluir(m, E(m), 11, 'regular', 'valido');
  });

  // Fila (sem vistoriador)
  const fila = [
    ['s7', 0, { tipo: 'regularizacao', prazo: addDays(hoje, 6), processo: processo(), notas: 'Packing house com câmaras frias. Levar trena para conferir afastamentos.' }],
    ['s7', 2, { tipo: 'regularizacao', prazo: addDays(hoje, 10), processo: processo() }],
    ['s5', 0, { tipo: 'regularizacao', prazo: addDays(hoje, 3), processo: processo() }],
    ['s5', 1, { tipo: 'regularizacao', prazo: addDays(hoje, 8), processo: processo() }],
    ['s6', 0, { tipo: 'regularizacao', prazo: addDays(hoje, 12), processo: processo() }],
    ['s4', 6, { tipo: 'denuncia', prioridade: 'alta', notas: 'Denúncia: lotação acima da capacidade e saída de emergência trancada nos fins de semana.' }],
    ['s6', 2, { tipo: 'retorno', prioridade: 'alta', prazo: addDays(hoje, 2), notas: 'Retorno da notificação: iluminação de emergência.' }],
    ['s5', 3, { tipo: 'retorno', prioridade: 'alta', prazo: addDays(hoje, -1), notas: 'Prazo da notificação venceu ontem.' }],
    ['s3', 6, { tipo: 'regularizacao', prazo: addDays(hoje, 5), processo: processo() }],
  ];
  fila.forEach(([sid, idx, o]) => { const e = doSetor(sid)[idx]; if (e) novaMissao(e, o); });

  // Pedido de encaixe do Sd Almeida (estabelecimento próximo, sem registro)
  const livres = doSetor('s1').filter((e) => !missoes.some((m) => m.estab_id === e.id));
  const solicitacoes = livres.length ? [{ id: id('q'), estab_id: livres[0].id, vistoriador_id: 'v1', data: hoje, ts: hora(hoje, 10, 55), status: 'pendente', obs: 'Fica na mesma quadra da vistoria atual.' }] : [];

  // ---------- eventos ----------
  const casaShows = estabelecimentos.find((e) => e.nome.startsWith('Casa de shows')) || estabelecimentos[0];
  const locais = [
    { id: 'l1', nome: 'Pátio de eventos (exemplo)', lat: -9.3752, lng: -40.4835, capacidade: 15000, saidas: '6 saídas, 2 delas com rampa', acesso_viatura: 'Portão lateral pela rua de trás, 4 m de largura', ponto_agua: 'Hidrante a cerca de 120 m, esquina norte', pendencias: 'Iluminação de emergência do palco secundário incompleta na última edição.' },
    { id: 'l2', nome: casaShows.nome, estab_id: casaShows.id, lat: casaShows.lat, lng: casaShows.lng, capacidade: 900, saidas: '2 saídas', acesso_viatura: 'Pela frente, rua estreita', ponto_agua: 'Não identificado', pendencias: '' },
    { id: 'l3', nome: 'Parque de vaquejada (exemplo)', lat: -9.2950, lng: -40.6000, capacidade: 5000, saidas: 'Área aberta, cercada', acesso_viatura: 'Estrada vicinal de terra, 6 km da BR', ponto_agua: 'Caixa d’água do parque, sem hidrante', pendencias: 'Arquibancada metálica precisa de laudo de montagem.' },
  ];
  const proxSabado = (() => { let d = addDays(hoje, 3); while (new Date(d + 'T12:00').getDay() !== 6) d = addDays(d, 1); return d; })();
  const eventos = [
    { id: 'ev1', nome: 'Forró de sábado', local_id: 'l2', inicio: proxSabado, fim: proxSabado, publico: 1200, status: 'nao_recebido', processo: null, origem: 'Visto na divulgação em rede social', notas: '' },
    { id: 'ev2', nome: 'Festival de vinhos e uvas (exemplo)', local_id: 'l1', inicio: addDays(hoje, 12), fim: addDays(hoje, 14), publico: 8000, status: 'recebido', processo: processo(), origem: 'Solicitação no SAC', notas: 'Montagem de palco começa 3 dias antes.' },
    { id: 'ev3', nome: 'Vaquejada do Vale (exemplo)', local_id: 'l3', inicio: addDays(hoje, 20), fim: addDays(hoje, 22), publico: 4000, status: 'recebido', processo: processo(), origem: 'Solicitação no SAC', notas: '' },
    { id: 'ev4', nome: 'Réveillon (exemplo)', local_id: 'l1', inicio: `${new Date().getFullYear()}-12-31`, fim: `${new Date().getFullYear()}-12-31`, publico: 20000, status: 'nao_recebido', processo: null, origem: 'Calendário da cidade', notas: '' },
  ];

  const escala = { [hoje]: escalaHoje, [ontem]: escalaOntem };

  return {
    versao: 1, modo: 'demo', criado_em: Date.now(),
    config: {
      unidade: 'CBMPE / CAT Sertão',
      base: { ...BASE },
      raio_checkin: 150,
      capacidade_dia: 7,
      prazo_retorno_dias: 30,
      pesos: { ocupacao: 30, documental: 25, historico: 20, exposicao: 15, tempo: 10 },
      cotas: { solicitada: 65, urgencia: 20, proativa: 15 },
      limite_sugestao: 45,
    },
    vistoriadores: VISTORIADORES.map((v) => ({ ...v })),
    setores: SETORES.map((s) => ({ ...s, poligono: s.poligono.map((p) => p.slice()) })),
    estabelecimentos, missoes, solicitacoes, correcoes,
    decisoes: {}, escala, eventos, locais, outbox: [],
  };
}

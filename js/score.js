// Motor de sugestões: regras transparentes, inspiradas na matriz preliminar do projeto GEOSEG.
// Cada ponto do escore vem com o motivo, para que a decisão seja auditável.
import { dist } from './geo.js';
import { today, diffDays, addDays } from './ui.js';

let CNAE = { categorias: {}, cnaes: {} };
export function setCnae(js) { CNAE = js; }
export function cnaeInfo(cod) {
  const c = CNAE.cnaes[String(cod || '').replace(/\D/g, '')];
  if (!c) return { desc: cod ? `CNAE ${cod}` : 'Atividade não informada', categoria: null, cat: null };
  return { ...c, cat: CNAE.categorias[c.categoria] };
}
export function categorias() { return CNAE.categorias; }

const ABERTOS = ['pendente', 'no_local'];

export function pontuar(e, ctx) {
  const { pesos } = ctx.config;
  const hoje = today();
  const partes = [];
  const tags = [];

  // 1. Ocupação e consequências potenciais
  const info = cnaeInfo(e.cnae);
  let fOc = info.cat ? info.cat.peso : 0.3;
  let mOc = info.cat ? info.cat.nome : 'Atividade fora da tabela';
  if (!info.cat && e.moci) {
    // Sem CNAE: usa o porte da edificação cadastrado no MOCI
    const d = e.moci;
    const grande = (d.area || 0) >= 750, alta = (d.altura || 0) >= 12 || (d.pavimentos || 0) >= 4;
    fOc = Math.min(1, 0.5 + (grande ? 0.25 : 0) + (alta ? 0.25 : 0) + (d.caldeira ? 0.15 : 0));
    mOc = [grande ? `Edificação de ${Math.round(d.area).toLocaleString('pt-BR')} m²` : 'Edificação cadastrada no MOCI', alta ? 'de maior altura' : null, d.caldeira ? 'com caldeira' : null].filter(Boolean).join(', ');
    info.desc = 'Edificação cadastrada no MOCI';
  }
  partes.push({ criterio: 'Ocupação', pontos: pesos.ocupacao * fOc, max: pesos.ocupacao, motivo: mOc });

  // 2. Situação documental conhecida
  let fDoc = 0, mDoc = '';
  const sit = e.situacao_doc || 'desconhecida';
  const vencMoci = e.moci?.situacao === 'vencido' && e.moci.validade;
  if (sit === 'vencido') { fDoc = 1; mDoc = vencMoci ? `AVCB vencido há ${diffDays(hoje, e.moci.validade)} dias (MOCI)` : 'Documento vencido'; }
  else if (sit === 'sem_documento') { fDoc = 0.95; mDoc = e.moci ? 'Sem AVCB no MOCI' : 'Sem documento em campo'; }
  else if (sit === 'desconhecida') { fDoc = 0.9; mDoc = 'Sem registro conhecido no CBMPE'; }
  else if (sit === 'valido' && e.validade_doc && diffDays(e.validade_doc, hoje) < 0) { fDoc = 0.85; mDoc = 'Validade expirou'; }
  else if (sit === 'valido' && e.validade_doc && diffDays(e.validade_doc, hoje) <= 60) { fDoc = 0.4; mDoc = 'Documento vence em até 60 dias'; }
  else if (sit === 'em_andamento') { fDoc = 0.3; mDoc = 'Processo em andamento'; }
  else { fDoc = 0; mDoc = sit === 'isento' ? 'Isento' : 'Documento válido'; }
  partes.push({ criterio: 'Documentação', pontos: pesos.documental * fDoc, max: pesos.documental, motivo: mDoc });

  // 3. Histórico de exigências
  const n = e.notificacoes || 0;
  const grave = ['auto_infracao', 'interditado'].includes(e.ultimo_resultado);
  const fHist = grave ? 1 : n >= 2 ? 1 : n === 1 ? 0.6 : 0;
  partes.push({ criterio: 'Histórico', pontos: pesos.historico * fHist, max: pesos.historico, motivo: grave ? 'Último resultado com auto ou interdição' : n ? `${n} notificação(ões) anterior(es)` : 'Sem exigências registradas' });

  // 4. Concentração e exposição (vizinhos num raio de 250 m)
  const viz = ctx.vizinhos ? ctx.vizinhos(e) : 0;
  const fExp = Math.min(1, viz / 6) * (info.categoria === 'publico' ? 1 : 0.85) + (info.categoria === 'publico' ? 0.15 : 0);
  partes.push({ criterio: 'Exposição', pontos: pesos.exposicao * Math.min(1, fExp), max: pesos.exposicao, motivo: `${viz} estabelecimento(s) num raio de 250 m` });

  // 5. Tempo desde a última fiscalização
  let fT = 1, mT = 'Nunca fiscalizado';
  if (e.ultima_fiscalizacao) {
    const d = diffDays(hoje, e.ultima_fiscalizacao);
    fT = d > 730 ? 0.8 : d > 365 ? 0.5 : d > 180 ? 0.2 : 0;
    mT = d > 365 ? `Última fiscalização há ${Math.floor(d / 365)} ano(s)` : `Fiscalizado há ${d} dias`;
  }
  partes.push({ criterio: 'Tempo', pontos: pesos.tempo * fT, max: pesos.tempo, motivo: mT });

  if (e.abertura && diffDays(hoje, e.abertura) <= 60) tags.push('CNPJ novo');
  if (info.categoria === 'agro') tags.push('Agroindústria');
  if (e.moci) tags.push('MOCI');
  if (sit === 'vencido') tags.push('AVCB vencido');

  const total = partes.reduce((a, p) => a + p.pontos, 0);
  const max = partes.reduce((a, p) => a + p.max, 0) || 100;
  return { score: Math.round((total / max) * 100), partes, tags, info };
}

// Contagem de vizinhos num raio de 250 m, com grade espacial (rápido mesmo com milhares de pontos).
let cacheViz = { chave: '', mapa: new Map() };
export function contextoScore(state) {
  const base = state.estabelecimentos.filter((e) => e.ativo !== false);
  const chave = `${base.length}:${base[0]?.id}:${base[base.length - 1]?.id}`;
  if (cacheViz.chave !== chave) {
    const passo = 0.0025; // ~275 m
    const grade = new Map();
    const cel = (lat, lng) => `${Math.floor(lat / passo)}:${Math.floor(lng / passo)}`;
    for (const e of base) { const k = cel(e.lat, e.lng); if (!grade.has(k)) grade.set(k, []); grade.get(k).push(e); }
    const mapa = new Map();
    for (const e of base) {
      const gi = Math.floor(e.lat / passo), gj = Math.floor(e.lng / passo);
      let n = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (const o of grade.get(`${gi + a}:${gj + b}`) || []) if (o !== e && dist(o, e) <= 250) n++;
      }
      mapa.set(e.id, n);
    }
    cacheViz = { chave, mapa };
  }
  return { config: state.config, vizinhos: (e) => cacheViz.mapa.get(e.id) || 0 };
}

// Lista de sugestões para o painel do oficial.
export function gerarSugestoes(state) {
  const ctx = contextoScore(state);
  const hoje = today();
  const comMissaoAberta = new Set(state.missoes.filter((m) => ABERTOS.includes(m.status)).map((m) => m.estab_id));
  const pedidos = new Set((state.solicitacoes || []).filter((q) => q.status === 'pendente').map((q) => q.estab_id));
  const lim = state.config.limite_sugestao ?? 45;
  const out = [];
  for (const e of state.estabelecimentos) {
    if (comMissaoAberta.has(e.id)) continue;
    if (e.ativo === false) continue;
    if (e.ultima_fiscalizacao && diffDays(hoje, e.ultima_fiscalizacao) < 90) continue; // recém-fiscalizado: o acompanhamento segue pelo retorno
    const dec = state.decisoes[e.id];
    if (dec) {
      if (dec.status === 'aceita') continue;
      if (dec.status === 'rejeitada') {
        const volta = dec.motivo === 'depois' ? 30 : dec.motivo === 'ja_regular' || dec.motivo === 'isento' ? 365 : 9999;
        if (diffDays(hoje, dec.data) < volta) continue;
      }
    }
    const p = pontuar(e, ctx);
    if (p.score < lim) continue;
    out.push({ estab: e, ...p, pedido: pedidos.has(e.id) });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export function scoreDe(state, e) { return pontuar(e, contextoScore(state)); }

export function semanaComEventoGrande(state, limitePublico = 3000) {
  const hoje = today(), fim = addDays(hoje, 7);
  return (state.eventos || []).find((ev) => ev.publico >= limitePublico && ev.inicio <= fim && (ev.fim || ev.inicio) >= hoje) || null;
}

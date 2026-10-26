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
  const fOc = info.cat ? info.cat.peso : 0.3;
  partes.push({ criterio: 'Ocupação', pontos: pesos.ocupacao * fOc, max: pesos.ocupacao, motivo: info.cat ? info.cat.nome : 'Atividade fora da tabela' });

  // 2. Situação documental conhecida
  let fDoc = 0, mDoc = '';
  const sit = e.situacao_doc || 'desconhecida';
  if (sit === 'desconhecida') { fDoc = 1; mDoc = 'Sem registro conhecido no CBMPE'; }
  else if (sit === 'sem_documento') { fDoc = 1; mDoc = 'Sem documento em campo'; }
  else if (sit === 'vencido') { fDoc = 0.85; mDoc = 'Documento vencido'; }
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

  const total = partes.reduce((a, p) => a + p.pontos, 0);
  const max = partes.reduce((a, p) => a + p.max, 0) || 100;
  return { score: Math.round((total / max) * 100), partes, tags, info };
}

export function contextoScore(state) {
  const base = state.estabelecimentos;
  const cache = new Map();
  return {
    config: state.config,
    vizinhos: (e) => {
      if (cache.has(e.id)) return cache.get(e.id);
      let n = 0;
      for (const o of base) if (o.id !== e.id && Math.abs(o.lat - e.lat) < 0.003 && Math.abs(o.lng - e.lng) < 0.003 && dist(o, e) <= 250) n++;
      cache.set(e.id, n);
      return n;
    },
  };
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

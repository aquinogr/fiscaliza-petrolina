// Estado da aplicação e operações de negócio.
// Modo demonstração: tudo fica no localStorage deste aparelho.
// Quando o Supabase for ligado, o mesmo conjunto de operações passa a enviar a "fila de envio" (outbox) ao servidor.
import { gerarDemo } from './seed.js';
import { today, addDays, fmtDate } from './ui.js';
import { ordenarRota, setorDe, dist } from './geo.js';
import { aplicarResultado, RESULTADOS_COM_EXIGENCIA } from './dominio.js';

const KEY = 'fiscaliza-petrolina:v1';
let state = null;
const subs = new Set();

export function carregar() {
  try { state = JSON.parse(localStorage.getItem(KEY)); } catch { state = null; }
  if (!state || state.versao !== 1) { state = gerarDemo(); gravar(); }
  return state;
}
export const S = () => state;

function gravar() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.error('Falha ao gravar', e); }
}
export function salvar() { gravar(); emit(); }
export function on(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit() { subs.forEach((f) => { try { f(state); } catch (e) { console.error(e); } }); }

// Outra aba do mesmo aparelho alterou os dados (ex.: oficial numa aba, vistoriador na outra)
window.addEventListener('storage', (e) => {
  if (e.key === KEY && e.newValue) { try { state = JSON.parse(e.newValue); emit(); } catch { /* ignora */ } }
});

export function resetDemo() { state = gerarDemo(); salvar(); }
export function exportarJSON() { return JSON.stringify(state, null, 2); }
export function importarJSON(txt) {
  const js = JSON.parse(txt);
  if (!js || js.versao !== 1 || !Array.isArray(js.missoes)) throw new Error('Arquivo não reconhecido.');
  state = js; salvar();
}

export const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------- fila de envio ----------
function registrar(acao, ref, autor) {
  state.outbox.push({ id: uid('o'), ts: Date.now(), acao, ref, autor: autor || 'oficial', enviado: false });
  if (state.outbox.length > 500) state.outbox = state.outbox.slice(-500);
}
export function pendentesEnvio(autor) { return state.outbox.filter((o) => !o.enviado && (!autor || o.autor === autor)).length; }
export function sincronizar() {
  if (!navigator.onLine) return 0;
  let n = 0;
  state.outbox.forEach((o) => { if (!o.enviado) { o.enviado = true; o.enviado_em = Date.now(); n++; } });
  if (n) salvar();
  return n;
}

// ---------- sessão ----------
const SK = 'fiscaliza-petrolina:perfil';
export function sessao() {
  try { return JSON.parse(sessionStorage.getItem(SK) || localStorage.getItem(SK)); } catch { return null; }
}
export function definirSessao(s) {
  if (s) { sessionStorage.setItem(SK, JSON.stringify(s)); localStorage.setItem(SK, JSON.stringify(s)); }
  else { sessionStorage.removeItem(SK); localStorage.removeItem(SK); }
}

// ---------- consultas ----------
export const estab = (id) => state.estabelecimentos.find((e) => e.id === id);
export const vist = (id) => state.vistoriadores.find((v) => v.id === id);
export const setor = (id) => state.setores.find((s) => s.id === id);
export const missao = (id) => state.missoes.find((m) => m.id === id);
export const local = (id) => state.locais.find((l) => l.id === id);
export const setorDoPonto = (p) => setorDe(p, state.setores);
export function missoesDo(vid, data) {
  return state.missoes.filter((m) => m.vistoriador_id === vid && m.data === data).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}
export function missoesDoDia(data) { return state.missoes.filter((m) => m.data === data && m.vistoriador_id); }
export function fila() { return state.missoes.filter((m) => !m.vistoriador_id && m.status === 'pendente'); }
export function escalaDo(data) { return state.escala[data] || {}; }
export function historico(estabId) {
  return state.missoes.filter((m) => m.estab_id === estabId && m.checkout).sort((a, b) => (b.checkout.ts || 0) - (a.checkout.ts || 0));
}
export function pontoMissao(m) { const e = estab(m.estab_id); return e ? { lat: e.lat, lng: e.lng } : null; }

// ---------- operações do oficial ----------
export function novoEstabelecimento(d) {
  const e = { id: uid('e'), cnpj: d.cnpj || '', nome: d.nome, cnae: d.cnae || '', endereco: d.endereco || '', bairro: d.bairro || '', lat: d.lat, lng: d.lng, abertura: null, origem: 'manual', situacao_doc: 'desconhecida', validade_doc: null, ultima_fiscalizacao: null, notificacoes: 0, ultimo_resultado: null };
  state.estabelecimentos.push(e);
  return e;
}

export function criarMissao(d) {
  const m = {
    id: uid('m'), estab_id: d.estab_id, tipo: d.tipo || 'regularizacao', prioridade: d.prioridade || 'media', status: 'pendente',
    data: d.vistoriador_id ? (d.data || today()) : null, vistoriador_id: d.vistoriador_id || null, ordem: 0,
    processo: d.processo || null, prazo: d.prazo || null, notas: d.notas || '', origem: d.origem || 'manual',
    criado_em: today(), checkin: null, checkout: null, evento_id: d.evento_id || null,
  };
  if (m.vistoriador_id) m.ordem = missoesDo(m.vistoriador_id, m.data).length + 1;
  state.missoes.push(m);
  registrar('criar_missao', m.id);
  salvar();
  return m;
}

export function editarMissao(id, campos) {
  const m = missao(id); if (!m) return;
  const mudouDono = ('vistoriador_id' in campos && campos.vistoriador_id !== m.vistoriador_id) || ('data' in campos && campos.data !== m.data);
  Object.assign(m, campos);
  if (!m.vistoriador_id) { m.data = null; m.ordem = 0; }
  else if (mudouDono) { m.data = m.data || today(); m.ordem = missoesDo(m.vistoriador_id, m.data).filter((x) => x.id !== m.id).length + 1; }
  registrar('editar_missao', id); salvar();
}

export function excluirMissao(id) {
  state.missoes = state.missoes.filter((m) => m.id !== id);
  registrar('excluir_missao', id); salvar();
}

export function atribuir(id, vid, data) { editarMissao(id, { vistoriador_id: vid || null, data: vid ? (data || today()) : null }); }

export function reordenarRota(vid, data) {
  const lista = missoesDo(vid, data);
  const feitas = lista.filter((m) => m.status !== 'pendente');
  const abertas = lista.filter((m) => m.status === 'pendente');
  const ultimaFeita = feitas.length ? pontoMissao(feitas[feitas.length - 1]) : null;
  const inicio = ultimaFeita || state.config.base;
  const pts = abertas.map((m) => ({ ...pontoMissao(m), m }));
  const ord = ordenarRota(inicio, pts);
  feitas.forEach((m, i) => { m.ordem = i + 1; });
  ord.forEach((p, i) => { p.m.ordem = feitas.length + i + 1; });
  registrar('reordenar', `${vid}:${data}`); salvar();
}

export function definirEscala(data, setorId, vid) {
  state.escala[data] = state.escala[data] || {};
  if (vid) state.escala[data][setorId] = vid; else delete state.escala[data][setorId];
  registrar('escala', `${data}:${setorId}`); salvar();
}

const PESO_PRIORIDADE = { alta: 0, media: 1, baixa: 2 };
function ordenarFila(lista) {
  return lista.slice().sort((a, b) =>
    (PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade]) ||
    String(a.prazo || '9999').localeCompare(String(b.prazo || '9999')) ||
    String(a.criado_em).localeCompare(String(b.criado_em)));
}
export function filaOrdenada() { return ordenarFila(fila()); }

// Atribui a fila de um setor ao vistoriador escalado nele, até a capacidade do dia.
export function atribuirFilaDoSetor(setorId, data) {
  const vid = escalaDo(data)[setorId];
  if (!vid) return 0;
  const s = setor(setorId);
  const cap = state.config.capacidade_dia || 7;
  let ocupadas = missoesDo(vid, data).length;
  let n = 0;
  for (const m of ordenarFila(fila())) {
    if (ocupadas >= cap) break;
    const p = pontoMissao(m);
    if (!p || setorDe(p, [s])?.id !== setorId) continue;
    m.vistoriador_id = vid; m.data = data; m.ordem = ++ocupadas; n++;
  }
  if (n) { registrar('distribuir_setor', `${data}:${setorId}`); salvar(); reordenarRota(vid, data); }
  return n;
}

export function distribuirAutomatico(data) {
  let total = 0;
  for (const sid of Object.keys(escalaDo(data))) total += atribuirFilaDoSetor(sid, data);
  return total;
}

// ---------- sugestões ----------
export function aceitarSugestao(estabId, vid, data, score) {
  state.decisoes[estabId] = { status: 'aceita', data: today(), score };
  return criarMissao({ estab_id: estabId, tipo: 'fiscalizacao', origem: 'sugestao', vistoriador_id: vid || null, data, prioridade: score >= 75 ? 'alta' : 'media', notas: 'Fiscalização a partir de sugestão automática.' });
}
export function rejeitarSugestao(estabId, motivo) {
  const e = estab(estabId);
  state.decisoes[estabId] = { status: 'rejeitada', motivo, data: today() };
  if (e) {
    if (motivo === 'ja_regular' && e.situacao_doc !== 'valido') { e.situacao_doc = 'valido'; e.validade_doc = null; }
    if (motivo === 'isento') e.situacao_doc = 'isento';
    if (motivo === 'fechado') e.ativo = false;
  }
  registrar('rejeitar_sugestao', estabId); salvar();
}

// ---------- encaixes e correções ----------
export function pedirEncaixe(estabId, vid, obs) {
  if (state.solicitacoes.some((q) => q.estab_id === estabId && q.status === 'pendente')) return null;
  const q = { id: uid('q'), estab_id: estabId, vistoriador_id: vid, data: today(), ts: Date.now(), status: 'pendente', obs: obs || '' };
  state.solicitacoes.push(q);
  registrar('pedir_encaixe', q.id, vid); salvar();
  return q;
}
export function decidirEncaixe(qid, aprovar) {
  const q = state.solicitacoes.find((x) => x.id === qid); if (!q) return;
  q.status = aprovar ? 'aprovado' : 'recusado';
  q.decidido_em = Date.now();
  if (aprovar) {
    state.decisoes[q.estab_id] = { status: 'aceita', data: today() };
    const m = criarMissao({ estab_id: q.estab_id, tipo: 'encaixe', origem: 'encaixe', vistoriador_id: q.vistoriador_id, data: q.data, prioridade: 'media', notas: q.obs ? `Pedido em campo: ${q.obs}` : 'Encaixe pedido em campo.' });
    q.missao_id = m.id;
  }
  registrar('decidir_encaixe', qid); salvar();
}
export function decidirCorrecao(cid, aprovar) {
  const c = state.correcoes.find((x) => x.id === cid); if (!c) return;
  c.status = aprovar ? 'aprovada' : 'recusada';
  if (aprovar) { const e = estab(c.estab_id); if (e) { e.lat = c.lat; e.lng = c.lng; e.geo_corrigido = true; } }
  registrar('decidir_correcao', cid); salvar();
}

// ---------- operações do vistoriador ----------
export function fazerCheckin(id, pos, { justificativa, corrigir } = {}) {
  const m = missao(id); if (!m) return null;
  const alvo = pontoMissao(m);
  const d = Math.round(dist(pos, alvo));
  const dentro = d <= (state.config.raio_checkin || 150);
  m.status = 'no_local';
  m.checkin = { ts: Date.now(), lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), precisao: Math.round(pos.precisao || 0), distancia: d, dentro, justificativa: justificativa || null, simulado: !!pos.simulado };
  if (!dentro && corrigir) state.correcoes.push({ id: uid('c'), estab_id: m.estab_id, missao_id: m.id, lat: m.checkin.lat, lng: m.checkin.lng, vistoriador_id: m.vistoriador_id, ts: Date.now(), status: 'pendente' });
  registrar('checkin', id, m.vistoriador_id); salvar();
  return m.checkin;
}
export function desfazerCheckin(id) {
  const m = missao(id); if (!m || m.status !== 'no_local') return;
  m.status = 'pendente'; m.checkin = null;
  state.correcoes = state.correcoes.filter((c) => !(c.missao_id === id && c.status === 'pendente'));
  registrar('desfazer_checkin', id, m.vistoriador_id); salvar();
}
export function fazerCheckout(id, saida) {
  const m = missao(id); if (!m) return null;
  m.status = 'concluida';
  m.checkout = { ts: Date.now(), ...saida };
  const e = estab(m.estab_id);
  aplicarResultado(e, m.checkout, m.data || today());
  let retorno = null;
  if (RESULTADOS_COM_EXIGENCIA.includes(saida.resultado) && state.config.prazo_retorno_dias) {
    const prazo = addDays(m.data || today(), state.config.prazo_retorno_dias);
    retorno = { id: uid('m'), estab_id: m.estab_id, tipo: 'retorno', prioridade: 'alta', status: 'pendente', data: null, vistoriador_id: null, ordem: 0, processo: m.processo, prazo, notas: `Retorno automático: ${saida.resultado === 'notificado' ? 'notificação' : 'exigência'} de ${fmtDate(m.data || today())}.`, origem: 'automatico', criado_em: today(), checkin: null, checkout: null };
    state.missoes.push(retorno);
  }
  registrar('checkout', id, m.vistoriador_id); salvar();
  return { missao: m, retorno };
}
export function marcarNaoRealizada(id, motivo) {
  const m = missao(id); if (!m) return;
  m.status = 'nao_realizada';
  m.checkout = { ts: Date.now(), resultado: null, motivo };
  registrar('nao_realizada', id, m.vistoriador_id); salvar();
}
export function devolverParaFila(id) {
  const m = missao(id); if (!m) return;
  Object.assign(m, { status: 'pendente', vistoriador_id: null, data: null, ordem: 0, checkin: null, checkout: null });
  registrar('devolver_fila', id); salvar();
}

// ---------- eventos ----------
export function salvarEvento(ev) {
  if (!ev.id) { ev.id = uid('ev'); state.eventos.push(ev); }
  else Object.assign(state.eventos.find((x) => x.id === ev.id), ev);
  registrar('evento', ev.id); salvar();
  return ev;
}
export function excluirEvento(id) { state.eventos = state.eventos.filter((e) => e.id !== id); registrar('excluir_evento', id); salvar(); }
export function salvarLocal(l) {
  if (!l.id) { l.id = uid('l'); state.locais.push(l); }
  else Object.assign(state.locais.find((x) => x.id === l.id), l);
  registrar('local', l.id); salvar();
  return l;
}

// ---------- ajustes ----------
export function salvarConfig(campos) { Object.assign(state.config, campos); registrar('config', null); salvar(); }
export function salvarSetor(s) {
  if (!s.id) { s.id = uid('s'); state.setores.push(s); }
  else Object.assign(setor(s.id), s);
  registrar('setor', s.id); salvar();
  return s;
}
export function excluirSetor(id) {
  state.setores = state.setores.filter((s) => s.id !== id);
  for (const d of Object.keys(state.escala)) delete state.escala[d][id];
  registrar('excluir_setor', id); salvar();
}
export function salvarVistoriador(v) {
  if (!v.id) { v.id = uid('v'); state.vistoriadores.push(v); }
  else Object.assign(vist(v.id), v);
  registrar('vistoriador', v.id); salvar();
  return v;
}
export function importarEstabelecimentos(lista) {
  // lista: [{cnpj, nome, cnae, endereco, bairro, lat, lng, abertura}]
  let novos = 0, atual = 0;
  const porCnpj = new Map(state.estabelecimentos.filter((e) => e.cnpj).map((e) => [e.cnpj, e]));
  for (const x of lista) {
    if (!x || !isFinite(x.lat) || !isFinite(x.lng)) continue;
    const ja = x.cnpj && porCnpj.get(x.cnpj);
    if (ja) { Object.assign(ja, { nome: x.nome || ja.nome, cnae: x.cnae || ja.cnae, endereco: x.endereco || ja.endereco, bairro: x.bairro || ja.bairro, abertura: x.abertura || ja.abertura, ativo: true }); if (!ja.geo_corrigido) { ja.lat = x.lat; ja.lng = x.lng; } atual++; }
    else { const e = novoEstabelecimento(x); e.origem = 'receita'; e.abertura = x.abertura || null; novos++; }
  }
  registrar('importar_base', `${novos}/${atual}`); salvar();
  return { novos, atual };
}

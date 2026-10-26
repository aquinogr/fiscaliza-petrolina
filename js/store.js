// Estado da aplicação e operações de negócio.
// Por enquanto tudo fica no localStorage deste aparelho; o roteiro vai ao celular do vistoriador por link
// e os resultados voltam pelo mesmo caminho. A base pública (Receita + IBGE) é lida do próprio site a cada abertura
// e só os estabelecimentos com alguma informação de campo são gravados no aparelho.
// Quando o Supabase for ligado, o mesmo conjunto de operações passa a enviar a "fila de envio" (outbox) ao servidor.
import { estadoInicial, VERSAO_ESTADO } from './seed.js';
import { today, addDays, fmtDate } from './ui.js';
import { ordenarRota, setorDe, dist } from './geo.js';
import { aplicarResultado, RESULTADOS_COM_EXIGENCIA } from './dominio.js';
import { converterPonto, cidadeAceita, nomesParecidos, MOCI_URL_PADRAO } from './moci.js';

const KEY = 'fiscaliza-petrolina:dados';
let state = null;
let rev = 0;
let basePublica = null; // { metadata, features }
const subs = new Set();

export function carregar() {
  try { state = JSON.parse(localStorage.getItem(KEY)); } catch { state = null; }
  if (!state || state.versao !== VERSAO_ESTADO) { state = estadoInicial(); gravar(); }
  try { localStorage.removeItem('fiscaliza-petrolina:v1'); } catch { /* dados de teste antigos */ }
  return state;
}
export const S = () => state;
export const revisao = () => rev;

function paraGravar() {
  const ref = new Set();
  state.missoes.forEach((m) => ref.add(m.estab_id));
  state.solicitacoes.forEach((q) => ref.add(q.estab_id));
  state.correcoes.forEach((c) => ref.add(c.estab_id));
  state.locais.forEach((l) => l.estab_id && ref.add(l.estab_id));
  Object.keys(state.decisoes).forEach((id) => ref.add(id));
  const guardar = (e) => e.origem !== 'receita' || ref.has(e.id) || e.moci_id || e.ultima_fiscalizacao || e.notificacoes || e.geo_corrigido || (e.situacao_doc && e.situacao_doc !== 'desconhecida');
  return JSON.stringify({ ...state, estabelecimentos: state.estabelecimentos.filter(guardar) });
}
function gravar() {
  try { localStorage.setItem(KEY, paraGravar()); }
  catch (e) { console.error('Falha ao gravar', e); }
}
export function salvar() { gravar(); emit(); }
export function on(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit() { rev++; subs.forEach((f) => { try { f(state); } catch (e) { console.error(e); } }); }

// Outra aba do mesmo aparelho alterou os dados (ex.: oficial numa aba, vistoriador na outra)
window.addEventListener('storage', (e) => {
  if (e.key === KEY && e.newValue) { try { state = JSON.parse(e.newValue); mesclarBase(); emit(); } catch { /* ignora */ } }
});

export function apagarTudo() { state = estadoInicial(); mesclarBase(); salvar(); }
export function exportarJSON() { return paraGravar(); }
export function importarJSON(txt) {
  const js = JSON.parse(txt);
  if (!js || js.versao !== VERSAO_ESTADO || !Array.isArray(js.missoes)) throw new Error('Arquivo não reconhecido.');
  state = js; mesclarBase(); salvar();
}

// ---------- base pública (Receita Federal + IBGE), publicada pela rotina mensal ----------
export function definirBasePublica(gj) {
  basePublica = { metadata: gj.metadata || {}, features: Array.isArray(gj.features) ? gj.features : [] };
  mesclarBase();
  emit();
  return basePublica.features.length;
}
export function infoBasePublica() { return basePublica ? { total: basePublica.features.length, ...basePublica.metadata } : null; }
function mesclarBase() {
  if (!basePublica || !state) return;
  const porId = new Map(state.estabelecimentos.map((e) => [e.id, e]));
  const vistos = new Set();
  for (const f of basePublica.features) {
    const p = f.properties || {};
    const [lng, lat] = f.geometry?.coordinates || [];
    if (!p.cnpj || !isFinite(lat) || !isFinite(lng)) continue;
    const id = `r${p.cnpj}`;
    vistos.add(id);
    const pub = { cnpj: p.cnpj, nome: p.nome, cnae: p.cnae, endereco: p.endereco || '', bairro: p.bairro || '', abertura: p.abertura || null, geo_precisao: p.geo_precisao || null };
    const e = porId.get(id);
    if (e) {
      Object.assign(e, pub);
      if (!e.geo_corrigido) { e.lat = lat; e.lng = lng; }
      if (e.inativo_por === 'receita') { e.ativo = true; delete e.inativo_por; }
    } else {
      state.estabelecimentos.push({ id, origem: 'receita', ...pub, lat, lng, situacao_doc: 'desconhecida', validade_doc: null, ultima_fiscalizacao: null, notificacoes: 0, ultimo_resultado: null });
    }
  }
  for (const e of state.estabelecimentos) {
    if (e.origem === 'receita' && !vistos.has(e.id) && e.ativo !== false) { e.ativo = false; e.inativo_por = 'receita'; }
  }
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
let idxEstab = null, idxRev = -1, idxLen = -1;
export function estab(id) {
  if (!idxEstab || idxRev !== rev || idxLen !== state.estabelecimentos.length) {
    idxEstab = new Map(state.estabelecimentos.map((e) => [e.id, e])); idxRev = rev; idxLen = state.estabelecimentos.length;
  }
  return idxEstab.get(id) || state.estabelecimentos.find((e) => e.id === id);
}
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
// Dentro da mesma prioridade: o prazo mais próximo primeiro; para AVCB vencido, quem venceu há mais tempo.
const chaveData = (m) => String(m.prazo || m.ref_data || '9999');
function ordenarFila(lista) {
  return lista.slice().sort((a, b) =>
    (PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade]) ||
    chaveData(a).localeCompare(chaveData(b)) ||
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
  const r = concluirMissao(m, { ts: Date.now(), ...saida });
  registrar('checkout', id, m.vistoriador_id); salvar();
  return r;
}
function concluirMissao(m, checkout) {
  const saida = checkout;
  m.status = 'concluida';
  m.checkout = checkout;
  const e = estab(m.estab_id);
  aplicarResultado(e, m.checkout, m.data || today());
  let retorno = null;
  if (RESULTADOS_COM_EXIGENCIA.includes(saida.resultado) && state.config.prazo_retorno_dias) {
    const prazo = addDays(m.data || today(), state.config.prazo_retorno_dias);
    retorno = { id: uid('m'), estab_id: m.estab_id, tipo: 'retorno', prioridade: 'alta', status: 'pendente', data: null, vistoriador_id: null, ordem: 0, processo: m.processo, prazo, notas: `Retorno automático: ${saida.resultado === 'notificado' ? 'notificação' : 'exigência'} de ${fmtDate(m.data || today())}.`, origem: 'automatico', criado_em: today(), checkin: null, checkout: null };
    state.missoes.push(retorno);
  }
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

// ---------- MOCI ----------
export function configMoci() {
  const c = state.config;
  return { url: c.moci_url || MOCI_URL_PADRAO, cidades: c.moci_cidades ?? 'Petrolina', sync: c.moci_sync || null };
}

// Recebe os pontos crus do MOCI e atualiza a base. Só lê o MOCI; nada volta para lá.
export function importarMoci(pontos) {
  const hoje = today();
  const { cidades } = configMoci();
  const stats = { recebidos: pontos.length, importados: 0, novos: 0, ligados: 0, vencidos: 0, sem_avcb: 0, outras_cidades: 0, vencidos_outras: 0 };
  const vistos = new Set();
  const porMoci = new Map(state.estabelecimentos.filter((e) => e.moci_id).map((e) => [e.moci_id, e]));
  for (const bruto of pontos) {
    const p = converterPonto(bruto, hoje);
    if (!p) continue;
    if (!cidadeAceita(p.cidade, cidades)) {
      stats.outras_cidades++;
      if (p.situacao === 'vencido') stats.vencidos_outras++;
      continue;
    }
    vistos.add(p.moci_id);
    let e = porMoci.get(p.moci_id);
    if (!e) {
      // Liga ao CNPJ já existente se estiver a até 60 m e com nome parecido
      e = state.estabelecimentos.find((x) => !x.moci_id && dist(x, p) <= 60 && nomesParecidos(x.nome, p.nome));
      if (e) stats.ligados++;
    }
    const anterior = e?.moci?.situacao;
    if (!e) {
      e = { id: uid('e'), cnpj: '', nome: p.nome, cnae: '', endereco: p.endereco, bairro: p.bairro, lat: p.lat, lng: p.lng, abertura: null, origem: 'moci', situacao_doc: 'desconhecida', validade_doc: null, ultima_fiscalizacao: null, notificacoes: 0, ultimo_resultado: null };
      state.estabelecimentos.push(e);
      stats.novos++;
    }
    e.moci_id = p.moci_id;
    e.moci = { ...p.dados, situacao: p.situacao, validade: p.validade, cidade: p.cidade, removido: false };
    if (e.origem === 'moci') {
      Object.assign(e, { nome: p.nome, endereco: p.endereco || e.endereco, bairro: p.bairro || e.bairro, ativo: true });
      if (!e.geo_corrigido) { e.lat = p.lat; e.lng = p.lng; }
    }
    // A situação do MOCI só sobrescreve quando muda lá (preserva o que a equipe registrou em campo depois)
    if (p.situacao !== anterior) {
      e.situacao_doc = p.situacao === 'vencido' ? 'vencido' : p.situacao;
      e.validade_doc = p.situacao === 'valido' ? p.validade : null;
    }
    if (p.situacao === 'vencido') stats.vencidos++;
    if (p.situacao === 'sem_documento') stats.sem_avcb++;
    stats.importados++;
  }
  // Pontos apagados no MOCI
  for (const e of state.estabelecimentos) {
    if (e.moci_id && e.moci && !vistos.has(e.moci_id) && cidadeAceita(e.moci.cidade, cidades)) {
      e.moci.removido = true;
      if (e.origem === 'moci') e.ativo = false;
    }
  }
  state.config.moci_sync = { ts: Date.now(), ...stats };
  registrar('importar_moci', `${stats.importados}`); salvar();
  return stats;
}

export function vencidosMoci({ incluirSemAvcb = false } = {}) {
  const abertas = new Set(state.missoes.filter((m) => ['pendente', 'no_local'].includes(m.status)).map((m) => m.estab_id));
  return state.estabelecimentos.filter((e) => e.moci && !e.moci.removido && e.ativo !== false && !abertas.has(e.id) &&
    (e.situacao_doc === 'vencido' || (incluirSemAvcb && e.situacao_doc === 'sem_documento')))
    .sort((a, b) => String(a.moci.validade || '0000').localeCompare(String(b.moci.validade || '0000')));
}

// Coloca na fila uma missão para cada AVCB vencido (e, se pedido, sem AVCB) que ainda não tem missão aberta.
export function filaDeVencidos({ incluirSemAvcb = false } = {}) {
  const lista = vencidosMoci({ incluirSemAvcb });
  for (const e of lista) {
    const venc = e.situacao_doc === 'vencido';
    state.missoes.push({
      id: uid('m'), estab_id: e.id, tipo: 'avcb_vencido', prioridade: venc ? 'alta' : 'media', status: 'pendente',
      data: null, vistoriador_id: null, ordem: 0, processo: null, prazo: null, ref_data: e.moci?.validade || null,
      notas: venc ? `AVCB vencido desde ${fmtDate(e.moci?.validade)}, segundo o MOCI. Conferir a situação e notificar se continuar irregular.` : 'Edificação sem AVCB no MOCI. Conferir a situação.',
      origem: 'moci', criado_em: today(), checkin: null, checkout: null,
    });
  }
  if (lista.length) { registrar('fila_vencidos', String(lista.length)); salvar(); }
  return lista.length;
}

// ---------- equipe do dia ----------
export function equipeDo(data) {
  const ativos = state.vistoriadores.filter((v) => v.ativo !== false).map((v) => v.id);
  const salvo = state.equipe_dia?.[data];
  return salvo ? salvo.filter((id) => ativos.includes(id)) : ativos;
}
export function alternarEquipe(data, vid) {
  state.equipe_dia = state.equipe_dia || {};
  const atual = equipeDo(data);
  state.equipe_dia[data] = atual.includes(vid) ? atual.filter((x) => x !== vid) : [...atual, vid];
  registrar('equipe_dia', `${data}:${vid}`); salvar();
}

// ---------- distribuição por proximidade (não precisa de setores) ----------
// Pega a fila por ordem de prioridade, até encher as vagas da equipe do dia, e divide em grupos geográficos
// (um por vistoriador) com limite de missões por pessoa. Depois ordena cada roteiro pela menor distância.
export function distribuirPorProximidade(data) {
  const cap = state.config.capacidade_dia || 7;
  const equipe = equipeDo(data).map((vid) => {
    const atuais = missoesDo(vid, data);
    const pts = atuais.map(pontoMissao).filter(Boolean);
    return { vid, vagas: Math.max(0, cap - atuais.length), ancora: pts.length ? { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length } : null };
  }).filter((x) => x.vagas > 0);
  if (!equipe.length) return 0;
  const vagas = equipe.reduce((a, x) => a + x.vagas, 0);
  const cand = ordenarFila(fila()).map((m) => ({ m, p: pontoMissao(m) })).filter((x) => x.p).slice(0, vagas);
  if (!cand.length) return 0;
  // centros iniciais: onde a pessoa já tem missões; senão, os pontos mais afastados entre si
  const centros = [];
  for (const q of equipe) if (q.ancora) centros.push({ ...q.ancora });
  while (centros.length < equipe.length) {
    let melhor = cand[0].p, bd = -1;
    for (const c of cand) {
      const d = centros.length ? Math.min(...centros.map((z) => dist(z, c.p))) : dist(state.config.base, c.p);
      if (d > bd) { bd = d; melhor = c.p; }
    }
    centros.push({ ...melhor });
  }
  let grupo = new Array(cand.length).fill(0);
  for (let it = 0; it < 12; it++) {
    const pares = [];
    cand.forEach((c, i) => centros.forEach((z, k) => pares.push([dist(z, c.p), i, k])));
    pares.sort((a, b) => a[0] - b[0]);
    const usado = new Array(cand.length).fill(false);
    const cheio = equipe.map(() => 0);
    const novo = new Array(cand.length).fill(-1);
    for (const [, i, k] of pares) {
      if (usado[i] || cheio[k] >= equipe[k].vagas) continue;
      usado[i] = true; cheio[k]++; novo[i] = k;
    }
    const mudou = novo.some((k, i) => k !== grupo[i]);
    grupo = novo;
    centros.forEach((z, k) => {
      const membros = cand.filter((_, i) => grupo[i] === k);
      if (!membros.length) return;
      if (equipe[k].ancora) return; // mantém o centro de quem já tem rota
      z.lat = membros.reduce((a, c) => a + c.p.lat, 0) / membros.length;
      z.lng = membros.reduce((a, c) => a + c.p.lng, 0) / membros.length;
    });
    if (!mudou) break;
  }
  let n = 0;
  cand.forEach((c, i) => {
    const q = equipe[grupo[i]]; if (!q) return;
    c.m.vistoriador_id = q.vid; c.m.data = data; c.m.ordem = 999; n++;
  });
  registrar('distribuir_proximidade', data); salvar();
  for (const q of equipe) reordenarRota(q.vid, data);
  return n;
}

// ---------- roteiro por link (sem banco de dados) ----------
const resumoEstab = (e) => e && ({ id: e.id, nome: e.nome, end: e.endereco, b: e.bairro, lat: e.lat, lng: e.lng, cnpj: e.cnpj, cnae: e.cnae, sit: e.situacao_doc, val: e.validade_doc, uf: e.ultima_fiscalizacao, ur: e.ultimo_resultado, moci_id: e.moci_id || null, moci: e.moci || null, origem: e.origem });
function upsertEstab(r) {
  if (!r) return null;
  let e = estab(r.id);
  const campos = { nome: r.nome, endereco: r.end || '', bairro: r.b || '', lat: r.lat, lng: r.lng, cnpj: r.cnpj || '', cnae: r.cnae || '', situacao_doc: r.sit || 'desconhecida', validade_doc: r.val || null, ultima_fiscalizacao: r.uf || null, ultimo_resultado: r.ur || null, moci_id: r.moci_id || undefined, moci: r.moci || undefined };
  if (!e) { e = { id: r.id, origem: r.origem || 'manual', notificacoes: 0, abertura: null, ...campos }; state.estabelecimentos.push(e); }
  else Object.assign(e, Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined)));
  return e;
}

export function montarRoteiro(vid, data) {
  const v = vist(vid);
  return {
    t: 'rota', v: 1, d: data, vid, nome: v?.nome, cor: v?.cor, raio: state.config.raio_checkin, base: state.config.base, emitido: Date.now(),
    ms: missoesDo(vid, data).map((m) => ({ id: m.id, o: m.ordem, t: m.tipo, p: m.prioridade, s: m.status, n: m.notas, pz: m.prazo, pr: m.processo, e: resumoEstab(estab(m.estab_id)) })),
  };
}

export function aplicarRoteiro(r) {
  if (!r || r.t !== 'rota' || !r.vid) throw new Error('Link de roteiro inválido.');
  let v = vist(r.vid);
  if (!v) { v = { id: r.vid, nome: r.nome || 'Vistoriador', cor: r.cor || '#2563EB' }; state.vistoriadores.push(v); }
  else Object.assign(v, { nome: r.nome || v.nome, cor: r.cor || v.cor });
  if (r.raio) state.config.raio_checkin = r.raio;
  if (r.base) state.config.base = r.base;
  const ids = new Set();
  for (const x of r.ms || []) {
    const e = upsertEstab(x.e);
    if (!e) continue;
    ids.add(x.id);
    const m = missao(x.id);
    const dados = { estab_id: e.id, tipo: x.t, prioridade: x.p, notas: x.n || '', prazo: x.pz || null, processo: x.pr || null, ordem: x.o, vistoriador_id: r.vid, data: r.d };
    if (!m) state.missoes.push({ id: x.id, status: 'pendente', origem: 'roteiro', criado_em: today(), checkin: null, checkout: null, ...dados });
    else if (m.status === 'pendente') Object.assign(m, dados);
    else Object.assign(m, { ordem: x.o, notas: x.n || m.notas });
  }
  // missões que o oficial tirou do roteiro e ainda não foram feitas
  state.missoes = state.missoes.filter((m) => !(m.vistoriador_id === r.vid && m.data === r.d && m.status === 'pendente' && !ids.has(m.id)));
  registrar('receber_roteiro', `${r.vid}:${r.d}`, r.vid); salvar();
  return { vid: r.vid, data: r.d, total: ids.size };
}

export function montarRetorno(vid, data) {
  return {
    t: 'retorno', v: 1, d: data, vid, emitido: Date.now(),
    ms: missoesDo(vid, data).filter((m) => m.status !== 'pendente').map((m) => ({
      id: m.id, s: m.status, ci: m.checkin, co: m.checkout ? { ...m.checkout, fotos: (m.checkout.fotos || []).length } : null, e: resumoEstab(estab(m.estab_id)), t: m.tipo,
    })),
    enc: state.solicitacoes.filter((q) => q.vistoriador_id === vid && q.data === data && q.status === 'pendente').map((q) => ({ id: q.id, ts: q.ts, obs: q.obs, e: resumoEstab(estab(q.estab_id)) })),
    cor: state.correcoes.filter((c) => c.vistoriador_id === vid && c.status === 'pendente').map((c) => ({ id: c.id, missao_id: c.missao_id, lat: c.lat, lng: c.lng, ts: c.ts, e: resumoEstab(estab(c.estab_id)) })),
  };
}

export function aplicarRetorno(r) {
  if (!r || r.t !== 'retorno' || !r.vid) throw new Error('Link de resultados inválido.');
  const out = { concluidas: 0, nao_realizadas: 0, no_local: 0, encaixes: 0, correcoes: 0, ja_importadas: 0, retornos: 0 };
  for (const x of r.ms || []) {
    let m = missao(x.id);
    if (!m) {
      const e = upsertEstab(x.e); if (!e) continue;
      m = { id: x.id, estab_id: e.id, tipo: x.t || 'fiscalizacao', prioridade: 'media', status: 'pendente', data: r.d, vistoriador_id: r.vid, ordem: 99, origem: 'retorno', criado_em: r.d, checkin: null, checkout: null };
      state.missoes.push(m);
    }
    if (m.status === 'concluida' || m.status === 'nao_realizada') { out.ja_importadas++; continue; }
    m.checkin = x.ci || m.checkin;
    if (x.s === 'concluida' && x.co) {
      const { retorno } = concluirMissao(m, { ...x.co, fotos: [], fotos_no_celular: x.co.fotos || 0 });
      out.concluidas++; if (retorno) out.retornos++;
    } else if (x.s === 'nao_realizada') {
      m.status = 'nao_realizada'; m.checkout = x.co; out.nao_realizadas++;
    } else if (x.s === 'no_local') { m.status = 'no_local'; out.no_local++; }
  }
  for (const q of r.enc || []) {
    if (state.solicitacoes.some((z) => z.id === q.id)) continue;
    const e = upsertEstab(q.e); if (!e) continue;
    state.solicitacoes.push({ id: q.id, estab_id: e.id, vistoriador_id: r.vid, data: r.d, ts: q.ts, status: 'pendente', obs: q.obs || '' });
    out.encaixes++;
  }
  for (const c of r.cor || []) {
    if (state.correcoes.some((z) => z.id === c.id)) continue;
    const e = upsertEstab(c.e); if (!e) continue;
    state.correcoes.push({ id: c.id, estab_id: e.id, missao_id: c.missao_id, lat: c.lat, lng: c.lng, vistoriador_id: r.vid, ts: c.ts, status: 'pendente' });
    out.correcoes++;
  }
  registrar('receber_resultados', `${r.vid}:${r.d}`); salvar();
  return out;
}

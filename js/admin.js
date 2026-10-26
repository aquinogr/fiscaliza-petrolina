// Painel do oficial: escala por setor, missões, fila, sugestões, eventos e relatório.
/* global L */
import * as st from './store.js';
import { h, mount, clear, sheet, toast, field, select, chip, today, addDays, fmtDate, fmtTime, fmtDist, relDays, diffDays, copyText, confirmar, debounce } from './ui.js';
import { TIPOS, FILAS, STATUS, PRIORIDADES, RESULTADO_NOME, SITUACAO_NOME, MOTIVOS_REJEICAO, STATUS_EVENTO, STATUS_EVENTO_NOME, RESULTADOS_IMPRODUTIVOS, formatarCNPJ } from './dominio.js';
import { gerarSugestoes, scoreDe, cnaeInfo, semanaComEventoGrande } from './score.js';
import { criarMapa, iconeMissao, iconeFila, iconeSugestao, iconeLocal, iconeBase, iconePonto } from './map.js';
import { geocodificar, centroide, dist, extensaoRota } from './geo.js';
import { fotoURL } from './fotos.js';
import { marca } from './marca.js';
import { buscarMoci, linhasMoci, MOCI_SITE } from './moci.js';

const CINZA = '#94A3B8';

export function iniciarAdmin(root, { sair }) {
  const ui = {
    data: today(), aba: 'hoje', filtroTipo: '',
    camadas: { setores: true, missoes: true, fila: true, sugestoes: false, locais: true, base: false },
    desenho: null, escolhendoBase: false, limiteSug: 30, soVencidos: false, incluirSemAvcb: false, mociCarregando: false,
  };

  // ---------- estrutura ----------
  const inputData = h('input', { type: 'date', value: ui.data, 'aria-label': 'Data da escala', onchange: (e) => { if (e.target.value) { ui.data = e.target.value; render(); } } });
  const mudarDia = (n) => { ui.data = addDays(ui.data, n); inputData.value = ui.data; render(); };
  const rotuloDia = h('span', { class: 'date-rel' });
  const abas = [['hoje', 'Escala'], ['fila', 'Fila'], ['sugestoes', 'Sugestões'], ['eventos', 'Eventos'], ['relatorio', 'Relatório']];
  const tabs = h('nav', { class: 'tabs', role: 'tablist' }, abas.map(([k, l]) => h('button', {
    role: 'tab', type: 'button', class: 'tab', dataset: { aba: k }, onclick: () => { ui.aba = k; renderPainel(); },
  }, h('span', {}, l), h('span', { class: 'tab-n' }))));
  const corpo = h('div', { class: 'panel-body' });
  const mapaEl = h('div', { class: 'map', id: 'mapa-admin' });
  const faixaMapa = h('div', { class: 'map-banner', hidden: true });
  const ferramentas = h('div', { class: 'map-tools' });
  const legenda = h('div', { class: 'map-legend' });

  mount(root, h('div', { class: 'admin' },
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, marca(), h('div', {}, h('strong', {}, 'Fiscaliza Petrolina'), h('span', {}, 'Painel do oficial'))),
      h('div', { class: 'datebar' },
        h('button', { class: 'icon-btn on-dark', type: 'button', 'aria-label': 'Dia anterior', onclick: () => mudarDia(-1) }, '‹'),
        inputData,
        h('button', { class: 'icon-btn on-dark', type: 'button', 'aria-label': 'Próximo dia', onclick: () => mudarDia(1) }, '›'),
        rotuloDia),
      h('div', { class: 'top-actions' },
        st.S().modo === 'demo' ? h('span', { class: 'demo-badge', title: 'Os dados ficam só neste aparelho' }, 'Demonstração') : null,
        h('button', { class: 'btn btn-ghost on-dark', type: 'button', onclick: () => abrirAjustes() }, 'Ajustes'),
        h('button', { class: 'btn btn-ghost on-dark', type: 'button', onclick: sair }, 'Trocar perfil'))),
    h('aside', { class: 'panel' }, tabs, corpo),
    h('main', { class: 'map-wrap' }, mapaEl, faixaMapa, ferramentas, legenda)));

  // ---------- mapa ----------
  const map = criarMapa(mapaEl, { zoom: 13 });
  const G = {
    setores: L.layerGroup().addTo(map), rotas: L.layerGroup().addTo(map), missoes: L.layerGroup().addTo(map),
    fila: L.layerGroup().addTo(map), sugestoes: L.layerGroup(), locais: L.layerGroup().addTo(map),
    base: L.layerGroup(), sede: L.layerGroup().addTo(map), desenho: L.layerGroup().addTo(map), foco: L.layerGroup().addTo(map),
  };
  const marcadores = new Map();
  setTimeout(() => map.invalidateSize(), 50);
  window.addEventListener('resize', debounce(() => map.invalidateSize(), 150));
  map.on('click', (ev) => {
    if (ui.desenho) { ui.desenho.pontos.push([+ev.latlng.lat.toFixed(6), +ev.latlng.lng.toFixed(6)]); desenharRascunho(); return; }
    if (ui.escolhendoBase) {
      st.salvarConfig({ base: { lat: +ev.latlng.lat.toFixed(6), lng: +ev.latlng.lng.toFixed(6) } });
      ui.escolhendoBase = false; faixaMapa.hidden = true; mapaEl.classList.remove('drawing'); toast('Base atualizada.', 'ok');
    }
  });

  const CAMADAS = [['setores', 'Setores'], ['missoes', 'Missões do dia'], ['fila', 'Fila'], ['sugestoes', 'Sugestões'], ['locais', 'Locais de eventos'], ['base', 'Base pública']];
  mount(ferramentas, h('details', { class: 'layers' },
    h('summary', {}, 'Camadas'),
    CAMADAS.map(([k, l]) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: ui.camadas[k], onchange: (e) => { ui.camadas[k] = e.target.checked; aplicarCamadas(); } }), l))));
  function aplicarCamadas() {
    for (const [k] of CAMADAS) {
      const g = G[k]; if (!g) continue;
      if (ui.camadas[k] && !map.hasLayer(g)) g.addTo(map);
      if (!ui.camadas[k] && map.hasLayer(g)) map.removeLayer(g);
    }
    const rotasOn = ui.camadas.missoes;
    if (rotasOn && !map.hasLayer(G.rotas)) G.rotas.addTo(map);
    if (!rotasOn && map.hasLayer(G.rotas)) map.removeLayer(G.rotas);
    if (ui.camadas.base && !G.base.getLayers().length) renderBasePublica();
  }

  // ---------- utilidades ----------
  const S = () => st.S();
  const corV = (vid) => st.vist(vid)?.cor || CINZA;
  const nomeV = (vid) => st.vist(vid)?.nome || 'Na fila';
  const setorNome = (p) => st.setorDoPonto(p)?.nome || 'Fora dos setores';
  const opcoesVist = (comFila = true) => [...(comFila ? [['', 'Deixar na fila']] : []), ...S().vistoriadores.filter((v) => v.ativo !== false).map((v) => [v.id, v.nome])];

  function focar(p, zoom = 17) { if (p) map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), zoom), { duration: 0.6 }); }
  function focarMissao(m) {
    const p = st.pontoMissao(m); if (!p) return;
    focar(p);
    setTimeout(() => { const mk = marcadores.get(m.id); if (mk) mk.openPopup(); }, 650);
  }

  // ---------- render ----------
  function render() {
    rotuloDia.textContent = ui.data === today() ? 'Hoje' : relDays(ui.data);
    renderPainel();
    renderMapa();
  }

  function contadoresAbas(sugs) {
    const n = { fila: st.fila().length, sugestoes: sugs.length, eventos: S().eventos.filter((e) => e.status === 'nao_recebido' && diffDays(e.inicio, today()) >= 0 && diffDays(e.inicio, today()) <= 15).length };
    tabs.querySelectorAll('.tab').forEach((b) => {
      const k = b.dataset.aba;
      b.setAttribute('aria-selected', String(k === ui.aba));
      b.classList.toggle('active', k === ui.aba);
      const badge = b.querySelector('.tab-n');
      badge.textContent = n[k] ? String(n[k]) : '';
      badge.classList.toggle('alerta', k === 'eventos' && n[k] > 0);
    });
  }

  let sugCache = [];
  function renderPainel() {
    sugCache = gerarSugestoes(S());
    contadoresAbas(sugCache);
    const top = corpo.scrollTop;
    const telas = { hoje: telaHoje, fila: telaFila, sugestoes: telaSugestoes, eventos: telaEventos, relatorio: telaRelatorio };
    mount(corpo, telas[ui.aba]());
    corpo.scrollTop = top;
  }

  // ---------- aba: escala do dia ----------
  function telaHoje() {
    const pend = [...S().solicitacoes.filter((q) => q.status === 'pendente'), ...S().correcoes.filter((c) => c.status === 'pendente')];
    const esc = st.escalaDo(ui.data);
    const filaN = st.fila();
    const doDia = st.missoesDoDia(ui.data);
    const evento = semanaComEventoGrande(S());

    const blocoAprov = pend.length ? h('section', { class: 'block block-alert' },
      h('h3', {}, `Para aprovar (${pend.length})`),
      pend.map((x) => ('lat' in x ? cardCorrecao(x) : cardEncaixe(x)))) : null;

    const linhasSetor = S().setores.map((s) => {
      const vid = esc[s.id] || '';
      const nFila = filaN.filter((m) => st.setorDoPonto(st.pontoMissao(m))?.id === s.id).length;
      return h('div', { class: 'escala-row' },
        h('span', { class: 'swatch', style: { background: vid ? corV(vid) : 'transparent', borderColor: vid ? corV(vid) : CINZA } }),
        h('button', { class: 'link', type: 'button', onclick: () => map.flyToBounds(L.latLngBounds(s.poligono), { padding: [30, 30], duration: 0.6 }) }, s.nome),
        h('span', { class: 'muted small' }, nFila ? `${nFila} na fila` : 'fila vazia'),
        select(opcoesVist(false).length ? [['', 'Sem equipe'], ...opcoesVist(false)] : [['', 'Sem equipe']], vid, {
          'aria-label': `Equipe do setor ${s.nome}`, onchange: (e) => st.definirEscala(ui.data, s.id, e.target.value),
        }));
    });

    const blocoEscala = h('section', { class: 'block' },
      h('div', { class: 'block-head' }, h('h3', {}, 'Setores e equipes'), h('span', { class: 'muted small' }, fmtDate(ui.data, { long: true }))),
      linhasSetor.length ? linhasSetor : h('p', { class: 'empty' }, 'Nenhum setor cadastrado. Desenhe os setores em Ajustes.'),
      h('div', { class: 'row gap' },
        h('button', {
          class: 'btn btn-primary', type: 'button', disabled: !Object.keys(esc).length || !filaN.length,
          onclick: () => { const n = st.distribuirAutomatico(ui.data); toast(n ? `${n} missão(ões) da fila distribuídas pelos setores.` : 'Nenhuma missão da fila cabe nos setores escalados.', n ? 'ok' : 'info'); },
        }, 'Distribuir fila pelos setores'),
        h('button', { class: 'btn', type: 'button', onclick: () => novaMissao() }, 'Nova missão')),
      h('p', { class: 'hint' }, `Cada equipe recebe até ${S().config.capacidade_dia} missões por dia, por ordem de prioridade e prazo, só dentro do setor em que foi escalada.`),
      st.vencidosMoci().length ? h('p', { class: 'note note-warn' }, `${st.vencidosMoci().length} AVCB(s) vencido(s) no MOCI ainda fora da fila. `, h('button', { class: 'link', type: 'button', onclick: () => { ui.aba = 'sugestoes'; renderPainel(); } }, 'Ver no MOCI')) : null);

    // composição do dia x cotas
    const cont = { solicitada: 0, urgencia: 0, proativa: 0 };
    doDia.forEach((m) => { cont[TIPOS[m.tipo]?.fila || 'solicitada']++; });
    const total = doDia.length || 1;
    const cotas = S().config.cotas;
    const blocoCotas = doDia.length ? h('section', { class: 'block' },
      h('div', { class: 'block-head' }, h('h3', {}, 'Composição do dia'), h('span', { class: 'muted small' }, `${doDia.length} missões`)),
      h('div', { class: 'stackbar', role: 'img', 'aria-label': 'Distribuição das missões por fila' },
        Object.keys(cont).map((k) => h('span', { class: `seg seg-${k}`, style: { flexGrow: String(cont[k] || 0.0001) }, title: `${FILAS[k]}: ${cont[k]}` }))),
      h('div', { class: 'cotas' }, Object.keys(cont).map((k) => h('div', { class: 'cota' },
        h('span', { class: `dot seg-${k}` }), h('span', {}, FILAS[k]),
        h('strong', {}, `${Math.round((cont[k] / total) * 100)}%`), h('span', { class: 'muted small' }, `meta ${cotas[k]}%`)))),
      evento ? h('p', { class: 'note note-warn' }, `Evento grande nos próximos 7 dias (${evento.nome}, ${fmtDate(evento.inicio, { short: true })}). Vale segurar a cota proativa e reservar equipe para a vistoria do evento.`) : null) : null;

    const equipes = S().vistoriadores.filter((v) => v.ativo !== false).map((v) => cardEquipe(v));

    return h('div', { class: 'stack' }, blocoAprov, blocoEscala, blocoCotas, h('h3', { class: 'section-title' }, 'Equipes'), equipes);
  }

  function cardEquipe(v) {
    const lista = st.missoesDo(v.id, ui.data);
    const feitas = lista.filter((m) => m.status === 'concluida').length;
    const km = extensaoRota(S().config.base, lista.map(st.pontoMissao).filter(Boolean)) / 1000;
    const setores = Object.entries(st.escalaDo(ui.data)).filter(([, vid]) => vid === v.id).map(([sid]) => st.setor(sid)?.nome).filter(Boolean);
    const ultimo = lista.filter((m) => m.checkin).sort((a, b) => b.checkin.ts - a.checkin.ts)[0];
    return h('section', { class: 'team', style: { '--c': v.cor } },
      h('div', { class: 'team-head' },
        h('span', { class: 'team-dot' }),
        h('div', { class: 'grow' }, h('strong', {}, v.nome), h('div', { class: 'muted small' }, setores.length ? setores.join(', ') : 'Sem setor escalado')),
        h('div', { class: 'team-prog' }, h('strong', {}, `${feitas}/${lista.length}`), h('span', { class: 'muted small' }, lista.length ? `rota ~${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km` : ''))),
      lista.length ? h('div', { class: 'progress' }, h('span', { style: { width: `${(feitas / lista.length) * 100}%` } })) : null,
      ultimo ? h('p', { class: 'muted small' }, `Último check-in às ${fmtTime(ultimo.checkin.ts)}: ${st.estab(ultimo.estab_id)?.nome || ''}`) : null,
      h('ol', { class: 'mlist' }, lista.map((m) => linhaMissao(m))),
      lista.length === 0 ? h('p', { class: 'empty' }, 'Sem missões neste dia.') : null,
      h('div', { class: 'row gap' },
        lista.filter((m) => m.status === 'pendente').length > 1 ? h('button', { class: 'btn btn-small', type: 'button', onclick: () => { st.reordenarRota(v.id, ui.data); toast(`Roteiro de ${v.nome} reorganizado pela menor distância.`, 'ok'); } }, 'Otimizar roteiro') : null,
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => escolherDaFila(v) }, 'Adicionar da fila')));
  }

  function linhaMissao(m) {
    const e = st.estab(m.estab_id);
    const fora = m.checkin && !m.checkin.dentro;
    return h('li', { class: `mrow st-${m.status}` },
      h('button', { class: 'mrow-btn', type: 'button', onclick: () => abrirMissao(m) },
        h('span', { class: 'mnum' }, String(m.ordem || '')),
        h('span', { class: 'grow' },
          h('span', { class: 'mname' }, e?.nome || 'Estabelecimento removido'),
          h('span', { class: 'mmeta' }, TIPOS[m.tipo]?.nome || m.tipo, m.prioridade === 'alta' ? h('span', { class: 'tag tag-alta' }, 'Alta') : null, fora ? h('span', { class: 'tag tag-warn', title: m.checkin.justificativa || '' }, `Check-in a ${fmtDist(m.checkin.distancia)}`) : null)),
        h('span', { class: `status s-${m.status}` }, statusTexto(m))));
  }
  function statusTexto(m) {
    if (m.status === 'concluida') return m.checkout?.resultado ? RESULTADO_NOME[m.checkout.resultado] : 'Concluída';
    if (m.status === 'no_local') return `No local ${fmtTime(m.checkin?.ts)}`;
    return STATUS[m.status];
  }

  function cardEncaixe(q) {
    const e = st.estab(q.estab_id);
    const sc = e ? scoreDe(S(), e) : null;
    return h('div', { class: 'approval' },
      h('div', { class: 'grow' },
        h('strong', {}, `Encaixe pedido por ${nomeV(q.vistoriador_id)}`),
        h('div', {}, e?.nome || ''), h('div', { class: 'muted small' }, [sc ? `${sc.info.desc}, escore ${sc.score}` : '', q.obs ? `. ${q.obs}` : ''].join(''))),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => focar(e) }, 'Ver'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => { st.decidirEncaixe(q.id, false); toast('Encaixe recusado.'); } }, 'Recusar'),
        h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => { st.decidirEncaixe(q.id, true); toast('Encaixe aprovado e incluído no roteiro.', 'ok'); } }, 'Aprovar')));
  }

  function cardCorrecao(c) {
    const e = st.estab(c.estab_id);
    const d = e ? dist(e, c) : NaN;
    return h('div', { class: 'approval' },
      h('div', { class: 'grow' },
        h('strong', {}, `Corrigir localização (${nomeV(c.vistoriador_id)})`),
        h('div', {}, e?.nome || ''), h('div', { class: 'muted small' }, `O ponto informado em campo fica a ${fmtDist(d)} do cadastrado.`)),
      h('div', { class: 'row gap' },
        h('button', {
          class: 'btn btn-small', type: 'button', onclick: () => {
            G.foco.clearLayers();
            if (e) { L.polyline([[e.lat, e.lng], [c.lat, c.lng]], { color: '#B42318', dashArray: '4 6', weight: 2 }).addTo(G.foco); L.circleMarker([c.lat, c.lng], { radius: 7, color: '#B42318', fillOpacity: 0.8 }).addTo(G.foco).bindTooltip('Posição informada em campo').openTooltip(); map.flyToBounds(L.latLngBounds([[e.lat, e.lng], [c.lat, c.lng]]), { padding: [80, 80], duration: 0.6 }); }
          },
        }, 'Ver'),
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => { st.decidirCorrecao(c.id, false); G.foco.clearLayers(); toast('Localização mantida.'); } }, 'Manter'),
        h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => { st.decidirCorrecao(c.id, true); G.foco.clearLayers(); toast('Localização corrigida no cadastro.', 'ok'); } }, 'Corrigir')));
  }

  function escolherDaFila(v) {
    const lista = st.filaOrdenada();
    const sh = sheet({
      title: `Adicionar à rota de ${v.nome}`,
      body: lista.length ? h('div', { class: 'stack' }, lista.map((m) => {
        const e = st.estab(m.estab_id);
        return h('button', { class: 'pick', type: 'button', onclick: () => { st.atribuir(m.id, v.id, ui.data); toast(`${e?.nome} entrou na rota de ${v.nome}.`, 'ok'); sh.close(); } },
          h('strong', {}, e?.nome || ''), h('span', { class: 'muted small' }, `${TIPOS[m.tipo]?.nome}, ${setorNome(e)}${m.prazo ? `, prazo ${relDays(m.prazo)}` : ''}`));
      })) : h('p', { class: 'empty' }, 'A fila está vazia.'),
    });
  }

  // ---------- aba: fila ----------
  function telaFila() {
    const lista = st.filaOrdenada().filter((m) => !ui.filtroTipo || m.tipo === ui.filtroTipo);
    const vencendo = st.fila().filter((m) => m.prazo && diffDays(m.prazo, today()) <= 2).length;
    return h('div', { class: 'stack' },
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => novaMissao() }, 'Nova missão'),
        select([['', 'Todos os tipos'], ...Object.entries(TIPOS).map(([k, t]) => [k, t.nome])], ui.filtroTipo, { 'aria-label': 'Filtrar por tipo', onchange: (e) => { ui.filtroTipo = e.target.value; renderPainel(); } })),
      vencendo ? h('p', { class: 'note note-warn' }, `${vencendo} missão(ões) com prazo vencido ou vencendo em até 2 dias.`) : null,
      h('p', { class: 'hint' }, 'Regularizações recebidas no SAC entram aqui quando você as cadastra. Ordem: prioridade, depois prazo, depois antiguidade.'),
      lista.length ? lista.map((m) => cardFila(m)) : h('p', { class: 'empty' }, 'Fila vazia. Cadastre uma nova missão quando receber um processo.'));
  }

  function cardFila(m) {
    const e = st.estab(m.estab_id);
    const dPrazo = m.prazo ? diffDays(m.prazo, today()) : null;
    const esc = st.escalaDo(ui.data);
    const sug = e ? esc[st.setorDoPonto(e)?.id] : '';
    return h('div', { class: 'qcard' },
      h('button', { class: 'qmain', type: 'button', onclick: () => abrirMissao(m) },
        h('div', { class: 'row between' }, h('strong', {}, e?.nome || ''), m.prioridade === 'alta' ? h('span', { class: 'tag tag-alta' }, 'Alta') : null),
        h('div', { class: 'mmeta' }, TIPOS[m.tipo]?.nome, h('span', {}, setorNome(e)), m.processo ? h('span', {}, m.processo) : null),
        h('div', { class: 'mmeta' },
          m.prazo ? h('span', { class: dPrazo < 0 ? 'txt-danger' : dPrazo <= 2 ? 'txt-warn' : '' }, dPrazo < 0 ? `Prazo venceu ${relDays(m.prazo)}` : `Prazo ${relDays(m.prazo)} (${fmtDate(m.prazo, { short: true })})`) : null,
          h('span', { class: 'muted' }, `Na fila desde ${fmtDate(m.criado_em, { short: true })}`))),
      h('div', { class: 'qassign' },
        select([['', 'Atribuir a…'], ...opcoesVist(false)], '', {
          'aria-label': 'Atribuir a vistoriador',
          onchange: (ev) => { if (ev.target.value) { st.atribuir(m.id, ev.target.value, ui.data); toast(`Atribuída a ${nomeV(ev.target.value)} para ${fmtDate(ui.data, { short: true })}.`, 'ok'); } },
        }),
        sug ? h('span', { class: 'muted small' }, `Setor com ${nomeV(sug)} neste dia`) : null));
  }

  // ---------- aba: sugestões ----------
  function telaSugestoes() {
    const ev = semanaComEventoGrande(S());
    const filtradas = ui.soVencidos ? sugCache.filter((x) => x.estab.situacao_doc === 'vencido') : sugCache;
    const lista = filtradas.slice(0, ui.limiteSug);
    return h('div', { class: 'stack' },
      blocoMoci(),
      h('p', { class: 'hint' }, 'Geradas a partir da base pública (CNPJ e endereços do IBGE) e do que as equipes registram em campo. Nada vira missão sem a sua decisão; cada rejeição ensina o motor a não repetir.'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn', type: 'button', onclick: () => abrirCriterios() }, 'Critérios'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ui.camadas.sugestoes, onchange: (e) => { ui.camadas.sugestoes = e.target.checked; aplicarCamadas(); syncCheck(); renderMapa(); } }), 'Mostrar no mapa'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ui.soVencidos, onchange: (e) => { ui.soVencidos = e.target.checked; renderPainel(); } }), 'Só AVCB vencido')),
      ev ? h('p', { class: 'note note-warn' }, `${ev.nome} acontece ${relDays(ev.inicio)}. Na semana de evento grande, a sugestão é segurar a fiscalização proativa.`) : null,
      lista.length ? lista.map((s) => cardSugestao(s)) : h('p', { class: 'empty' }, ui.soVencidos ? 'Nenhum AVCB vencido entre as sugestões. Os que já estão na fila ou com missão não aparecem aqui.' : `Nenhuma sugestão acima de ${S().config.limite_sugestao} pontos. Você pode baixar o limite em Critérios.`),
      filtradas.length > lista.length ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { ui.limiteSug += 30; renderPainel(); } }, `Mostrar mais (${filtradas.length - lista.length})`) : null);
  }

  // ---------- MOCI ----------
  async function sincronizarMoci({ silencioso = false } = {}) {
    if (ui.mociCarregando) return;
    if (!navigator.onLine) { if (!silencioso) toast('Sem conexão para buscar o MOCI agora.', 'warn'); return; }
    ui.mociCarregando = true; if (ui.aba === 'sugestoes') renderPainel();
    try {
      const pontos = await buscarMoci(st.configMoci().url);
      const r = st.importarMoci(pontos);
      if (!silencioso || r.novos) toast(`MOCI atualizado: ${r.importados} edificação(ões), ${r.vencidos} com AVCB vencido.`, 'ok');
    } catch (err) {
      if (!silencioso) toast(`Não foi possível ler o MOCI: ${err.message}`, 'warn');
    } finally {
      ui.mociCarregando = false; renderPainel();
    }
  }

  function blocoMoci() {
    const c = st.configMoci();
    const sy = c.sync;
    const venc = st.vencidosMoci({ incluirSemAvcb: false }).length;
    const semAvcb = st.vencidosMoci({ incluirSemAvcb: true }).length - venc;
    const naFila = st.fila().filter((m) => m.tipo === 'avcb_vencido').length;
    return h('section', { class: 'block block-moci' },
      h('div', { class: 'block-head' }, h('h3', {}, 'MOCI'), h('a', { href: MOCI_SITE, target: '_blank', rel: 'noopener', class: 'small' }, 'Abrir o MOCI')),
      ui.mociCarregando ? h('p', { class: 'muted' }, 'Lendo o cadastro do MOCI…') :
        sy ? h('p', {}, `Atualizado às ${fmtTime(sy.ts)}${new Date(sy.ts).toLocaleDateString('pt-BR') !== new Date().toLocaleDateString('pt-BR') ? ` de ${new Date(sy.ts).toLocaleDateString('pt-BR')}` : ''}: ${sy.importados} edificação(ões) de ${c.cidades || 'todas as cidades'}, ${sy.vencidos} com AVCB vencido e ${sy.sem_avcb} sem AVCB.`) :
          h('p', { class: 'muted' }, 'Ainda não lido. Toque em "Atualizar do MOCI".'),
      sy && sy.vencidos_outras ? h('p', { class: 'hint' }, `Há ${sy.vencidos_outras} AVCB(s) vencido(s) em outras cidades do CAT Sertão, fora do filtro (Ajustes > Dados).`) : null,
      naFila ? h('p', { class: 'hint' }, `${naFila} missão(ões) de AVCB vencido já estão na fila.`) : null,
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn btn-small', type: 'button', disabled: ui.mociCarregando, onclick: () => sincronizarMoci() }, 'Atualizar do MOCI'),
        h('button', {
          class: 'btn btn-small btn-primary', type: 'button', disabled: !(venc || (ui.incluirSemAvcb && semAvcb)),
          onclick: () => { const n = st.filaDeVencidos({ incluirSemAvcb: ui.incluirSemAvcb }); toast(n ? `${n} missão(ões) na fila, com prioridade alta para os vencidos. Use "Distribuir fila pelos setores" na Escala.` : 'Nada novo para pôr na fila.', n ? 'ok' : 'info'); },
        }, `Pôr na fila (${venc + (ui.incluirSemAvcb ? semAvcb : 0)})`),
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: ui.incluirSemAvcb, onchange: (e) => { ui.incluirSemAvcb = e.target.checked; renderPainel(); } }), `Incluir sem AVCB (${semAvcb})`)));
  }
  function syncCheck() { ferramentas.querySelectorAll('input[type=checkbox]').forEach((c, i) => { c.checked = ui.camadas[CAMADAS[i][0]]; }); }

  function cardSugestao(s) {
    const e = s.estab;
    const motivos = s.partes.filter((p) => p.pontos > 0).sort((a, b) => b.pontos - a.pontos).slice(0, 3);
    return h('div', { class: 'scard' },
      h('div', { class: 'score', style: { '--c': s.info.cat?.cor || CINZA }, title: 'Escore de prioridade (0 a 100)' }, String(s.score)),
      h('div', { class: 'grow' },
        h('div', { class: 'row between' }, h('strong', {}, e.nome), s.pedido ? h('span', { class: 'tag tag-warn' }, 'Encaixe pedido') : null),
        h('div', { class: 'mmeta' }, s.info.desc, h('span', {}, setorNome(e)), ...s.tags.map((t) => h('span', { class: 'tag' }, t))),
        h('ul', { class: 'motivos' }, motivos.map((p) => h('li', {}, p.motivo))),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => { ui.camadas.sugestoes = true; aplicarCamadas(); syncCheck(); renderMapa(); focar(e); setTimeout(() => marcadores.get('sug-' + e.id)?.openPopup(), 650); } }, 'Ver no mapa'),
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => rejeitar(e) }, 'Rejeitar'),
          h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => aceitar(e, s.score) }, 'Aceitar'))));
  }

  function aceitar(e, score) {
    const esc = st.escalaDo(ui.data);
    const vSug = esc[st.setorDoPonto(e)?.id] || '';
    const selV = select(opcoesVist(true), vSug);
    const inData = h('input', { type: 'date', value: ui.data });
    sheet({
      title: 'Criar missão de fiscalização',
      body: h('div', { class: 'stack' }, h('p', {}, h('strong', {}, e.nome), h('br'), h('span', { class: 'muted' }, `${e.endereco}, ${setorNome(e)}`)),
        field('Vistoriador', selV, vSug ? `${nomeV(vSug)} está escalado neste setor no dia.` : 'Ninguém escalado neste setor no dia. Pode deixar na fila.'),
        field('Data', inData)),
      actions: [{ label: 'Cancelar' }, { label: 'Criar missão', kind: 'primary', onClick: () => { st.aceitarSugestao(e.id, selV.value, inData.value, score); toast(selV.value ? `Missão criada para ${nomeV(selV.value)}.` : 'Missão criada na fila.', 'ok'); } }],
    });
  }

  function rejeitar(e) {
    let motivo = 'depois';
    sheet({
      title: 'Rejeitar sugestão',
      body: h('div', { class: 'stack' }, h('p', {}, e.nome),
        h('div', { class: 'radios', role: 'radiogroup' }, MOTIVOS_REJEICAO.map(([k, l]) => h('label', { class: 'radio' },
          h('input', { type: 'radio', name: 'motivo', value: k, checked: k === motivo, onchange: () => { motivo = k; } }), l))),
        h('p', { class: 'hint' }, '"Agora não" volta em 30 dias. "Já está regular" e "Isento" voltam em 1 ano. Os demais saem da lista.')),
      actions: [{ label: 'Cancelar' }, { label: 'Rejeitar', kind: 'primary', onClick: () => { st.rejeitarSugestao(e.id, motivo); toast('Sugestão rejeitada.'); } }],
    });
  }

  function abrirCriterios() {
    const c = S().config;
    const pesos = { ...c.pesos };
    const nomes = { ocupacao: 'Ocupação e consequências', documental: 'Situação documental', historico: 'Histórico de exigências', exposicao: 'Concentração e exposição', tempo: 'Tempo desde a última fiscalização' };
    const soma = h('strong', {});
    const atualizar = () => { soma.textContent = `${Object.values(pesos).reduce((a, b) => a + (+b || 0), 0)} pontos no total`; };
    const lim = h('input', { type: 'number', min: 0, max: 100, value: c.limite_sugestao });
    atualizar();
    sheet({
      title: 'Critérios das sugestões',
      body: h('div', { class: 'stack' },
        h('p', { class: 'hint' }, 'Pesos da matriz preliminar do projeto GEOSEG, para discussão. O escore é normalizado de 0 a 100.'),
        Object.keys(nomes).map((k) => field(nomes[k], h('input', { type: 'number', min: 0, max: 100, value: pesos[k], oninput: (e) => { pesos[k] = +e.target.value || 0; atualizar(); } }))),
        soma,
        field('Escore mínimo para aparecer como sugestão', lim)),
      actions: [{ label: 'Cancelar' }, { label: 'Salvar critérios', kind: 'primary', onClick: () => { st.salvarConfig({ pesos, limite_sugestao: +lim.value || 0 }); toast('Critérios salvos.', 'ok'); } }],
    });
  }

  // ---------- aba: eventos ----------
  function telaEventos() {
    const hoje = today();
    const ag = S().eventos.filter((e) => diffDays(e.fim || e.inicio, hoje) >= -7).sort((a, b) => a.inicio.localeCompare(b.inicio));
    return h('div', { class: 'stack' },
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => editarEvento() }, 'Novo evento'),
        h('button', { class: 'btn', type: 'button', onclick: () => editarLocal() }, 'Novo local')),
      h('p', { class: 'hint' }, 'Inclua também os eventos vistos na divulgação (redes sociais, rádio, cartazes). Evento anunciado sem solicitação aparece em vermelho.'),
      h('h3', { class: 'section-title' }, 'Agenda'),
      ag.length ? ag.map((ev) => cardEvento(ev)) : h('p', { class: 'empty' }, 'Nenhum evento na agenda.'),
      h('h3', { class: 'section-title' }, 'Locais recorrentes'),
      S().locais.map((l) => h('button', { class: 'pick', type: 'button', onclick: () => editarLocal(l) },
        h('strong', {}, l.nome), h('span', { class: 'muted small' }, `Capacidade autorizada: ${l.capacidade ? l.capacidade.toLocaleString('pt-BR') : 'não informada'}${l.pendencias ? '. Tem pendência registrada' : ''}`))));
  }

  function cardEvento(ev) {
    const l = st.local(ev.local_id);
    const d = diffDays(ev.inicio, today());
    const alerta = ev.status === 'nao_recebido' && d >= 0 && d <= 15;
    const vistorias = S().missoes.filter((m) => m.evento_id === ev.id);
    return h('div', { class: `ecard${alerta ? ' ecard-alerta' : ''}` },
      h('div', { class: 'edate' }, h('strong', {}, fmtDate(ev.inicio, { short: true })), h('span', {}, d === 0 ? 'hoje' : d > 0 ? `D-${d}` : 'passou')),
      h('div', { class: 'grow' },
        h('strong', {}, ev.nome),
        h('div', { class: 'mmeta' }, l?.nome || 'Local não informado', ev.publico ? h('span', {}, `${ev.publico.toLocaleString('pt-BR')} pessoas`) : null),
        h('div', { class: 'mmeta' }, h('span', { class: `tag ${alerta ? 'tag-alta' : ev.status === 'liberado' ? 'tag-ok' : ''}` }, STATUS_EVENTO_NOME[ev.status]), ev.processo ? h('span', {}, ev.processo) : null, ev.origem ? h('span', { class: 'muted' }, ev.origem) : null),
        vistorias.length ? h('div', { class: 'muted small' }, `Vistorias programadas: ${vistorias.map((m) => `${fmtDate(m.data || m.criado_em, { short: true })} (${STATUS[m.status]})`).join(', ')}`) : null,
        h('div', { class: 'row gap' },
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => l && focar(l, 16) }, 'Ver local'),
          h('button', { class: 'btn btn-small', type: 'button', onclick: () => editarEvento(ev) }, 'Editar'),
          h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => programarVistoriaEvento(ev) }, 'Programar vistoria'))));
  }

  function programarVistoriaEvento(ev) {
    const l = st.local(ev.local_id);
    if (!l) { toast('Cadastre o local do evento antes.', 'warn'); return; }
    const selV = select(opcoesVist(true), '');
    const inData = h('input', { type: 'date', value: addDays(ev.inicio, -1) < today() ? today() : addDays(ev.inicio, -1) });
    sheet({
      title: 'Programar vistoria do evento',
      body: h('div', { class: 'stack' }, h('p', {}, h('strong', {}, ev.nome), h('br'), l.nome),
        field('Vistoriador', selV), field('Data da vistoria', inData, 'Sugestão: véspera do evento, com a montagem concluída.')),
      actions: [{ label: 'Cancelar' }, {
        label: 'Programar', kind: 'primary', onClick: () => {
          let estabId = l.estab_id;
          if (!estabId || !st.estab(estabId)) { const e = st.novoEstabelecimento({ nome: l.nome, lat: l.lat, lng: l.lng, endereco: '' }); estabId = e.id; l.estab_id = e.id; st.salvarLocal(l); }
          st.criarMissao({ estab_id: estabId, tipo: 'evento', evento_id: ev.id, vistoriador_id: selV.value, data: inData.value, prioridade: 'alta', processo: ev.processo, prazo: ev.inicio, notas: `Vistoria do evento "${ev.nome}". Público estimado: ${ev.publico || 'não informado'}. Capacidade autorizada do local: ${l.capacidade || 'não informada'}.${l.pendencias ? ` Pendência anterior: ${l.pendencias}` : ''}` });
          toast('Vistoria do evento programada.', 'ok');
        },
      }],
    });
  }

  function editarEvento(ev) {
    const novo = !ev;
    const d = ev ? { ...ev } : { nome: '', local_id: S().locais[0]?.id || '', inicio: addDays(today(), 7), fim: '', publico: '', status: 'nao_recebido', processo: '', origem: '', notas: '' };
    const f = {
      nome: h('input', { value: d.nome, required: true }),
      local: select(S().locais.map((l) => [l.id, l.nome]), d.local_id),
      inicio: h('input', { type: 'date', value: d.inicio }),
      fim: h('input', { type: 'date', value: d.fim || '' }),
      publico: h('input', { type: 'number', min: 0, value: d.publico || '' }),
      status: select(STATUS_EVENTO, d.status),
      processo: h('input', { value: d.processo || '', placeholder: 'Ex.: SAC 2026.012345' }),
      origem: h('input', { value: d.origem || '', placeholder: 'Ex.: divulgação no Instagram da casa' }),
      notas: h('textarea', { rows: 3 }, d.notas || ''),
    };
    sheet({
      title: novo ? 'Novo evento' : 'Editar evento',
      body: h('div', { class: 'form-grid' },
        field('Nome do evento', f.nome), field('Local', f.local), field('Início', f.inicio), field('Fim', f.fim), field('Público estimado', f.publico), field('Situação', f.status), field('Nº do processo', f.processo), field('Como soube', f.origem), field('Observações', f.notas)),
      actions: [
        !novo ? { label: 'Excluir', kind: 'danger', onClick: async () => { if (await confirmar('Excluir este evento?', { ok: 'Excluir', kind: 'danger' })) { st.excluirEvento(ev.id); } else return false; } } : null,
        { label: 'Cancelar' },
        { label: 'Salvar evento', kind: 'primary', onClick: () => {
          if (!f.nome.value.trim()) { toast('Informe o nome do evento.', 'warn'); return false; }
          st.salvarEvento({ ...(ev || {}), nome: f.nome.value.trim(), local_id: f.local.value, inicio: f.inicio.value, fim: f.fim.value || f.inicio.value, publico: +f.publico.value || 0, status: f.status.value, processo: f.processo.value.trim() || null, origem: f.origem.value.trim(), notas: f.notas.value.trim() });
          toast('Evento salvo.', 'ok');
        } },
      ].filter(Boolean),
    });
  }

  function editarLocal(l) {
    const novo = !l;
    const d = l ? { ...l } : { nome: '', lat: map.getCenter().lat, lng: map.getCenter().lng, capacidade: '', saidas: '', acesso_viatura: '', ponto_agua: '', pendencias: '' };
    const f = {
      nome: h('input', { value: d.nome }),
      capacidade: h('input', { type: 'number', min: 0, value: d.capacidade || '' }),
      saidas: h('input', { value: d.saidas || '' }),
      acesso: h('input', { value: d.acesso_viatura || '' }),
      agua: h('input', { value: d.ponto_agua || '' }),
      pend: h('textarea', { rows: 3 }, d.pendencias || ''),
    };
    const pos = { lat: d.lat, lng: d.lng };
    const mini = h('div', { class: 'minimap' });
    const historicoEv = l ? S().eventos.filter((e) => e.local_id === l.id).sort((a, b) => b.inicio.localeCompare(a.inicio)) : [];
    const sh = sheet({
      title: novo ? 'Novo local de eventos' : l.nome, wide: true,
      body: h('div', { class: 'stack' },
        h('div', { class: 'form-grid' }, field('Nome', f.nome), field('Capacidade autorizada', f.capacidade), field('Saídas', f.saidas), field('Acesso de viatura', f.acesso), field('Ponto de água mais próximo', f.agua), field('Pendências conhecidas', f.pend)),
        h('span', { class: 'field-label' }, 'Localização (toque no mapa para ajustar)'), mini,
        historicoEv.length ? h('div', {}, h('span', { class: 'field-label' }, 'Eventos neste local'), h('ul', { class: 'plain' }, historicoEv.map((e) => h('li', {}, `${fmtDate(e.inicio)}: ${e.nome} (${STATUS_EVENTO_NOME[e.status]})`)))) : null),
      actions: [{ label: 'Cancelar' }, { label: 'Salvar local', kind: 'primary', onClick: () => {
        if (!f.nome.value.trim()) { toast('Informe o nome do local.', 'warn'); return false; }
        st.salvarLocal({ ...(l || {}), nome: f.nome.value.trim(), lat: pos.lat, lng: pos.lng, capacidade: +f.capacidade.value || 0, saidas: f.saidas.value.trim(), acesso_viatura: f.acesso.value.trim(), ponto_agua: f.agua.value.trim(), pendencias: f.pend.value.trim() });
        toast('Local salvo.', 'ok');
      } }],
    });
    setTimeout(() => {
      const mm = criarMapa(mini, { centro: pos, zoom: 15 });
      const mk = L.marker([pos.lat, pos.lng], { draggable: true, icon: iconePonto() }).addTo(mm);
      const set = (ll) => { pos.lat = +ll.lat.toFixed(6); pos.lng = +ll.lng.toFixed(6); mk.setLatLng(ll); };
      mm.on('click', (e) => set(e.latlng)); mk.on('dragend', () => set(mk.getLatLng()));
      setTimeout(() => mm.invalidateSize(), 80);
    }, 30);
    return sh;
  }

  // ---------- aba: relatório ----------
  function telaRelatorio() {
    const txt = gerarRelatorio(ui.data);
    const ta = h('textarea', { class: 'report', rows: 22, readonly: true }, txt);
    return h('div', { class: 'stack' },
      h('p', { class: 'hint' }, `Resumo de ${fmtDate(ui.data, { long: true })}, no formato do WhatsApp (negrito com asteriscos).`),
      ta,
      h('div', { class: 'row gap' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => copyText(txt).then(() => toast('Relatório copiado.', 'ok')) }, 'Copiar relatório'),
        h('a', { class: 'btn', href: `https://wa.me/?text=${encodeURIComponent(txt)}`, target: '_blank', rel: 'noopener' }, 'Abrir no WhatsApp')));
  }

  function gerarRelatorio(data) {
    const ms = st.missoesDoDia(data);
    const c = (s) => ms.filter((m) => m.status === s).length;
    const res = {};
    ms.filter((m) => m.checkout?.resultado).forEach((m) => { res[m.checkout.resultado] = (res[m.checkout.resultado] || 0) + 1; });
    const linhasRes = Object.entries(res).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${RESULTADO_NOME[k]}: ${n}`);
    const L1 = [`*${S().config.unidade}: fiscalização em Petrolina*`, `Relatório de ${fmtDate(data, { long: true })}`, ''];
    L1.push('*Resumo*');
    L1.push(`Missões programadas: ${ms.length}`);
    L1.push(`Concluídas: ${c('concluida')} | No local: ${c('no_local')} | Pendentes: ${c('pendente')} | Não realizadas: ${c('nao_realizada')}`);
    if (linhasRes.length) L1.push(`Resultados: ${linhasRes.join(', ')}`);
    const encaixes = ms.filter((m) => m.tipo === 'encaixe' && m.status === 'concluida').length;
    const proativas = ms.filter((m) => TIPOS[m.tipo]?.fila === 'proativa').length;
    L1.push(`Fiscalizações proativas: ${proativas}${encaixes ? ` (${encaixes} encaixe(s) em campo)` : ''}`);
    L1.push('');
    L1.push('*Por equipe*');
    for (const v of S().vistoriadores) {
      const l = st.missoesDo(v.id, data); if (!l.length) continue;
      const setores = Object.entries(st.escalaDo(data)).filter(([, x]) => x === v.id).map(([sid]) => st.setor(sid)?.nome).filter(Boolean);
      L1.push(`• ${v.nome}${setores.length ? ` (${setores.join(', ')})` : ''}: ${l.filter((m) => m.status === 'concluida').length}/${l.length} concluídas`);
    }
    const atencao = [];
    ms.filter((m) => m.checkin && !m.checkin.dentro).forEach((m) => atencao.push(`Check-in fora do raio: ${nomeV(m.vistoriador_id)} em ${st.estab(m.estab_id)?.nome} (${fmtDist(m.checkin.distancia)})`));
    ms.filter((m) => m.checkout && RESULTADOS_IMPRODUTIVOS.includes(m.checkout.resultado)).forEach((m) => atencao.push(`Visita improdutiva: ${st.estab(m.estab_id)?.nome} (${RESULTADO_NOME[m.checkout.resultado].toLowerCase()})`));
    ms.filter((m) => m.checkout && ['auto_infracao', 'interditado'].includes(m.checkout.resultado)).forEach((m) => atencao.push(`${RESULTADO_NOME[m.checkout.resultado]}: ${st.estab(m.estab_id)?.nome}`));
    const venc = st.fila().filter((m) => m.prazo && diffDays(m.prazo, data) <= 2);
    if (venc.length) atencao.push(`${venc.length} missão(ões) na fila com prazo vencido ou vencendo em 2 dias`);
    S().eventos.filter((e) => e.status === 'nao_recebido' && diffDays(e.inicio, data) >= 0 && diffDays(e.inicio, data) <= 15)
      .forEach((e) => atencao.push(`Evento sem solicitação: ${e.nome}, ${fmtDate(e.inicio, { short: true })}`));
    if (atencao.length) { L1.push(''); L1.push('*Pontos de atenção*'); atencao.forEach((a) => L1.push(`• ${a}`)); }
    const fila = st.fila();
    L1.push(''); L1.push(`Fila ao fim do dia: ${fila.length} missão(ões).`);
    return L1.join('\n');
  }

  // ---------- missão: detalhe e edição ----------
  function abrirMissao(m) {
    const e = st.estab(m.estab_id);
    const sc = e ? scoreDe(S(), e) : null;
    const hist = e ? st.historico(e.id).filter((x) => x.id !== m.id).slice(0, 3) : [];
    const selV = select(opcoesVist(true), m.vistoriador_id || '');
    const inData = h('input', { type: 'date', value: m.data || ui.data });
    const selP = select(Object.entries(PRIORIDADES), m.prioridade);
    const inPrazo = h('input', { type: 'date', value: m.prazo || '' });
    const inProc = h('input', { value: m.processo || '' });
    const taNotas = h('textarea', { rows: 3 }, m.notas || '');
    const fotos = h('div', { class: 'fotos' });
    (m.checkout?.fotos || []).forEach(async (id) => { const u = await fotoURL(id); if (u) fotos.append(h('a', { href: u, target: '_blank', rel: 'noopener' }, h('img', { src: u, alt: 'Foto da vistoria' }))); });

    const exec = [];
    if (m.checkin) {
      exec.push(h('div', { class: `kv ${m.checkin.dentro ? '' : 'kv-warn'}` },
        h('span', {}, 'Check-in'),
        h('strong', {}, `${fmtTime(m.checkin.ts)}, a ${fmtDist(m.checkin.distancia)} do ponto${m.checkin.dentro ? '' : ' (fora do raio)'}${m.checkin.simulado ? ', posição simulada' : ''}`)));
      if (m.checkin.justificativa) exec.push(h('div', { class: 'kv' }, h('span', {}, 'Justificativa'), h('strong', {}, m.checkin.justificativa)));
    }
    if (m.checkout) {
      if (m.status === 'nao_realizada') exec.push(h('div', { class: 'kv kv-warn' }, h('span', {}, 'Não realizada'), h('strong', {}, m.checkout.motivo || '')));
      else {
        exec.push(h('div', { class: 'kv' }, h('span', {}, 'Resultado'), h('strong', {}, `${RESULTADO_NOME[m.checkout.resultado] || ''} às ${fmtTime(m.checkout.ts)}`)));
        exec.push(h('div', { class: 'kv' }, h('span', {}, 'Documento visto'), h('strong', {}, `${SITUACAO_NOME[m.checkout.situacao_doc] || 'Não verificado'}${m.checkout.validade ? `, válido até ${fmtDate(m.checkout.validade)}` : ''}`)));
        if (m.checkout.obs) exec.push(h('div', { class: 'kv' }, h('span', {}, 'Observações'), h('strong', {}, m.checkout.obs)));
      }
    }

    const sh = sheet({
      title: e?.nome || 'Missão', wide: true,
      body: h('div', { class: 'detail' },
        h('div', { class: 'detail-col' },
          h('div', { class: 'mmeta' }, h('span', { class: `status s-${m.status}` }, statusTexto(m)), TIPOS[m.tipo]?.nome, m.origem === 'sugestao' ? h('span', { class: 'tag' }, 'Veio de sugestão') : null),
          h('div', { class: 'kv' }, h('span', {}, 'Endereço'), h('strong', {}, [e?.endereco, setorNome(e)].filter(Boolean).join(', '))),
          e?.cnpj ? h('div', { class: 'kv' }, h('span', {}, 'CNPJ'), h('strong', {}, formatarCNPJ(e.cnpj))) : null,
          h('div', { class: 'kv' }, h('span', {}, 'Atividade'), h('strong', {}, e?.moci && !e.cnae ? 'Edificação cadastrada no MOCI' : cnaeInfo(e?.cnae).desc)),
          h('div', { class: 'kv' }, h('span', {}, 'Situação no cadastro'), h('strong', {}, `${SITUACAO_NOME[e?.situacao_doc] || 'Não verificado'}${e?.validade_doc ? ` até ${fmtDate(e.validade_doc)}` : ''}`)),
          h('div', { class: 'kv' }, h('span', {}, 'Última fiscalização'), h('strong', {}, e?.ultima_fiscalizacao ? `${fmtDate(e.ultima_fiscalizacao)}${e.ultimo_resultado ? `, ${RESULTADO_NOME[e.ultimo_resultado].toLowerCase()}` : ''}` : 'Nunca')),
          sc ? h('div', { class: 'kv' }, h('span', {}, 'Escore atual'), h('strong', {}, `${sc.score} de 100`)) : null,
          linhasMoci(e).map(([k, v]) => h('div', { class: 'kv' }, h('span', {}, k), h('strong', {}, v))),
          e?.moci_id ? h('a', { href: `${MOCI_SITE}?editar=${encodeURIComponent(e.moci_id)}`, target: '_blank', rel: 'noopener', class: 'small' }, 'Abrir esta edificação no MOCI') : null,
          exec.length ? h('h4', {}, 'Execução') : null, exec, fotos,
          hist.length ? h('h4', {}, 'Visitas anteriores') : null,
          hist.length ? h('ul', { class: 'plain' }, hist.map((x) => h('li', {}, `${fmtDate(x.data)}: ${RESULTADO_NOME[x.checkout.resultado] || STATUS[x.status]} (${nomeV(x.vistoriador_id)})`))) : null),
        h('div', { class: 'detail-col form-grid one' },
          field('Vistoriador', selV), field('Data', inData), field('Prioridade', selP), field('Prazo', inPrazo), field('Nº do processo', inProc), field('Orientações para a equipe', taNotas))),
      actions: [
        h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { if (await confirmar('Excluir esta missão?', { ok: 'Excluir', kind: 'danger' })) { st.excluirMissao(m.id); sh.close(); toast('Missão excluída.'); } } }, 'Excluir'),
        h('button', { class: 'btn', type: 'button', onclick: () => { sh.close(); focarMissao(m); } }, 'Ver no mapa'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
          st.editarMissao(m.id, { vistoriador_id: selV.value || null, data: selV.value ? inData.value : null, prioridade: selP.value, prazo: inPrazo.value || null, processo: inProc.value.trim() || null, notas: taNotas.value.trim() });
          sh.close(); toast('Missão salva.', 'ok');
        } }, 'Salvar'),
      ],
    });
  }

  // ---------- nova missão ----------
  function novaMissao(pre = {}) {
    const d = { tipo: 'regularizacao', prioridade: 'media', ...pre };
    let escolhido = pre.estab_id ? st.estab(pre.estab_id) : null;
    const pos = escolhido ? { lat: escolhido.lat, lng: escolhido.lng } : null;
    const f = {
      tipo: select(Object.entries(TIPOS).filter(([k]) => k !== 'encaixe').map(([k, t]) => [k, t.nome]), d.tipo),
      prioridade: select(Object.entries(PRIORIDADES), d.prioridade),
      processo: h('input', { placeholder: 'Ex.: SAC 2026.012345' }),
      prazo: h('input', { type: 'date' }),
      busca: h('input', { type: 'search', placeholder: 'Nome ou CNPJ na base', autocomplete: 'off' }),
      nome: h('input', { value: escolhido?.nome || '' }),
      cnpj: h('input', { value: escolhido?.cnpj || '', inputmode: 'numeric' }),
      endereco: h('input', { value: escolhido?.endereco || '' }),
      vist: select(opcoesVist(true), ''),
      data: h('input', { type: 'date', value: ui.data }),
      notas: h('textarea', { rows: 3 }),
    };
    const resultados = h('div', { class: 'results' });
    const infoLocal = h('p', { class: 'hint' }, 'Toque no mapa para marcar o local, ou busque o endereço.');
    const mini = h('div', { class: 'minimap' });
    let mm, mk;
    const setPos = (ll, centrar = true) => {
      const p = { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) };
      Object.assign(posAtual, p);
      if (!mk) mk = L.marker([p.lat, p.lng], { draggable: true, icon: iconePonto() }).addTo(mm).on('dragend', () => setPos(mk.getLatLng(), false));
      else mk.setLatLng([p.lat, p.lng]);
      if (centrar) mm.setView([p.lat, p.lng], Math.max(mm.getZoom(), 16));
      const s = st.setorDoPonto(p);
      const vEsc = s ? st.escalaDo(f.data.value)[s.id] : '';
      infoLocal.textContent = s ? `Setor ${s.nome}${vEsc ? `: ${nomeV(vEsc)} escalado neste dia` : ': ninguém escalado neste dia'}.` : 'Fora dos setores cadastrados.';
      if (vEsc && !f.vist.dataset.mexido) f.vist.value = vEsc;
    };
    const posAtual = pos ? { ...pos } : {};
    f.vist.addEventListener('change', () => { f.vist.dataset.mexido = '1'; });

    f.busca.addEventListener('input', debounce(() => {
      const q = f.busca.value.trim().toLowerCase(); const dig = q.replace(/\D/g, '');
      clear(resultados);
      if (q.length < 2) return;
      const achados = S().estabelecimentos.filter((e) => e.nome.toLowerCase().includes(q) || (dig.length >= 4 && e.cnpj.includes(dig))).slice(0, 6);
      if (!achados.length) { resultados.append(h('p', { class: 'muted small' }, 'Nada na base. Preencha os dados abaixo.')); return; }
      achados.forEach((e) => resultados.append(h('button', { class: 'pick', type: 'button', onclick: () => {
        escolhido = e; f.nome.value = e.nome; f.cnpj.value = formatarCNPJ(e.cnpj); f.endereco.value = e.endereco || ''; clear(resultados); f.busca.value = '';
        setPos({ lat: e.lat, lng: e.lng });
      } }, h('strong', {}, e.nome), h('span', { class: 'muted small' }, `${e.endereco || ''}, ${setorNome(e)}`))));
    }, 200));
    [f.nome, f.cnpj, f.endereco].forEach((i) => i.addEventListener('input', () => { escolhido = null; }));

    const btnBuscar = h('button', { class: 'btn btn-small', type: 'button', onclick: async () => {
      const q = f.endereco.value.trim(); if (!q) { toast('Digite o endereço para buscar.', 'warn'); return; }
      btnBuscar.disabled = true; btnBuscar.textContent = 'Buscando…';
      try { const r = await geocodificar(q); if (!r.length) toast('Endereço não encontrado. Marque no mapa.', 'warn'); else { setPos(r[0]); toast('Ponto aproximado. Confira e arraste o marcador se precisar.'); } }
      catch (err) { toast(err.message || 'Busca indisponível. Marque no mapa.', 'warn'); }
      finally { btnBuscar.disabled = false; btnBuscar.textContent = 'Buscar endereço no mapa'; }
    } }, 'Buscar endereço no mapa');

    sheet({
      title: 'Nova missão', wide: true,
      body: h('div', { class: 'detail' },
        h('div', { class: 'detail-col form-grid one' },
          field('Tipo', f.tipo), field('Prioridade', f.prioridade), field('Nº do processo (SAC)', f.processo), field('Prazo', f.prazo),
          field('Procurar na base', f.busca), resultados,
          field('Nome do estabelecimento', f.nome), field('CNPJ', f.cnpj), field('Endereço', f.endereco), btnBuscar),
        h('div', { class: 'detail-col form-grid one' },
          h('span', { class: 'field-label' }, 'Localização'), mini, infoLocal,
          field('Vistoriador', f.vist), field('Data', f.data), field('Orientações para a equipe', f.notas))),
      actions: [{ label: 'Cancelar' }, { label: 'Criar missão', kind: 'primary', onClick: () => {
        if (!f.nome.value.trim()) { toast('Informe o nome do estabelecimento.', 'warn'); return false; }
        if (!isFinite(posAtual.lat)) { toast('Marque o local no mapa.', 'warn'); return false; }
        let e = escolhido;
        if (!e) e = st.novoEstabelecimento({ nome: f.nome.value.trim(), cnpj: f.cnpj.value.replace(/\D/g, ''), endereco: f.endereco.value.trim(), lat: posAtual.lat, lng: posAtual.lng, bairro: st.setorDoPonto(posAtual)?.nome || '' });
        else if (e.lat !== posAtual.lat || e.lng !== posAtual.lng) { e.lat = posAtual.lat; e.lng = posAtual.lng; }
        st.criarMissao({ estab_id: e.id, tipo: f.tipo.value, prioridade: f.prioridade.value, processo: f.processo.value.trim(), prazo: f.prazo.value || null, vistoriador_id: f.vist.value || null, data: f.data.value, notas: f.notas.value.trim() });
        toast(f.vist.value ? `Missão criada para ${nomeV(f.vist.value)}.` : 'Missão criada na fila.', 'ok');
      } }],
    });
    setTimeout(() => {
      mm = criarMapa(mini, { centro: pos || map.getCenter(), zoom: pos ? 16 : 13 });
      mm.on('click', (ev) => setPos(ev.latlng, false));
      if (pos) setPos(pos);
      setTimeout(() => mm.invalidateSize(), 80);
    }, 30);
  }

  // ---------- render do mapa ----------
  function renderMapa() {
    Object.entries(G).forEach(([k, g]) => { if (!['desenho', 'foco', 'base'].includes(k)) g.clearLayers(); });
    marcadores.clear();
    const esc = st.escalaDo(ui.data);

    // setores
    for (const s of S().setores) {
      const vid = esc[s.id];
      const cor = vid ? corV(vid) : CINZA;
      const poly = L.polygon(s.poligono, { color: cor, weight: vid ? 2 : 1.5, dashArray: vid ? null : '5 6', fillColor: cor, fillOpacity: vid ? 0.10 : 0.04 });
      poly.bindTooltip(s.nome, { permanent: true, direction: 'center', className: 'setor-label' });
      poly.bindPopup(() => popupSetor(s));
      G.setores.addLayer(poly);
    }

    // missões do dia + rotas
    for (const v of S().vistoriadores) {
      const lista = st.missoesDo(v.id, ui.data);
      if (!lista.length) continue;
      const pts = lista.map((m) => st.pontoMissao(m)).filter(Boolean);
      L.polyline([[S().config.base.lat, S().config.base.lng], ...pts.map((p) => [p.lat, p.lng])], { color: v.cor, weight: 2.5, opacity: 0.55, dashArray: '2 7', lineCap: 'round' }).addTo(G.rotas);
      lista.forEach((m) => {
        const p = st.pontoMissao(m); if (!p) return;
        const fora = m.checkin && !m.checkin.dentro;
        const mk = L.marker([p.lat, p.lng], { icon: iconeMissao(m.ordem, v.cor, m.status, fora), riseOnHover: true, zIndexOffset: m.status === 'no_local' ? 500 : 0 });
        mk.bindPopup(() => popupMissao(m), { minWidth: 220 });
        G.missoes.addLayer(mk);
        marcadores.set(m.id, mk);
        if (fora) L.polyline([[p.lat, p.lng], [m.checkin.lat, m.checkin.lng]], { color: '#B42318', weight: 1.5, dashArray: '3 5' }).addTo(G.rotas);
      });
    }

    // fila
    for (const m of st.fila()) {
      const p = st.pontoMissao(m); if (!p) continue;
      const mk = L.marker([p.lat, p.lng], { icon: iconeFila(m.prioridade) });
      mk.bindPopup(() => popupMissao(m), { minWidth: 220 });
      G.fila.addLayer(mk);
      marcadores.set(m.id, mk);
    }

    // sugestões
    if (ui.camadas.sugestoes) {
      sugCache.slice(0, 80).forEach((s) => {
        const mk = L.marker([s.estab.lat, s.estab.lng], { icon: iconeSugestao(s.score, s.info.cat?.cor) });
        mk.bindPopup(() => popupSugestao(s), { minWidth: 240 });
        G.sugestoes.addLayer(mk);
        marcadores.set('sug-' + s.estab.id, mk);
      });
    }

    // locais de eventos
    for (const l of S().locais) {
      const prox = S().eventos.filter((e) => e.local_id === l.id && diffDays(e.fim || e.inicio, today()) >= 0).sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
      const alerta = prox && prox.status === 'nao_recebido' && diffDays(prox.inicio, today()) <= 15;
      const mk = L.marker([l.lat, l.lng], { icon: iconeLocal(alerta) });
      mk.bindPopup(() => h('div', { class: 'pop' }, h('strong', {}, l.nome),
        h('div', { class: 'muted small' }, `Capacidade autorizada: ${l.capacidade ? l.capacidade.toLocaleString('pt-BR') : 'não informada'}`),
        prox ? h('div', {}, `Próximo: ${prox.nome}, ${fmtDate(prox.inicio, { short: true })} (${STATUS_EVENTO_NOME[prox.status]})`) : h('div', { class: 'muted small' }, 'Sem evento futuro na agenda'),
        h('div', { class: 'row gap' }, h('button', { class: 'btn btn-small', type: 'button', onclick: () => editarLocal(l) }, 'Ficha do local'))));
      G.locais.addLayer(mk);
    }

    // sede
    const b = S().config.base;
    L.marker([b.lat, b.lng], { icon: iconeBase(), zIndexOffset: -100 }).bindTooltip('Base (ponto de partida das rotas)').addTo(G.sede);

    if (ui.camadas.base) renderBasePublica();
    aplicarCamadas();
    renderLegenda();
  }

  function renderBasePublica() {
    G.base.clearLayers();
    for (const e of S().estabelecimentos) {
      if (e.ativo === false) continue;
      const c = cnaeInfo(e.cnae);
      const cm = L.circleMarker([e.lat, e.lng], { radius: 4, weight: 1, color: '#fff', fillColor: c.cat?.cor || CINZA, fillOpacity: 0.85 });
      cm.bindPopup(() => popupEstab(e), { minWidth: 220 });
      G.base.addLayer(cm);
    }
  }

  function renderLegenda() {
    const esc = st.escalaDo(ui.data);
    const ativos = S().vistoriadores.filter((v) => Object.values(esc).includes(v.id) || st.missoesDo(v.id, ui.data).length);
    mount(legenda,
      ativos.map((v) => h('span', { class: 'leg' }, h('span', { class: 'leg-dot', style: { background: v.cor } }), v.nome)),
      h('span', { class: 'leg' }, h('span', { class: 'leg-fila' }), 'Fila'),
      ui.camadas.sugestoes ? h('span', { class: 'leg' }, h('span', { class: 'leg-sug' }), 'Sugestão') : null);
  }

  function popupSetor(s) {
    const vid = st.escalaDo(ui.data)[s.id] || '';
    const nFila = st.fila().filter((m) => st.setorDoPonto(st.pontoMissao(m))?.id === s.id).length;
    return h('div', { class: 'pop' }, h('strong', {}, `Setor ${s.nome}`),
      h('div', { class: 'muted small' }, fmtDate(ui.data, { long: true })),
      field('Equipe', select([['', 'Sem equipe'], ...opcoesVist(false)], vid, { onchange: (e) => { st.definirEscala(ui.data, s.id, e.target.value); map.closePopup(); } })),
      h('div', {}, nFila ? `${nFila} missão(ões) na fila neste setor` : 'Fila vazia neste setor'),
      vid && nFila ? h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => { const n = st.atribuirFilaDoSetor(s.id, ui.data); map.closePopup(); toast(n ? `${n} missão(ões) atribuídas a ${nomeV(vid)}.` : 'Capacidade do dia já preenchida.', n ? 'ok' : 'info'); } }, 'Atribuir a fila do setor') : null);
  }

  function popupMissao(m) {
    const e = st.estab(m.estab_id);
    return h('div', { class: 'pop' },
      h('strong', {}, e?.nome || ''),
      h('div', { class: 'muted small' }, `${TIPOS[m.tipo]?.nome}${m.prazo ? `, prazo ${relDays(m.prazo)}` : ''}`),
      h('div', {}, m.vistoriador_id ? `${nomeV(m.vistoriador_id)}, parada ${m.ordem}: ${statusTexto(m)}` : 'Na fila'),
      !m.vistoriador_id ? field('Atribuir a', select([['', 'Escolha…'], ...opcoesVist(false)], '', { onchange: (ev) => { if (ev.target.value) { st.atribuir(m.id, ev.target.value, ui.data); map.closePopup(); toast(`Atribuída a ${nomeV(ev.target.value)}.`, 'ok'); } } })) : null,
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => { map.closePopup(); abrirMissao(m); } }, 'Detalhes'));
  }

  function popupSugestao(s) {
    return h('div', { class: 'pop' },
      h('strong', {}, s.estab.nome), h('div', { class: 'muted small' }, `${s.info.desc}. Escore ${s.score}`),
      h('table', { class: 'breakdown' }, s.partes.map((p) => h('tr', {}, h('td', {}, p.criterio), h('td', {}, p.motivo), h('td', { class: 'num' }, `${Math.round(p.pontos)}/${p.max}`)))),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn btn-small', type: 'button', onclick: () => { map.closePopup(); rejeitar(s.estab); } }, 'Rejeitar'),
        h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => { map.closePopup(); aceitar(s.estab, s.score); } }, 'Aceitar')));
  }

  function popupEstab(e) {
    const sc = scoreDe(S(), e);
    return h('div', { class: 'pop' },
      h('strong', {}, e.nome), h('div', { class: 'muted small' }, `${sc.info.desc}. ${SITUACAO_NOME[e.situacao_doc] || ''}`),
      h('div', { class: 'small' }, e.ultima_fiscalizacao ? `Última fiscalização: ${fmtDate(e.ultima_fiscalizacao)}` : 'Nunca fiscalizado'),
      h('div', { class: 'small' }, `Escore ${sc.score}`),
      e.moci ? h('div', { class: 'small' }, linhasMoci(e).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join('. ')) : null,
      h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => { map.closePopup(); novaMissao({ estab_id: e.id, tipo: 'fiscalizacao' }); } }, 'Criar missão'));
  }

  // ---------- desenho de setores ----------
  function iniciarDesenho() {
    ui.desenho = { pontos: [] };
    mount(faixaMapa,
      h('span', {}, 'Toque no mapa para marcar os vértices do setor.'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => { ui.desenho.pontos.pop(); desenharRascunho(); } }, 'Desfazer ponto'),
      h('button', { class: 'btn btn-small', type: 'button', onclick: () => { ui.desenho = null; G.desenho.clearLayers(); faixaMapa.hidden = true; mapaEl.classList.remove('drawing'); } }, 'Cancelar'),
      h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => concluirDesenho() }, 'Concluir setor'));
    faixaMapa.hidden = false;
    map.closePopup();
    mapaEl.classList.add('drawing');
  }
  function desenharRascunho() {
    G.desenho.clearLayers();
    const pts = ui.desenho?.pontos || [];
    if (pts.length >= 2) L.polygon(pts, { color: '#C8102E', weight: 2, dashArray: '4 4', fillOpacity: 0.08 }).addTo(G.desenho);
    pts.forEach((p) => L.circleMarker(p, { radius: 5, color: '#C8102E', fillColor: '#fff', fillOpacity: 1 }).addTo(G.desenho));
  }
  function concluirDesenho() {
    const pts = ui.desenho?.pontos || [];
    if (pts.length < 3) { toast('Marque pelo menos 3 pontos.', 'warn'); return; }
    const inNome = h('input', { placeholder: 'Ex.: Areia Branca e Vila Eduardo' });
    sheet({
      title: 'Nome do setor', body: field('Nome', inNome),
      actions: [{ label: 'Cancelar' }, { label: 'Salvar setor', kind: 'primary', onClick: () => {
        if (!inNome.value.trim()) { toast('Dê um nome ao setor.', 'warn'); return false; }
        st.salvarSetor({ nome: inNome.value.trim(), poligono: pts });
        ui.desenho = null; G.desenho.clearLayers(); faixaMapa.hidden = true; mapaEl.classList.remove('drawing');
        toast('Setor salvo.', 'ok');
      } }],
    });
  }

  // ---------- ajustes ----------
  function abrirAjustes() {
    const c = S().config;
    const f = {
      unidade: h('input', { value: c.unidade }),
      raio: h('input', { type: 'number', min: 30, max: 1000, value: c.raio_checkin }),
      cap: h('input', { type: 'number', min: 1, max: 30, value: c.capacidade_dia }),
      prazo: h('input', { type: 'number', min: 0, max: 180, value: c.prazo_retorno_dias }),
      cs: h('input', { type: 'number', min: 0, max: 100, value: c.cotas.solicitada }),
      cu: h('input', { type: 'number', min: 0, max: 100, value: c.cotas.urgencia }),
      cp: h('input', { type: 'number', min: 0, max: 100, value: c.cotas.proativa }),
    };
    const equipe = h('div', { class: 'stack' }, S().vistoriadores.map((v) => linhaVistoriador(v)));
    const setores = h('div', { class: 'stack' }, S().setores.map((s) => h('div', { class: 'row gap' },
      h('span', { class: 'swatch', style: { borderColor: CINZA } }),
      h('input', { value: s.nome, 'aria-label': 'Nome do setor', onchange: (e) => st.salvarSetor({ id: s.id, nome: e.target.value.trim() || s.nome }) }),
      h('button', { class: 'btn btn-small btn-danger', type: 'button', onclick: async () => { if (await confirmar(`Excluir o setor ${s.nome}?`, { ok: 'Excluir', kind: 'danger' })) { st.excluirSetor(s.id); sh.close(); abrirAjustes(); } } }, 'Excluir'))));
    const inGeo = h('input', { type: 'file', accept: '.geojson,.json', hidden: true, onchange: (e) => lerArquivo(e.target.files[0], (txt) => importarSetores(txt)) });
    const inBase = h('input', { type: 'file', accept: '.geojson,.json', hidden: true, onchange: (e) => lerArquivo(e.target.files[0], (txt) => importarBase(txt)) });
    const inBackup = h('input', { type: 'file', accept: '.json', hidden: true, onchange: (e) => lerArquivo(e.target.files[0], (txt) => { try { st.importarJSON(txt); toast('Backup restaurado.', 'ok'); sh.close(); } catch (err) { toast(err.message, 'warn'); } }) });

    const sh = sheet({
      title: 'Ajustes', wide: true,
      body: h('div', { class: 'settings' },
        h('section', {}, h('h3', {}, 'Regras de operação'),
          h('div', { class: 'form-grid' },
            field('Nome da unidade (aparece no relatório)', f.unidade),
            field('Raio do check-in (metros)', f.raio, 'Check-in fora desse raio exige justificativa.'),
            field('Missões por vistoriador por dia', f.cap),
            field('Prazo do retorno após notificação (dias)', f.prazo, 'Use 0 para não criar retornos automáticos.'),
            field('Cota: demanda solicitada (%)', f.cs), field('Cota: urgência administrativa (%)', f.cu), field('Cota: proativa (%)', f.cp)),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => {
            st.salvarConfig({ unidade: f.unidade.value.trim() || c.unidade, raio_checkin: +f.raio.value || 150, capacidade_dia: +f.cap.value || 7, prazo_retorno_dias: +f.prazo.value || 0, cotas: { solicitada: +f.cs.value || 0, urgencia: +f.cu.value || 0, proativa: +f.cp.value || 0 } });
            toast('Regras salvas.', 'ok');
          } }, 'Salvar regras'),
          h('button', { class: 'btn', type: 'button', onclick: () => { sh.close(); abrirCriterios(); } }, 'Critérios das sugestões')),
        h('section', {}, h('h3', {}, 'Equipe'), equipe,
          h('button', { class: 'btn', type: 'button', onclick: () => { st.salvarVistoriador({ nome: 'Novo vistoriador', cor: '#DB2777' }); sh.close(); abrirAjustes(); } }, 'Adicionar vistoriador')),
        h('section', {}, h('h3', {}, 'Setores'),
          h('p', { class: 'hint' }, 'Os setores de exemplo são ilustrativos. Desenhe os reais (por bairros ou setores censitários) ou importe um GeoJSON exportado do QGIS.'),
          setores,
          h('div', { class: 'row gap wrap' },
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { sh.close(); iniciarDesenho(); } }, 'Desenhar setor no mapa'),
            h('button', { class: 'btn', type: 'button', onclick: () => inGeo.click() }, 'Importar GeoJSON'), inGeo)),
        h('section', {}, h('h3', {}, 'Base de partida das rotas'),
          h('p', { class: 'hint' }, 'Ponto de onde as equipes saem. Usado para ordenar os roteiros.'),
          h('button', { class: 'btn', type: 'button', onclick: () => { sh.close(); ui.escolhendoBase = true; map.closePopup(); mapaEl.classList.add('drawing'); mount(faixaMapa, h('span', {}, 'Toque no mapa para posicionar a base.'), h('button', { class: 'btn btn-small', type: 'button', onclick: () => { ui.escolhendoBase = false; faixaMapa.hidden = true; mapaEl.classList.remove('drawing'); } }, 'Cancelar')); faixaMapa.hidden = false; } }, 'Posicionar base no mapa')),
        h('section', {}, h('h3', {}, 'MOCI'),
          h('p', { class: 'hint' }, 'Lê as edificações cadastradas no MOCI (só leitura; nada é gravado lá). Atualiza sozinho ao abrir o painel, no máximo a cada 30 minutos.'),
          (() => {
            const c = st.configMoci();
            const inCid = h('input', { value: c.cidades, placeholder: 'Petrolina' });
            const inUrl = h('input', { value: c.url });
            return h('div', { class: 'stack' },
              h('div', { class: 'form-grid' }, field('Cidades (separe por vírgula; * para todas)', inCid), field('Endereço da consulta do MOCI', inUrl)),
              h('div', { class: 'row gap wrap' },
                h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { st.salvarConfig({ moci_cidades: inCid.value.trim(), moci_url: inUrl.value.trim() }); toast('Configuração do MOCI salva.', 'ok'); sincronizarMoci(); } }, 'Salvar e atualizar')));
          })()),
        h('section', {}, h('h3', {}, 'Dados'),
          h('p', { class: 'hint' }, `Base de estabelecimentos: ${S().estabelecimentos.length} registros. Missões: ${S().missoes.length}.`),
          h('div', { class: 'row gap wrap' },
            h('button', { class: 'btn', type: 'button', onclick: () => inBase.click() }, 'Importar base pública (GeoJSON da rotina mensal)'), inBase,
            h('button', { class: 'btn', type: 'button', onclick: () => baixar(`fiscaliza-backup-${today()}.json`, st.exportarJSON()) }, 'Baixar backup'),
            h('button', { class: 'btn', type: 'button', onclick: () => inBackup.click() }, 'Restaurar backup'), inBackup,
            S().modo === 'demo' ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { if (await confirmar('Apagar tudo e voltar aos dados de exemplo?', { ok: 'Restaurar exemplo', kind: 'danger' })) { st.resetDemo(); sh.close(); toast('Dados de exemplo restaurados.', 'ok'); } } }, 'Restaurar dados de exemplo') : null))),
    });
  }

  function linhaVistoriador(v) {
    return h('div', { class: 'row gap' },
      h('input', { type: 'color', value: v.cor, 'aria-label': `Cor de ${v.nome}`, onchange: (e) => st.salvarVistoriador({ id: v.id, cor: e.target.value }) }),
      h('input', { value: v.nome, 'aria-label': 'Nome', onchange: (e) => st.salvarVistoriador({ id: v.id, nome: e.target.value.trim() || v.nome }) }),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: v.ativo !== false, onchange: (e) => st.salvarVistoriador({ id: v.id, ativo: e.target.checked }) }), 'Ativo'));
  }

  function lerArquivo(file, cb) { if (!file) return; const r = new FileReader(); r.onload = () => cb(String(r.result)); r.readAsText(file); }
  function baixar(nome, txt) { const a = h('a', { href: URL.createObjectURL(new Blob([txt], { type: 'application/json' })), download: nome }); document.body.append(a); a.click(); a.remove(); }

  function importarSetores(txt) {
    try {
      const gj = JSON.parse(txt);
      const feats = gj.type === 'FeatureCollection' ? gj.features : [gj];
      let n = 0;
      feats.forEach((ft, i) => {
        const g = ft.geometry || ft; if (!g) return;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
        polys.forEach((poly, j) => {
          const ring = poly[0].map(([lng, lat]) => [+lat.toFixed(6), +lng.toFixed(6)]);
          const p = ft.properties || {};
          st.salvarSetor({ nome: String(p.nome || p.NOME || p.name || p.NM_BAIRRO || p.bairro || `Setor ${i + 1}${polys.length > 1 ? `.${j + 1}` : ''}`), poligono: ring });
          n++;
        });
      });
      toast(`${n} setor(es) importado(s).`, 'ok');
    } catch { toast('GeoJSON inválido.', 'warn'); }
  }

  function importarBase(txt) {
    try {
      const gj = JSON.parse(txt);
      const lista = (gj.features || []).map((ft) => ({ ...ft.properties, lng: ft.geometry?.coordinates?.[0], lat: ft.geometry?.coordinates?.[1] }));
      const r = st.importarEstabelecimentos(lista);
      G.base.clearLayers();
      toast(`Base importada: ${r.novos} novos, ${r.atual} atualizados.`, 'ok');
    } catch { toast('Arquivo inválido. Use o GeoJSON gerado pela rotina mensal.', 'warn'); }
  }

  // ---------- início ----------
  st.on(() => { G.base.clearLayers(); render(); });
  render();
  const ultimo = st.configMoci().sync?.ts || 0;
  if (Date.now() - ultimo > 30 * 60000) setTimeout(() => sincronizarMoci({ silencioso: true }), 600);
  map.fitBounds(L.latLngBounds(S().setores.filter((s) => s.id !== 's7' || S().setores.length < 3).flatMap((s) => s.poligono)), { padding: [20, 20] });
  return { map };
}

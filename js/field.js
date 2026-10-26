// App do vistoriador (celular): roteiro do dia, navegação, check-in por geolocalização, resultado e encaixes.
/* global L */
import * as st from './store.js';
import { h, mount, clear, sheet, toast, field, select, today, fmtDate, fmtTime, fmtDist, relDays, diffDays, confirmar } from './ui.js';
import { TIPOS, STATUS, RESULTADOS, RESULTADO_NOME, SITUACAO_DOC, SITUACAO_NOME, formatarCNPJ } from './dominio.js';
import { gerarSugestoes, cnaeInfo } from './score.js';
import { criarMapa, iconeMissao, iconeBase, iconeEu } from './map.js';
import { dist, linkMaps, linkWaze, extensaoRota } from './geo.js';
import { salvarFoto, fotoURL } from './fotos.js';
import { marca } from './marca.js';
import { linhasMoci } from './moci.js';

const MOTIVOS_NAO_REALIZADA = ['Sem tempo hoje', 'Viatura indisponível', 'Endereço inacessível', 'Remanejado pelo oficial', 'Outro'];
const RAIO_PERTO = 700;

export function iniciarCampo(root, { vid, sair }) {
  const v = st.vist(vid);
  if (!v) { sair(); return; }
  const ui = { aba: 'roteiro', pos: null, simular: false, posSim: null, watch: null, erroGps: null, sheetAberta: null };
  const ouvintesPos = new Set();
  const S = () => st.S();
  const demo = S().modo === 'demo';
  const hoje = () => today();
  const raio = () => S().config.raio_checkin || 150;

  // ---------- estrutura ----------
  const conn = h('button', { class: 'conn', type: 'button', onclick: () => { const n = st.sincronizar(); toast(n ? `${n} registro(s) enviados.` : navigator.onLine ? 'Tudo enviado.' : 'Sem sinal. Os registros ficam guardados e são enviados quando a conexão voltar.'); atualizarConn(); } });
  const main = h('main', { class: 'campo-main' });
  const nav = h('nav', { class: 'campo-nav' }, [['roteiro', 'Roteiro', 'M4 6h16M4 12h16M4 18h10'], ['mapa', 'Mapa', 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14'], ['perto', 'Perto de mim', 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21zm0-9a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z']].map(([k, l, d]) => h('button', {
    type: 'button', class: 'nav-btn', dataset: { aba: k }, onclick: () => { ui.aba = k; render(); },
  }, icone(d), h('span', {}, l))));
  const chkSim = h('input', { type: 'checkbox', onchange: (e) => { ui.simular = e.target.checked; if (ui.simular) { toast('Simulação ligada: toque no mapa (aba Mapa) para definir sua posição.'); ui.aba = 'mapa'; render(); } else { ui.posSim = null; emitirPos(); } } });
  const demoBar = demo ? h('div', { class: 'demo-bar' }, h('span', {}, 'Demonstração: os dados ficam só neste aparelho.'), h('label', { class: 'check' }, chkSim, 'Simular GPS')) : null;

  mount(root, h('div', { class: 'campo', style: { '--c': v.cor } },
    h('header', { class: 'campo-top' },
      marca(30),
      h('div', { class: 'who' }, h('strong', {}, v.nome), h('span', {}, fmtDate(hoje(), { long: true }))),
      conn,
      h('button', { class: 'icon-btn on-dark', type: 'button', 'aria-label': 'Trocar perfil', title: 'Trocar perfil', onclick: sair }, icone('M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10'))),
    demoBar, main, nav));

  function icone(d) {
    const ns = 'http://www.w3.org/2000/svg';
    const s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'ico');
    const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    s.append(p); return s;
  }

  // ---------- conexão e envio ----------
  function atualizarConn() {
    const n = st.pendentesEnvio(vid);
    const on = navigator.onLine;
    conn.className = `conn ${on ? (n ? 'conn-sync' : 'conn-ok') : 'conn-off'}`;
    conn.textContent = on ? (n ? `Enviando ${n}` : 'Online') : (n ? `Sem sinal: ${n} aguardando` : 'Sem sinal');
  }
  window.addEventListener('online', () => { setTimeout(() => { const n = st.sincronizar(); if (n) toast(`Conexão de volta: ${n} registro(s) enviados.`, 'ok'); atualizarConn(); }, 800); });
  window.addEventListener('offline', () => { atualizarConn(); toast('Sem sinal. Pode continuar: tudo fica guardado no aparelho.'); });
  setInterval(() => { if (navigator.onLine && st.pendentesEnvio(vid)) { st.sincronizar(); } atualizarConn(); }, 8000);

  // ---------- geolocalização ----------
  function emitirPos() { ouvintesPos.forEach((f) => { try { f(posAtual()); } catch (e) { console.error(e); } }); }
  function posAtual() { return ui.simular && ui.posSim ? { ...ui.posSim, precisao: 5, simulado: true } : ui.pos; }
  function ligarGPS() {
    if (ui.watch !== null || !('geolocation' in navigator)) return;
    ui.watch = navigator.geolocation.watchPosition((p) => {
      ui.pos = { lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy, ts: p.timestamp };
      ui.erroGps = null; emitirPos();
    }, (err) => { ui.erroGps = err.code === 1 ? 'negado' : 'indisponivel'; emitirPos(); }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  }
  function obterPosicao() {
    if (ui.simular) {
      if (ui.posSim) return Promise.resolve(posAtual());
      return Promise.reject(new Error('Simulação ligada: toque no mapa para definir sua posição.'));
    }
    if (!('geolocation' in navigator)) return Promise.reject(new Error('Este aparelho não oferece geolocalização.'));
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition((p) => {
        ui.pos = { lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy, ts: p.timestamp };
        emitirPos(); ligarGPS(); resolve(ui.pos);
      }, (err) => {
        reject(new Error(err.code === 1 ? 'A localização está bloqueada. Libere o acesso à localização para este site nas configurações do navegador.' : 'Não foi possível obter sua posição. Vá para um local aberto e tente de novo.'));
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
    });
  }
  if (navigator.permissions?.query) navigator.permissions.query({ name: 'geolocation' }).then((r) => { if (r.state === 'granted') ligarGPS(); }).catch(() => {});

  // ---------- render ----------
  function render() {
    nav.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.aba === ui.aba));
    atualizarConn();
    ouvintesPos.forEach((f) => { if (f.view) ouvintesPos.delete(f); });
    if (ui.aba === 'roteiro') mount(main, telaRoteiro());
    if (ui.aba === 'mapa') { mount(main, telaMapa()); }
    if (ui.aba === 'perto') { mount(main, telaPerto()); ligarGPS(); }
  }

  const minhas = () => st.missoesDo(vid, hoje());

  function telaRoteiro() {
    const lista = minhas();
    const feitas = lista.filter((m) => ['concluida', 'nao_realizada'].includes(m.status)).length;
    const proxima = lista.find((m) => m.status === 'no_local') || lista.find((m) => m.status === 'pendente');
    const km = extensaoRota(S().config.base, lista.map(st.pontoMissao).filter(Boolean)) / 1000;
    const meusPedidos = S().solicitacoes.filter((q) => q.vistoriador_id === vid && q.data === hoje());
    return h('div', { class: 'stack pad' },
      h('section', { class: 'resumo' },
        h('div', { class: 'resumo-n' }, h('strong', {}, `${feitas}`), h('span', {}, ` de ${lista.length}`)),
        h('div', { class: 'grow' },
          h('div', {}, lista.length ? (feitas === lista.length ? 'Roteiro concluído.' : `Próxima: ${st.estab(proxima?.estab_id)?.nome || ''}`) : 'Nenhuma missão para hoje.'),
          lista.length ? h('div', { class: 'muted small' }, `Rota estimada de ${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km saindo da base`) : h('div', { class: 'muted small' }, 'Fale com o oficial de serviço se isso não estiver certo.')),
        lista.length ? h('div', { class: 'progress' }, h('span', { style: { width: `${(feitas / lista.length) * 100}%` } })) : null),
      h('ol', { class: 'roteiro' }, lista.map((m) => cartao(m))),
      meusPedidos.length ? h('section', { class: 'block' }, h('h3', {}, 'Encaixes pedidos hoje'),
        meusPedidos.map((q) => h('div', { class: 'row between' }, h('span', {}, st.estab(q.estab_id)?.nome || ''), h('span', { class: `tag ${q.status === 'aprovado' ? 'tag-ok' : q.status === 'recusado' ? 'tag-alta' : 'tag-warn'}` }, q.status === 'pendente' ? 'Aguardando oficial' : q.status === 'aprovado' ? 'Aprovado' : 'Recusado')))) : null);
  }

  function cartao(m) {
    const e = st.estab(m.estab_id);
    const stx = m.status === 'concluida' ? `Concluída às ${fmtTime(m.checkout?.ts)}` : m.status === 'no_local' ? `No local desde ${fmtTime(m.checkin?.ts)}` : STATUS[m.status];
    return h('li', { class: `rcard st-${m.status}` },
      h('button', { type: 'button', class: 'rcard-btn', onclick: () => abrirMissao(m) },
        h('span', { class: 'rnum' }, m.status === 'concluida' ? '✓' : String(m.ordem || '')),
        h('span', { class: 'grow' },
          h('span', { class: 'rname' }, e?.nome || ''),
          h('span', { class: 'raddr' }, e?.endereco || ''),
          h('span', { class: 'mmeta' }, TIPOS[m.tipo]?.nome, m.prioridade === 'alta' ? h('span', { class: 'tag tag-alta' }, 'Alta') : null, h('span', { class: `status s-${m.status}` }, stx)))));
  }

  // ---------- mapa ----------
  let mapa = null;
  function telaMapa() {
    if (mapa) { mapa.remove(); mapa = null; }
    const el = h('div', { class: 'map campo-map' });
    const info = h('div', { class: 'map-float' });
    const wrap = h('div', { class: 'campo-mapwrap' }, el, info,
      h('button', { class: 'fab', type: 'button', 'aria-label': 'Centralizar em mim', onclick: async () => {
        try { const p = posAtual() || await obterPosicao(); mapa.flyTo([p.lat, p.lng], 17, { duration: 0.5 }); }
        catch (err) { toast(err.message, 'warn'); }
      } }, icone('M12 2v3m0 14v3M2 12h3m14 0h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z')));
    setTimeout(() => {
      mapa = criarMapa(el, { zoom: 14, zoomControl: false });
      const lista = minhas();
      const b = S().config.base;
      L.marker([b.lat, b.lng], { icon: iconeBase() }).addTo(mapa).bindTooltip('Base');
      const pts = lista.map((m) => ({ m, p: st.pontoMissao(m) })).filter((x) => x.p);
      L.polyline([[b.lat, b.lng], ...pts.map((x) => [x.p.lat, x.p.lng])], { color: v.cor, weight: 3, opacity: 0.6, dashArray: '2 8', lineCap: 'round' }).addTo(mapa);
      pts.forEach(({ m, p }) => {
        L.marker([p.lat, p.lng], { icon: iconeMissao(m.ordem, v.cor, m.status) }).addTo(mapa)
          .bindPopup(() => h('div', { class: 'pop' }, h('strong', {}, `${m.ordem}. ${st.estab(m.estab_id)?.nome || ''}`), h('div', { class: 'muted small' }, TIPOS[m.tipo]?.nome), h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => { mapa.closePopup(); abrirMissao(m); } }, 'Abrir missão')));
      });
      if (pts.length) mapa.fitBounds(L.latLngBounds([[b.lat, b.lng], ...pts.map((x) => [x.p.lat, x.p.lng])]), { padding: [40, 40] });
      let eu = null, circ = null;
      const desenharEu = (p) => {
        if (!p) { info.textContent = ui.simular ? 'Toque no mapa para definir sua posição simulada.' : ui.erroGps === 'negado' ? 'Localização bloqueada no navegador.' : 'Buscando sua posição…'; return; }
        if (!eu) { eu = L.marker([p.lat, p.lng], { icon: iconeEu(), zIndexOffset: 1000 }).addTo(mapa); circ = L.circle([p.lat, p.lng], { radius: p.precisao || 10, weight: 1, color: '#2563EB', fillOpacity: 0.08 }).addTo(mapa); }
        else { eu.setLatLng([p.lat, p.lng]); circ.setLatLng([p.lat, p.lng]); circ.setRadius(p.precisao || 10); }
        const prox = lista.find((m) => m.status === 'no_local') || lista.find((m) => m.status === 'pendente');
        info.textContent = prox ? `${st.estab(prox.estab_id)?.nome}: ${fmtDist(dist(p, st.pontoMissao(prox)))}${p.simulado ? ' (simulado)' : ''}` : 'Roteiro concluído.';
      };
      desenharEu.view = true;
      ouvintesPos.add(desenharEu);
      desenharEu(posAtual());
      mapa.on('click', (ev) => { if (ui.simular) { ui.posSim = { lat: ev.latlng.lat, lng: ev.latlng.lng }; emitirPos(); } });
      if (!ui.simular) ligarGPS();
      setTimeout(() => mapa.invalidateSize(), 60);
    }, 0);
    return wrap;
  }

  // ---------- perto de mim ----------
  function telaPerto() {
    const corpo = h('div', { class: 'stack' });
    const desenhar = (p) => {
      clear(corpo);
      if (!p) {
        corpo.append(h('p', { class: 'empty' }, ui.simular ? 'Defina sua posição simulada na aba Mapa.' : ui.erroGps === 'negado' ? 'A localização está bloqueada. Libere nas configurações do navegador para ver o que há por perto.' : 'Buscando sua posição…'),
          !ui.simular ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => obterPosicao().catch((e) => toast(e.message, 'warn')) }, 'Usar minha localização') : null);
        return;
      }
      const meusPend = new Set(S().solicitacoes.filter((q) => q.vistoriador_id === vid && q.status === 'pendente').map((q) => q.estab_id));
      const perto = gerarSugestoes(S()).map((s) => ({ ...s, d: dist(p, s.estab) })).filter((s) => s.d <= RAIO_PERTO).sort((a, b) => a.d - b.d).slice(0, 12);
      corpo.append(h('p', { class: 'hint' }, `Estabelecimentos prioritários num raio de ${RAIO_PERTO} m, ainda sem missão. Peça o encaixe e o oficial decide.${p.simulado ? ' Posição simulada.' : ''}`));
      if (!perto.length) { corpo.append(h('p', { class: 'empty' }, 'Nada prioritário por perto agora.')); return; }
      perto.forEach((s) => {
        const motivos = s.partes.filter((x) => x.pontos > 0 && x.criterio !== 'Ocupação').sort((a, b) => b.pontos - a.pontos).slice(0, 2).map((x) => x.motivo);
        const jaPedi = meusPend.has(s.estab.id) || s.pedido;
        corpo.append(h('div', { class: 'ncard' },
          h('div', { class: 'ndist' }, h('strong', {}, fmtDist(s.d))),
          h('div', { class: 'grow' },
            h('strong', {}, s.estab.nome),
            h('div', { class: 'muted small' }, [s.info.desc, ...motivos].join('. ')),
            h('div', { class: 'row gap' },
              h('a', { class: 'btn btn-small', href: linkMaps(s.estab), target: '_blank', rel: 'noopener' }, 'Navegar'),
              jaPedi ? h('span', { class: 'tag tag-warn' }, 'Encaixe pedido') : h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => pedirEncaixe(s.estab) }, 'Pedir encaixe')))));
      });
    };
    desenhar.view = true;
    ouvintesPos.add(desenhar);
    desenhar(posAtual());
    return h('div', { class: 'stack pad' }, corpo);
  }

  function pedirEncaixe(e) {
    const obs = h('textarea', { rows: 2, placeholder: 'Opcional. Ex.: fica ao lado da vistoria atual' });
    sheet({
      title: 'Pedir encaixe', body: h('div', { class: 'stack' }, h('p', {}, e.nome), field('Observação para o oficial', obs)),
      actions: [{ label: 'Cancelar' }, { label: 'Enviar pedido', kind: 'primary', onClick: () => { st.pedirEncaixe(e.id, vid, obs.value.trim()); toast('Pedido enviado ao oficial.', 'ok'); render(); } }],
    });
  }

  // ---------- missão ----------
  function abrirMissao(m) {
    const sh = sheet({ title: st.estab(m.estab_id)?.nome || 'Missão', body: h('div'), onClose: () => { ui.sheetAberta = null; ouvintesPos.forEach((f) => { if (f.sheet) ouvintesPos.delete(f); }); } });
    sh.el.classList.add('sheet-full');
    ui.sheetAberta = sh;
    desenharMissao(m.id, sh);
    if (m.status === 'pendente' && !ui.simular) ligarGPS();
  }

  function desenharMissao(id, sh) {
    ouvintesPos.forEach((f) => { if (f.sheet) ouvintesPos.delete(f); });
    const m = st.missao(id);
    if (!m) { sh.close(); return; }
    const e = st.estab(m.estab_id);
    const ultima = st.historico(m.estab_id).find((x) => x.id !== m.id);
    const alvo = st.pontoMissao(m);

    const leitura = h('div', { class: 'readout' });
    const btnCheckin = h('button', { class: 'btn btn-checkin', type: 'button', onclick: () => checkin(m, sh) }, 'Fazer check-in');
    const atualizarLeitura = (p) => {
      clear(leitura);
      if (!p) {
        leitura.className = 'readout';
        leitura.append(h('span', { class: 'readout-n' }, '—'), h('span', { class: 'readout-t' }, ui.simular ? 'Defina a posição simulada na aba Mapa' : ui.erroGps === 'negado' ? 'Localização bloqueada no navegador' : 'Toque em "Fazer check-in" para medir a distância'));
        return;
      }
      const d = dist(p, alvo);
      const ok = d <= raio();
      leitura.className = `readout ${ok ? 'readout-ok' : ''}`;
      leitura.append(h('span', { class: 'readout-n' }, ok ? 'No local' : fmtDist(d)), h('span', { class: 'readout-t' }, ok ? `A ${fmtDist(d)} do ponto cadastrado` : 'até o ponto cadastrado'), h('span', { class: 'readout-acc' }, p.simulado ? 'Posição simulada' : `GPS ±${Math.round(p.precisao || 0)} m`));
      btnCheckin.classList.toggle('pronto', ok);
      btnCheckin.textContent = ok ? 'Fazer check-in: você está no local' : 'Fazer check-in';
    };
    atualizarLeitura.sheet = true;

    const cabecalho = h('div', { class: 'stack' },
      h('div', { class: 'mmeta' }, h('span', { class: `status s-${m.status}` }, STATUS[m.status]), TIPOS[m.tipo]?.nome, m.prioridade === 'alta' ? h('span', { class: 'tag tag-alta' }, 'Alta') : null),
      h('div', { class: 'kv' }, h('span', {}, 'Endereço'), h('strong', {}, e?.endereco || '')),
      e?.cnpj ? h('div', { class: 'kv' }, h('span', {}, 'CNPJ'), h('strong', {}, formatarCNPJ(e.cnpj))) : null,
      h('div', { class: 'kv' }, h('span', {}, 'Atividade'), h('strong', {}, e?.moci && !e.cnae ? 'Edificação cadastrada no MOCI' : cnaeInfo(e?.cnae).desc)),
      linhasMoci(e).map(([k, v]) => h('div', { class: 'kv' }, h('span', {}, k), h('strong', {}, v))),
      m.processo ? h('div', { class: 'kv' }, h('span', {}, 'Processo'), h('strong', {}, m.processo)) : null,
      m.prazo ? h('div', { class: 'kv' }, h('span', {}, 'Prazo'), h('strong', { class: diffDays(m.prazo, today()) < 0 ? 'txt-danger' : '' }, `${fmtDate(m.prazo)} (${relDays(m.prazo)})`)) : null,
      m.notas ? h('p', { class: 'note' }, m.notas) : null,
      h('div', { class: 'kv' }, h('span', {}, 'Última visita'), h('strong', {}, ultima ? `${fmtDate(ultima.data)}: ${RESULTADO_NOME[ultima.checkout.resultado] || ''}` : e?.ultima_fiscalizacao ? fmtDate(e.ultima_fiscalizacao) : 'Nenhuma registrada')));

    let acoes;
    if (m.status === 'pendente') {
      ouvintesPos.add(atualizarLeitura);
      atualizarLeitura(posAtual());
      acoes = h('div', { class: 'stack' }, leitura,
        h('div', { class: 'row gap two' },
          h('a', { class: 'btn', href: linkMaps(alvo), target: '_blank', rel: 'noopener' }, 'Google Maps'),
          h('a', { class: 'btn', href: linkWaze(alvo), target: '_blank', rel: 'noopener' }, 'Waze')),
        btnCheckin,
        h('button', { class: 'link center', type: 'button', onclick: () => naoRealizada(m, sh) }, 'Não consegui realizar esta missão'));
    } else if (m.status === 'no_local') {
      acoes = formResultado(m, sh);
    } else {
      const fotos = h('div', { class: 'fotos' });
      (m.checkout?.fotos || []).forEach(async (fid) => { const u = await fotoURL(fid); if (u) fotos.append(h('img', { src: u, alt: 'Foto da vistoria' })); });
      acoes = h('div', { class: 'stack' },
        m.status === 'nao_realizada'
          ? h('p', { class: 'note note-warn' }, `Não realizada: ${m.checkout?.motivo || ''}`)
          : h('div', { class: 'stack' },
            h('div', { class: 'kv' }, h('span', {}, 'Check-in'), h('strong', {}, m.checkin ? `${fmtTime(m.checkin.ts)}, a ${fmtDist(m.checkin.distancia)}${m.checkin.dentro ? '' : ' (fora do raio)'}` : '—')),
            h('div', { class: 'kv' }, h('span', {}, 'Resultado'), h('strong', {}, `${RESULTADO_NOME[m.checkout?.resultado] || ''} às ${fmtTime(m.checkout?.ts)}`)),
            h('div', { class: 'kv' }, h('span', {}, 'Documento visto'), h('strong', {}, SITUACAO_NOME[m.checkout?.situacao_doc] || 'Não verificado')),
            m.checkout?.obs ? h('div', { class: 'kv' }, h('span', {}, 'Observações'), h('strong', {}, m.checkout.obs)) : null,
            fotos));
    }
    mount(sh.body, h('div', { class: 'stack' }, cabecalho, acoes));
  }

  async function checkin(m, sh) {
    let p;
    try { p = await obterPosicao(); }
    catch (err) { toast(err.message, 'warn'); return; }
    if (!p.simulado && p.precisao > 100) {
      const continuar = await confirmar(`O sinal de GPS está fraco (±${Math.round(p.precisao)} m). Aguardar alguns segundos em local aberto melhora a precisão. Continuar mesmo assim?`, { ok: 'Continuar' });
      if (!continuar) return;
    }
    const alvo = st.pontoMissao(m);
    const d = dist(p, alvo);
    if (d <= raio()) {
      const r = st.fazerCheckin(m.id, p);
      toast(`Check-in às ${fmtTime(Date.now())}, a ${fmtDist(r.distancia)} do ponto.`, 'ok');
      desenharMissao(m.id, sh);
      return;
    }
    const just = h('textarea', { rows: 3, placeholder: 'Ex.: a entrada fica pela rua de trás' });
    const corrigir = h('input', { type: 'checkbox' });
    sheet({
      title: `Você está a ${fmtDist(d)} do ponto`,
      body: h('div', { class: 'stack' },
        h('p', {}, `O check-in normal vale até ${raio()} m do ponto cadastrado. Para registrar mesmo assim, explique o motivo.`),
        field('Justificativa', just),
        h('label', { class: 'check' }, corrigir, 'O ponto no mapa está errado. Sugerir minha posição atual como a localização correta.')),
      actions: [{ label: 'Cancelar' }, { label: 'Registrar check-in', kind: 'primary', onClick: () => {
        if (just.value.trim().length < 5) { toast('Escreva uma justificativa curta.', 'warn'); return false; }
        st.fazerCheckin(m.id, p, { justificativa: just.value.trim(), corrigir: corrigir.checked });
        toast(corrigir.checked ? 'Check-in registrado. A correção do ponto foi enviada ao oficial.' : 'Check-in registrado fora do raio.', 'ok');
        desenharMissao(m.id, sh);
      } }],
    });
  }

  function formResultado(m, sh) {
    let resultado = null;
    const fotos = [];
    const sit = select(SITUACAO_DOC, 'desconhecida');
    const validade = h('input', { type: 'date' });
    const campoValidade = field('Válido até', validade);
    campoValidade.hidden = true;
    sit.addEventListener('change', () => { campoValidade.hidden = sit.value !== 'valido'; });
    const obs = h('textarea', { rows: 3, placeholder: 'O que foi visto, exigências feitas, nome de quem atendeu' });
    const galeria = h('div', { class: 'fotos' });
    const inFoto = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, hidden: true, onchange: async (ev) => {
      for (const f of Array.from(ev.target.files || []).slice(0, 4 - fotos.length)) {
        try { const fid = await salvarFoto(f); fotos.push(fid); const u = await fotoURL(fid); galeria.append(h('img', { src: u, alt: 'Foto anexada' })); }
        catch { toast('Não foi possível guardar a foto.', 'warn'); }
      }
      ev.target.value = '';
    } });
    const grade = h('div', { class: 'result-grid', role: 'radiogroup', 'aria-label': 'Resultado da vistoria' }, RESULTADOS.map(([k, l]) => h('button', {
      type: 'button', class: 'result-opt', role: 'radio', 'aria-checked': 'false', dataset: { k },
      onclick: (ev) => { resultado = k; grade.querySelectorAll('.result-opt').forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.k === k)); }); ev.currentTarget.blur(); },
    }, l)));
    return h('div', { class: 'stack' },
      h('p', { class: `note ${m.checkin?.dentro ? 'note-ok' : 'note-warn'}` }, `Check-in às ${fmtTime(m.checkin?.ts)}, a ${fmtDist(m.checkin?.distancia)} do ponto${m.checkin?.dentro ? '.' : ' (fora do raio).'}`),
      h('span', { class: 'field-label' }, 'Resultado'), grade,
      field('Documento visto no local', sit), campoValidade,
      field('Observações', obs),
      h('div', { class: 'row gap' }, h('button', { class: 'btn', type: 'button', onclick: () => { if (fotos.length >= 4) toast('Limite de 4 fotos.'); else inFoto.click(); } }, 'Anexar foto'), inFoto, h('span', { class: 'muted small' }, 'Até 4 fotos')),
      galeria,
      h('button', { class: 'btn btn-checkin pronto', type: 'button', onclick: () => {
        if (!resultado) { toast('Escolha o resultado da vistoria.', 'warn'); return; }
        if (sit.value === 'valido' && !validade.value) { toast('Informe a validade do documento.', 'warn'); return; }
        const r = st.fazerCheckout(m.id, { resultado, situacao_doc: sit.value, validade: validade.value || null, obs: obs.value.trim(), fotos });
        toast(r.retorno ? `Vistoria concluída. O retorno foi para a fila do oficial com prazo em ${fmtDate(r.retorno.prazo)}.` : 'Vistoria concluída.', 'ok');
        sh.close(); render();
      } }, 'Concluir vistoria'),
      h('button', { class: 'link center', type: 'button', onclick: async () => { if (await confirmar('Desfazer o check-in desta missão?', { ok: 'Desfazer' })) { st.desfazerCheckin(m.id); desenharMissao(m.id, sh); } } }, 'Desfazer check-in'));
  }

  function naoRealizada(m, sh) {
    let motivo = MOTIVOS_NAO_REALIZADA[0];
    const det = h('input', { placeholder: 'Detalhe (opcional)' });
    sheet({
      title: 'Missão não realizada',
      body: h('div', { class: 'stack' },
        h('div', { class: 'radios' }, MOTIVOS_NAO_REALIZADA.map((x, i) => h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'nr', checked: i === 0, onchange: () => { motivo = x; } }), x))),
        field('Detalhe', det)),
      actions: [{ label: 'Cancelar' }, { label: 'Registrar', kind: 'primary', onClick: () => { st.marcarNaoRealizada(m.id, det.value.trim() ? `${motivo}: ${det.value.trim()}` : motivo); toast('Registrado. O oficial vai ver no painel.'); sh.close(); render(); } }],
    });
  }

  // ---------- início ----------
  st.on(() => { if (ui.aba !== 'mapa') render(); else atualizarConn(); });
  render();
}


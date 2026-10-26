import * as st from './store.js';
import { setCnae } from './score.js';
import { h, mount, toast, sheet } from './ui.js';
import { iniciarAdmin } from './admin.js';
import { iniciarCampo } from './field.js';
import { marca } from './marca.js';
import { lerHash, decodificar } from './link.js';

const root = document.getElementById('app');

function sair() { st.definirSessao(null); location.replace(location.pathname); }
function entrar(s) { st.definirSessao(s); location.replace(location.pathname); }

function telaPerfil() {
  const S = st.S();
  mount(root, h('div', { class: 'entrada' },
    h('div', { class: 'entrada-card' },
      h('div', { class: 'entrada-marca' }, marca(56)),
      h('h1', {}, 'Fiscaliza Petrolina'),
      h('p', { class: 'entrada-sub' }, 'Distribuição das equipes de fiscalização, roteiro do dia e check-in no local.'),
      h('button', { class: 'perfil perfil-oficial', type: 'button', onclick: () => entrar({ papel: 'oficial' }) },
        h('strong', {}, 'Entrar como oficial'), h('span', {}, 'Mapa, fila, distribuição, sugestões, eventos e relatório')),
      h('p', { class: 'entrada-label' }, 'Entrar como vistoriador'),
      h('div', { class: 'perfis' }, S.vistoriadores.filter((v) => v.ativo !== false).map((v) => h('button', {
        class: 'perfil', type: 'button', style: { '--c': v.cor }, onclick: () => entrar({ papel: 'vistoriador', vid: v.id }),
      }, h('span', { class: 'team-dot' }), h('strong', {}, v.nome)))),
      h('p', { class: 'entrada-demo' }, 'Os dados ficam guardados neste aparelho. O oficial envia o roteiro do dia por link no WhatsApp, e o vistoriador devolve os resultados pelo mesmo caminho.'))));
}

async function carregarBasePublica() {
  try {
    const r = await fetch('./data/estabelecimentos.geojson', { cache: 'no-cache' });
    if (!r.ok) return;
    st.definirBasePublica(await r.json());
  } catch { /* a base ainda não foi publicada pela rotina mensal */ }
}

// Links recebidos pelo WhatsApp: #rota=… (celular do vistoriador) e #retorno=… (painel do oficial)
async function tratarLink() {
  const lk = lerHash();
  if (!lk) return null;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const dados = await decodificar(lk.valor);
    if (lk.tipo === 'rota') {
      const r = st.aplicarRoteiro(dados);
      st.definirSessao({ papel: 'vistoriador', vid: r.vid });
      return { msg: `Roteiro recebido: ${r.total} missão(ões) para ${st.vist(r.vid)?.nome}.` };
    }
    if (lk.tipo === 'retorno') {
      const r = st.aplicarRetorno(dados);
      st.definirSessao({ papel: 'oficial' });
      const partes = [`${r.concluidas} concluída(s)`, r.nao_realizadas ? `${r.nao_realizadas} não realizada(s)` : null, r.encaixes ? `${r.encaixes} pedido(s) de encaixe` : null, r.correcoes ? `${r.correcoes} correção(ões) de local` : null, r.retornos ? `${r.retornos} retorno(s) criado(s) na fila` : null, r.ja_importadas ? `${r.ja_importadas} já importada(s) antes` : null].filter(Boolean);
      return { msg: `Resultados de ${st.vist(dados.vid)?.nome || 'vistoriador'} importados: ${partes.join(', ')}.` };
    }
  } catch (err) {
    return { erro: err.message || 'Não foi possível abrir o link. Peça para enviarem de novo, copiando o link inteiro.' };
  }
  return null;
}

async function iniciar() {
  st.carregar();
  try {
    const r = await fetch('./data/cnae.json');
    setCnae(await r.json());
  } catch {
    toast('Não foi possível carregar a tabela de atividades. As sugestões ficam limitadas.', 'warn');
  }
  const aviso = await tratarLink();
  const q = new URLSearchParams(location.search);
  if (q.get('perfil') === 'oficial') { st.definirSessao({ papel: 'oficial' }); history.replaceState(null, '', location.pathname); }

  const s = st.sessao();
  document.body.dataset.papel = s?.papel || 'entrada';
  if (!s) telaPerfil();
  else if (s.papel === 'oficial') iniciarAdmin(root, { sair });
  else if (s.papel === 'vistoriador' && st.vist(s.vid)) iniciarCampo(root, { vid: s.vid, sair });
  else { st.definirSessao(null); telaPerfil(); }

  if (aviso?.msg) toast(aviso.msg, 'ok');
  if (aviso?.erro) sheet({ title: 'Link não abriu', body: h('p', {}, aviso.erro), actions: [{ label: 'Entendi', kind: 'primary' }] });

  carregarBasePublica();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

window.addEventListener('hashchange', () => { if (lerHash()) location.reload(); });

iniciar();

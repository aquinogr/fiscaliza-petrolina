import * as st from './store.js';
import { setCnae } from './score.js';
import { h, mount, toast } from './ui.js';
import { iniciarAdmin } from './admin.js';
import { iniciarCampo } from './field.js';
import { marca } from './marca.js';

const root = document.getElementById('app');

function sair() { st.definirSessao(null); location.replace(location.pathname); }

function entrar(s) { st.definirSessao(s); location.replace(location.pathname); }

function telaPerfil() {
  const S = st.S();
  mount(root, h('div', { class: 'entrada' },
    h('div', { class: 'entrada-card' },
      h('div', { class: 'entrada-marca' }, marca(56)),
      h('h1', {}, 'Fiscaliza Petrolina'),
      h('p', { class: 'entrada-sub' }, 'Distribuição de equipes, roteiros e check-in das vistorias de fiscalização e regularização.'),
      h('button', { class: 'perfil perfil-oficial', type: 'button', onclick: () => entrar({ papel: 'oficial' }) },
        h('strong', {}, 'Entrar como oficial'), h('span', {}, 'Mapa, escala por setor, fila, sugestões, eventos e relatório')),
      h('p', { class: 'entrada-label' }, 'Entrar como vistoriador'),
      h('div', { class: 'perfis' }, S.vistoriadores.filter((v) => v.ativo !== false).map((v) => h('button', {
        class: 'perfil', type: 'button', style: { '--c': v.cor }, onclick: () => entrar({ papel: 'vistoriador', vid: v.id }),
      }, h('span', { class: 'team-dot' }), h('strong', {}, v.nome)))),
      S.modo === 'demo' ? h('p', { class: 'entrada-demo' }, 'Modo demonstração: dados fictícios, guardados só neste aparelho. Para testar os dois lados, abra o painel numa aba e o vistoriador em outra; as mudanças aparecem nas duas. Com o banco de dados ligado, cada pessoa entra com o próprio login.') : null)));
}

async function iniciar() {
  st.carregar();
  try {
    const r = await fetch('./data/cnae.json');
    setCnae(await r.json());
  } catch {
    toast('Não foi possível carregar a tabela de atividades. As sugestões ficam limitadas.', 'warn');
  }
  // Atalho para o celular do vistoriador: ?vistoriador=v2
  const q = new URLSearchParams(location.search);
  const vq = q.get('vistoriador');
  if (vq && st.vist(vq)) { st.definirSessao({ papel: 'vistoriador', vid: vq }); history.replaceState(null, '', location.pathname); }
  if (q.get('perfil') === 'oficial') { st.definirSessao({ papel: 'oficial' }); history.replaceState(null, '', location.pathname); }

  const s = st.sessao();
  document.body.dataset.papel = s?.papel || 'entrada';
  if (!s) telaPerfil();
  else if (s.papel === 'oficial') iniciarAdmin(root, { sair });
  else if (s.papel === 'vistoriador' && st.vist(s.vid)) iniciarCampo(root, { vid: s.vid, sair });
  else { st.definirSessao(null); telaPerfil(); }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

iniciar();

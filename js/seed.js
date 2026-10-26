// Estado inicial: equipe real, sem nenhum dado fictício.
// Estabelecimentos chegam do MOCI e da base pública (Receita Federal + IBGE); missões, do oficial.

export const VISTORIADORES = [
  { id: 'v1', nome: 'SGT SOBRINHO', cor: '#2563EB', whatsapp: '' },
  { id: 'v2', nome: 'SGT BORGES', cor: '#EA580C', whatsapp: '' },
  { id: 'v3', nome: 'CB DA LUZ', cor: '#0D9488', whatsapp: '' },
  { id: 'v4', nome: 'CB BERNARDO', cor: '#7C3AED', whatsapp: '' },
];

export const VERSAO_ESTADO = 2;

export function estadoInicial() {
  return {
    versao: VERSAO_ESTADO,
    modo: 'local',
    criado_em: Date.now(),
    config: {
      unidade: 'CBMPE / CAT Sertão',
      base: { lat: -9.3890, lng: -40.5030 }, // ajuste em Ajustes > Base de partida
      base_ajustada: false,
      raio_checkin: 150,
      capacidade_dia: 7,
      prazo_retorno_dias: 30,
      pesos: { ocupacao: 30, documental: 25, historico: 20, exposicao: 15, tempo: 10 },
      limite_sugestao: 55,
      moci_cidades: 'Petrolina',
      regularizacao_ativa: false, // versão 2.0
    },
    vistoriadores: VISTORIADORES.map((v) => ({ ...v })),
    setores: [],
    estabelecimentos: [],
    missoes: [],
    solicitacoes: [],
    correcoes: [],
    decisoes: {},
    escala: {},
    equipe_dia: {},
    eventos: [],
    locais: [],
    outbox: [],
  };
}

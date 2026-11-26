// Vocabulário e regras de negócio compartilhadas.

// "v2": tipos da Regularização, desativados até a versão 2.0.
export const TIPOS = {
  fiscalizacao: { nome: 'Fiscalização', fila: 'proativa' },
  avcb_vencido: { nome: 'AVCB vencido', fila: 'urgencia' },
  denuncia: { nome: 'Denúncia', fila: 'urgencia' },
  retorno: { nome: 'Retorno de notificação', fila: 'urgencia' },
  evento: { nome: 'Fiscalização de evento', fila: 'urgencia' },
  encaixe: { nome: 'Encaixe', fila: 'proativa' },
  regularizacao: { nome: 'Regularização', fila: 'solicitada', v2: true },
};
export const TIPOS_CADASTRO = Object.entries(TIPOS).filter(([k, t]) => !t.v2 && k !== 'encaixe');

export const FILAS = {
  solicitada: 'Demanda solicitada',
  urgencia: 'Urgência administrativa',
  proativa: 'Proativa',
};

export const STATUS = {
  pendente: 'Pendente',
  no_local: 'No local',
  concluida: 'Concluída',
  nao_realizada: 'Não realizada',
};

export const PRIORIDADES = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

export const RESULTADOS = [
  ['regular', 'Regular'],
  ['notificado', 'Notificado'],
  ['auto_infracao', 'Auto de infração'],
  ['interditado', 'Interditado'],
  ['fechado', 'Fechado no momento'],
  ['nao_localizado', 'Não localizado'],
  ['acesso_recusado', 'Acesso recusado'],
  ['isento', 'Isento / não se aplica'],
];
export const RESULTADO_NOME = Object.fromEntries(RESULTADOS);
export const RESULTADOS_COM_EXIGENCIA = ['notificado', 'auto_infracao', 'interditado'];
export const RESULTADOS_IMPRODUTIVOS = ['fechado', 'nao_localizado', 'acesso_recusado'];

export const SITUACAO_DOC = [
  ['valido', 'Documento válido'],
  ['vencido', 'Documento vencido'],
  ['em_andamento', 'Processo em andamento'],
  ['sem_documento', 'Sem documento'],
  ['isento', 'Isento / não se aplica'],
  ['desconhecida', 'Não verificado'],
];
export const SITUACAO_NOME = Object.fromEntries(SITUACAO_DOC);

export const MOTIVOS_REJEICAO = [
  ['ja_regular', 'Já está regular'],
  ['isento', 'Isento / não se aplica'],
  ['fechado', 'Estabelecimento encerrado'],
  ['duplicado', 'Duplicado ou endereço errado'],
  ['fora_area', 'Fora da área de atuação'],
  ['depois', 'Agora não (rever depois)'],
];

export const STATUS_EVENTO = [
  ['nao_recebido', 'Sem solicitação'],
  ['recebido', 'Solicitação recebida'],
  ['vistoriado', 'Vistoriado'],
  ['liberado', 'Liberado'],
  ['negado', 'Não liberado'],
];
export const STATUS_EVENTO_NOME = Object.fromEntries(STATUS_EVENTO);

// Atualiza o cadastro do estabelecimento com o que o vistoriador viu em campo.
export function aplicarResultado(estab, saida, data) {
  if (!estab || !saida) return;
  estab.ultima_fiscalizacao = data;
  estab.ultimo_resultado = saida.resultado;
  if (saida.situacao_doc && saida.situacao_doc !== 'desconhecida') {
    estab.situacao_doc = saida.situacao_doc;
    estab.validade_doc = saida.situacao_doc === 'valido' ? (saida.validade || null) : null;
  }
  if (RESULTADOS_COM_EXIGENCIA.includes(saida.resultado)) estab.notificacoes = (estab.notificacoes || 0) + 1;
}

export function formatarCNPJ(c) {
  const d = String(c || '').replace(/\D/g, '');
  if (d.length !== 14) return c || '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// Classificações oficiais do Art. 7º do COSCIP-PE (Decreto nº 19.644/1997, tipos A a Q) + MOCI.
export const ART7_ORDEM = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'MOCI'];

export const ART7_COSCIP = {
  A: { codigo: 'A', curto: 'Res. Unifamiliar', nome: 'Residencial Privativa Unifamiliar', artigo: 'Art. 8º', emoji: '🏠', cor: '#0D9488' },
  B: { codigo: 'B', curto: 'Res. Multifamiliar', nome: 'Residencial Privativa Multifamiliar', artigo: 'Art. 9º', emoji: '🏢', cor: '#0284C7' },
  C: { codigo: 'C', curto: 'Res. Coletiva', nome: 'Residencial Coletiva', artigo: 'Art. 10', emoji: '🏘️', cor: '#2563EB' },
  D: { codigo: 'D', curto: 'Hospedagem', nome: 'Residencial Transitória', artigo: 'Art. 11', emoji: '🏨', cor: '#0369A1' },
  E: { codigo: 'E', curto: 'Comercial', nome: 'Comercial', artigo: 'Art. 12', emoji: '🛒', cor: '#475569' },
  F: { codigo: 'F', curto: 'Escritório', nome: 'Escritório', artigo: 'Art. 13', emoji: '💼', cor: '#64748B' },
  G: { codigo: 'G', curto: 'Mista', nome: 'Mista', artigo: 'Art. 14', emoji: '🏬', cor: '#4F46E5' },
  H: { codigo: 'H', curto: 'Reunião de Público', nome: 'Reunião de Público', artigo: 'Art. 15', emoji: '👥', cor: '#9333EA' },
  I: { codigo: 'I', curto: 'Hospitalar', nome: 'Hospitalar', artigo: 'Art. 16', emoji: '🏥', cor: '#DC2626' },
  J: { codigo: 'J', curto: 'Pública', nome: 'Pública', artigo: 'Art. 17', emoji: '🏛️', cor: '#1D4ED8' },
  K: { codigo: 'K', curto: 'Escolar', nome: 'Escolar', artigo: 'Art. 18', emoji: '🏫', cor: '#0891B2' },
  L: { codigo: 'L', curto: 'Industrial', nome: 'Industrial', artigo: 'Art. 19', emoji: '🏭', cor: '#15803D' },
  M: { codigo: 'M', curto: 'Garagem', nome: 'Garagem', artigo: 'Art. 20', emoji: '🅿️', cor: '#52525B' },
  N: { codigo: 'N', curto: 'Galpão / Depósito', nome: 'Galpão ou Depósito', artigo: 'Art. 21', emoji: '📦', cor: '#B45309' },
  O: { codigo: 'O', curto: 'Petróleo / GLP', nome: 'Derivados de Petróleo, Álcool e Perigosos', artigo: 'Art. 22', emoji: '⛽', cor: '#B91C1C' },
  P: { codigo: 'P', curto: 'Templo Religioso', nome: 'Templos Religiosos', artigo: 'Art. 23', emoji: '⛪', cor: '#7C3AED' },
  Q: { codigo: 'Q', curto: 'Especiais', nome: 'Especiais', artigo: 'Art. 24', emoji: '🧨', cor: '#EA580C' },
  MOCI: { codigo: 'MOCI', curto: 'MOCI', nome: 'Edificação cadastrada no MOCI', artigo: 'MOCI', emoji: '🚒', cor: '#15803D' },
};

// Cor do ícone do MOCI (🚒): verde para AVCB válido, vermelho apenas para AVCB vencido, âmbar para sem AVCB.
export function corMociStatus(estab) {
  const sit = estab?.situacao_doc && estab.situacao_doc !== 'desconhecida'
    ? estab.situacao_doc
    : (estab?.moci?.situacao || 'sem_documento');
  if (sit === 'valido') return { cor: '#15803D', statusLabel: 'AVCB válido' };
  if (sit === 'vencido') return { cor: '#B91C1C', statusLabel: 'AVCB vencido' };
  return { cor: '#D97706', statusLabel: 'Sem AVCB' };
}

export function classificacaoArt7(estab, info) {
  const cod = info?.art7;
  if (cod && ART7_COSCIP[cod]) {
    const base = ART7_COSCIP[cod];
    return { ...base, rotulo: `Tipo ${base.codigo} · ${base.curto}` };
  }
  if (estab?.moci) {
    const { cor, statusLabel } = corMociStatus(estab);
    return { ...ART7_COSCIP.MOCI, cor, statusLabel, rotulo: `MOCI · ${statusLabel}` };
  }
  return { codigo: 'OUTRO', curto: 'Outros', nome: 'Sem classificação Art. 7º', artigo: '', emoji: '📍', cor: '#64748B', rotulo: 'Sem classificação' };
}

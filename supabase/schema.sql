-- Fiscaliza Petrolina: banco de dados no Supabase (Postgres).
-- Como usar: no painel do Supabase, abra SQL Editor, cole este arquivo inteiro e clique em Run.
-- Depois crie os usuários em Authentication > Users e ligue cada um a um perfil (exemplo no fim do arquivo).
--
-- Regras de acesso (Row Level Security):
--   oficial      vê e altera tudo;
--   vistoriador  vê só as próprias missões e registra check-in/resultado pelas funções
--                fazer_checkin e fazer_checkout (a distância é calculada aqui no servidor).

-- ------------------------------------------------------------ tabelas
create table if not exists vistoriadores (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  cor text not null default '#2563EB',
  ativo boolean not null default true
);

create table if not exists perfis (
  user_id uuid primary key references auth.users (id) on delete cascade,
  papel text not null check (papel in ('oficial', 'vistoriador')),
  vistoriador_id text references vistoriadores (id)
);

create table if not exists setores (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  poligono jsonb not null            -- [[lat, lng], ...]
);

create table if not exists estabelecimentos (
  id text primary key default gen_random_uuid()::text,
  cnpj text unique,
  nome text not null,
  cnae text,
  cnae_principal text,
  endereco text,
  bairro text,
  cep text,
  abertura date,
  origem text not null default 'manual',     -- receita | manual
  ativo boolean not null default true,
  lat double precision,
  lng double precision,
  lat_receita double precision,
  lng_receita double precision,
  geo_precisao text,                          -- endereco | cep | campo
  geo_corrigido boolean not null default false,
  situacao_doc text not null default 'desconhecida',
  validade_doc date,
  ultima_fiscalizacao date,
  notificacoes integer not null default 0,
  ultimo_resultado text,
  atualizado_receita date,
  criado_em timestamptz not null default now()
);

-- A rotina mensal grava lat_receita/lng_receita; a posição usada no mapa só muda se ninguém a corrigiu em campo.
create or replace function estab_posicao() returns trigger language plpgsql as $$
begin
  if not new.geo_corrigido and new.lat_receita is not null then
    new.lat := new.lat_receita;
    new.lng := new.lng_receita;
  end if;
  return new;
end $$;
drop trigger if exists trg_estab_posicao on estabelecimentos;
create trigger trg_estab_posicao before insert or update on estabelecimentos
  for each row execute function estab_posicao();

create table if not exists locais (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  estab_id text references estabelecimentos (id),
  lat double precision not null,
  lng double precision not null,
  capacidade integer,
  saidas text,
  acesso_viatura text,
  ponto_agua text,
  pendencias text
);

create table if not exists eventos (
  id text primary key default gen_random_uuid()::text,
  nome text not null,
  local_id text references locais (id),
  inicio date not null,
  fim date,
  publico integer,
  status text not null default 'nao_recebido',
  processo text,
  origem text,
  notas text
);

create table if not exists missoes (
  id text primary key default gen_random_uuid()::text,
  estab_id text not null references estabelecimentos (id),
  tipo text not null default 'regularizacao',
  prioridade text not null default 'media',
  status text not null default 'pendente' check (status in ('pendente', 'no_local', 'concluida', 'nao_realizada')),
  data date,
  vistoriador_id text references vistoriadores (id),
  ordem integer not null default 0,
  processo text,
  prazo date,
  notas text,
  origem text not null default 'manual',
  evento_id text references eventos (id),
  criado_em date not null default current_date,
  checkin jsonb,
  checkout jsonb,
  atualizado_em timestamptz not null default now()
);
create index if not exists missoes_dia on missoes (data, vistoriador_id);
create index if not exists missoes_fila on missoes (status) where vistoriador_id is null;

create table if not exists escala (
  data date not null,
  setor_id text not null references setores (id) on delete cascade,
  vistoriador_id text not null references vistoriadores (id),
  primary key (data, setor_id)
);

create table if not exists solicitacoes (          -- pedidos de encaixe feitos em campo
  id text primary key default gen_random_uuid()::text,
  estab_id text not null references estabelecimentos (id),
  vistoriador_id text not null references vistoriadores (id),
  data date not null default current_date,
  ts timestamptz not null default now(),
  status text not null default 'pendente',
  obs text,
  missao_id text references missoes (id)
);

create table if not exists correcoes (             -- pedidos de correção da posição no mapa
  id text primary key default gen_random_uuid()::text,
  estab_id text not null references estabelecimentos (id),
  missao_id text references missoes (id),
  lat double precision not null,
  lng double precision not null,
  vistoriador_id text references vistoriadores (id),
  ts timestamptz not null default now(),
  status text not null default 'pendente'
);

create table if not exists decisoes (              -- aceite/rejeição de sugestões
  estab_id text primary key references estabelecimentos (id),
  status text not null,
  motivo text,
  data date not null default current_date,
  score integer
);

create table if not exists config (
  id integer primary key default 1 check (id = 1),
  dados jsonb not null
);
insert into config (id, dados) values (1, '{
  "unidade": "CBMPE / CAT Sertão",
  "base": {"lat": -9.38, "lng": -40.503},
  "raio_checkin": 150, "capacidade_dia": 7, "prazo_retorno_dias": 30,
  "pesos": {"ocupacao": 30, "documental": 25, "historico": 20, "exposicao": 15, "tempo": 10},
  "cotas": {"solicitada": 65, "urgencia": 20, "proativa": 15},
  "limite_sugestao": 45
}') on conflict (id) do nothing;

-- ------------------------------------------------------------ papéis
create or replace function eh_oficial() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfis where user_id = auth.uid() and papel = 'oficial');
$$;

create or replace function meu_vistoriador() returns text
language sql stable security definer set search_path = public as $$
  select vistoriador_id from perfis where user_id = auth.uid() and papel = 'vistoriador';
$$;

-- ------------------------------------------------------------ acesso
alter table vistoriadores enable row level security;
alter table perfis enable row level security;
alter table setores enable row level security;
alter table estabelecimentos enable row level security;
alter table locais enable row level security;
alter table eventos enable row level security;
alter table missoes enable row level security;
alter table escala enable row level security;
alter table solicitacoes enable row level security;
alter table correcoes enable row level security;
alter table decisoes enable row level security;
alter table config enable row level security;

-- oficial: tudo
create policy oficial_vistoriadores on vistoriadores for all using (eh_oficial()) with check (eh_oficial());
create policy oficial_perfis on perfis for all using (eh_oficial()) with check (eh_oficial());
create policy oficial_setores on setores for all using (eh_oficial()) with check (eh_oficial());
create policy oficial_estab on estabelecimentos for all using (eh_oficial()) with check (eh_oficial());
create policy oficial_locais on locais for all using (eh_oficial()) with check (eh_oficial());
create policy oficial_eventos on eventos for all using (eh_oficial()) with check (eh_oficial());
create policy oficial_missoes on missoes for all using (eh_oficial()) with check (eh_oficial());
create policy oficial_escala on escala for all using (eh_oficial()) with check (eh_oficial());
create policy oficial_solic on solicitacoes for all using (eh_oficial()) with check (eh_oficial());
create policy oficial_correcoes on correcoes for all using (eh_oficial()) with check (eh_oficial());
create policy oficial_decisoes on decisoes for all using (eh_oficial()) with check (eh_oficial());
create policy oficial_config on config for all using (eh_oficial()) with check (eh_oficial());

-- vistoriador: leitura do necessário para trabalhar
create policy ler_proprio_perfil on perfis for select using (user_id = auth.uid());
create policy vist_ler_vistoriadores on vistoriadores for select using (meu_vistoriador() is not null);
create policy vist_ler_setores on setores for select using (meu_vistoriador() is not null);
create policy vist_ler_estab on estabelecimentos for select using (meu_vistoriador() is not null);
create policy vist_ler_config on config for select using (meu_vistoriador() is not null);
create policy vist_ler_escala on escala for select using (vistoriador_id = meu_vistoriador());
create policy vist_ler_missoes on missoes for select using (vistoriador_id = meu_vistoriador());
create policy vist_ler_solic on solicitacoes for select using (vistoriador_id = meu_vistoriador());
create policy vist_pedir_encaixe on solicitacoes for insert with check (vistoriador_id = meu_vistoriador() and status = 'pendente');
create policy vist_ler_correcoes on correcoes for select using (vistoriador_id = meu_vistoriador());

-- ------------------------------------------------------------ ações de campo
create or replace function distancia_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

create or replace function fazer_checkin(p_missao text, p_lat double precision, p_lng double precision,
  p_precisao double precision default null, p_justificativa text default null, p_corrigir boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m missoes; e estabelecimentos; d double precision; raio integer; dentro boolean; ci jsonb;
begin
  select * into m from missoes where id = p_missao for update;
  if m.id is null or m.vistoriador_id is distinct from meu_vistoriador() then
    raise exception 'Missão não encontrada para este vistoriador';
  end if;
  if m.status <> 'pendente' then raise exception 'Missão já iniciada'; end if;
  select * into e from estabelecimentos where id = m.estab_id;
  select coalesce((dados->>'raio_checkin')::integer, 150) into raio from config where id = 1;
  d := distancia_m(p_lat, p_lng, e.lat, e.lng);
  dentro := d <= raio;
  if not dentro and coalesce(length(trim(p_justificativa)), 0) < 5 then
    raise exception 'Check-in fora do raio exige justificativa';
  end if;
  ci := jsonb_build_object('ts', (extract(epoch from now()) * 1000)::bigint, 'lat', p_lat, 'lng', p_lng,
    'precisao', round(coalesce(p_precisao, 0)), 'distancia', round(d), 'dentro', dentro, 'justificativa', p_justificativa);
  update missoes set status = 'no_local', checkin = ci, atualizado_em = now() where id = p_missao;
  if not dentro and p_corrigir then
    insert into correcoes (estab_id, missao_id, lat, lng, vistoriador_id) values (m.estab_id, m.id, p_lat, p_lng, m.vistoriador_id);
  end if;
  return ci;
end $$;

create or replace function fazer_checkout(p_missao text, p_saida jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m missoes; prazo_ret integer; res text := p_saida->>'resultado'; sit text := p_saida->>'situacao_doc'; saida jsonb;
begin
  select * into m from missoes where id = p_missao for update;
  if m.id is null or m.vistoriador_id is distinct from meu_vistoriador() then
    raise exception 'Missão não encontrada para este vistoriador';
  end if;
  if m.status <> 'no_local' then raise exception 'Faça o check-in antes de concluir'; end if;
  saida := p_saida || jsonb_build_object('ts', (extract(epoch from now()) * 1000)::bigint);
  update missoes set status = 'concluida', checkout = saida, atualizado_em = now() where id = p_missao;
  update estabelecimentos set
    ultima_fiscalizacao = coalesce(m.data, current_date),
    ultimo_resultado = res,
    situacao_doc = case when sit is not null and sit <> 'desconhecida' then sit else situacao_doc end,
    validade_doc = case when sit = 'valido' then nullif(p_saida->>'validade', '')::date when sit is not null and sit <> 'desconhecida' then null else validade_doc end,
    notificacoes = notificacoes + case when res in ('notificado', 'auto_infracao', 'interditado') then 1 else 0 end
  where id = m.estab_id;
  select coalesce((dados->>'prazo_retorno_dias')::integer, 30) into prazo_ret from config where id = 1;
  if res in ('notificado', 'auto_infracao', 'interditado') and prazo_ret > 0 then
    insert into missoes (estab_id, tipo, prioridade, processo, prazo, notas, origem)
    values (m.estab_id, 'retorno', 'alta', m.processo, coalesce(m.data, current_date) + prazo_ret,
            'Retorno automático da vistoria de ' || to_char(coalesce(m.data, current_date), 'DD/MM/YYYY') || '.', 'automatico');
  end if;
  return saida;
end $$;

create or replace function marcar_nao_realizada(p_missao text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update missoes set status = 'nao_realizada', checkout = jsonb_build_object('ts', (extract(epoch from now()) * 1000)::bigint, 'motivo', p_motivo), atualizado_em = now()
  where id = p_missao and vistoriador_id = meu_vistoriador() and status in ('pendente', 'no_local');
end $$;

revoke all on function fazer_checkin(text, double precision, double precision, double precision, text, boolean) from public, anon;
revoke all on function fazer_checkout(text, jsonb) from public, anon;
revoke all on function marcar_nao_realizada(text, text) from public, anon;
grant execute on function fazer_checkin(text, double precision, double precision, double precision, text, boolean) to authenticated;
grant execute on function fazer_checkout(text, jsonb) to authenticated;
grant execute on function marcar_nao_realizada(text, text) to authenticated;

-- Atualização em tempo real no painel do oficial
alter publication supabase_realtime add table missoes, solicitacoes, correcoes;

-- ------------------------------------------------------------ primeiro acesso (exemplo)
-- 1. Crie os usuários em Authentication > Users (e-mail e senha de cada um).
-- 2. Cadastre os vistoriadores e ligue os perfis, trocando os e-mails:
-- insert into vistoriadores (id, nome, cor) values ('v1', 'Sd Almeida', '#2563EB');
-- insert into perfis (user_id, papel) select id, 'oficial' from auth.users where email = 'oficial@exemplo.com';
-- insert into perfis (user_id, papel, vistoriador_id) select id, 'vistoriador', 'v1' from auth.users where email = 'almeida@exemplo.com';

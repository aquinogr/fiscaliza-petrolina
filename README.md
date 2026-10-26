# Fiscaliza Petrolina

Planejamento das fiscalizações do CBMPE em Petrolina/PE: fila de missões, distribuição da equipe do dia pelo mapa, roteiro no celular do vistoriador, check-in por geolocalização e sugestões automáticas de onde fiscalizar.

Site: **https://aquinogr.github.io/fiscaliza-petrolina/**

Equipe: SGT SOBRINHO, SGT BORGES, CB DA LUZ e CB BERNARDO (editável em Ajustes > Equipe).

## De onde vêm os dados

Nenhum dado é fictício.

- **MOCI** (Mapa de OCI do CAT Sertão): o painel lê as edificações cadastradas, com situação do AVCB, porte, reserva de incêndio, hidrantes, sprinklers e caldeira. É só leitura: nada é gravado no MOCI. Atualiza sozinho ao abrir o painel, no máximo a cada 30 minutos. Por padrão entram só as de Petrolina (Ajustes > MOCI).
- **Base pública** (Receita Federal + IBGE): estabelecimentos ativos de Petrolina com atividade de interesse, localizados no mapa pelos endereços do Censo 2022. Uma rotina do GitHub Actions monta a base todo dia 20 e grava `data/estabelecimentos.geojson` no próprio site.
- **Campo**: cada vistoria registra a situação documental vista no local, e esse registro vai formando o histórico de cada estabelecimento.

## Como funciona no dia a dia

1. **Fila.** Na aba Sugestões, o bloco MOCI põe os AVCBs vencidos na fila com prioridade alta (e, se quiser, os sem AVCB). Denúncias, retornos e fiscalizações aceitas nas sugestões também entram na fila.
2. **Equipe do dia.** Na aba Escala, marque quem está de serviço e toque em **Distribuir a fila por proximidade**. O sistema divide as missões pela localização, até o limite por vistoriador, e ordena cada roteiro pela menor distância a partir da base.
3. **Roteiro no celular.** Em cada roteiro, toque em **Enviar roteiro**. Vai pelo WhatsApp um link; o vistoriador abre no celular e vê o roteiro, o mapa e os botões de navegação.
4. **Check-in e resultado.** No local, o check-in confere a distância (150 m por padrão). Fora do raio, pede justificativa e permite sugerir a localização correta. O resultado vem de uma lista fechada, com documento visto, observações e fotos. Notificação gera retorno automático na fila.
5. **Volta ao painel.** No fim do dia, o vistoriador toca em **Enviar resultados ao oficial**. Quando o oficial abre o link, os resultados, os pedidos de encaixe e as correções de local entram no painel. Abrir o mesmo link duas vezes não duplica nada.
6. **Relatório.** A aba Relatório monta o resumo do dia pronto para o WhatsApp.

Os links levam os dados depois do `#`, que não vai a servidor nenhum. Envie cada roteiro só ao vistoriador dele. As fotos ficam no celular de quem tirou.

Os dados ficam no aparelho de cada um até o banco de dados ser ligado. Faça backup de vez em quando em Ajustes > Dados.

## Regularização (versão 2.0)

A aba Regularização está desativada. O plano é o oficial cadastrar a regularização num chat de IA no painel, enviando um **PDF único** com documentos do proprietário, memorial descritivo, croqui, requerimentos e classificação de risco (I, II ou III). A IA lê o PDF, propõe os dados úteis e as coordenadas, o oficial confere e a vistoria vai para a caixa do vistoriador. Como o PDF traz dados pessoais, essa parte exige o banco de dados com controle de acesso.

## Publicação

O site é publicado pelo GitHub Pages a partir da branch `main`. A rotina da base pública está em **Actions > Atualizar base pública**. Ela roda todo dia 20 e também pode ser disparada à mão em "Run workflow". A fonte oficial é o portal de dados abertos da Receita Federal; quando ele está fora do ar ou mudou de endereço, a rotina usa o espelho público da Casa dos Dados, que mantém os mesmos arquivos.

A base publicada só tem dados públicos da Receita: CNPJ, nome fantasia, endereço e atividade. Não há telefone, e-mail ou sócios, e a razão social de empresário individual (que costuma ser o nome da pessoa) não é usada.

O GitHub desliga rotinas agendadas de repositórios sem atividade por 60 dias. Se acontecer, reative em Actions.

## Próximo passo: banco de dados (Supabase, gratuito)

Com o banco, cada pessoa entra com o próprio login, as missões chegam ao celular sem precisar de link, e a versão 2.0 pode guardar os PDFs com segurança.

1. Crie uma conta e um projeto em supabase.com.
2. Em **SQL Editor**, rode `supabase/schema.sql` (uma vez).
3. Em **Authentication > Users**, crie os usuários e ligue cada um ao perfil (exemplo no fim do `schema.sql`).
4. Em **Settings > API**, copie a *Project URL* e a chave *anon public*.
5. No GitHub, em **Settings > Secrets and variables > Actions**, crie `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` (chave *service_role*, que nunca vai para o site).

## Cuidados

- Ferramenta pessoal usada em serviço: dê ciência à chefia imediata antes de a equipe depender dela.
- As categorias de `data/cnae.json` servem para priorizar sugestões. Não equivalem à classificação de ocupação das normas de segurança contra incêndio.
- Geolocalização de celular pode ser falsificada. O check-in é um registro de apoio, não prova pericial.
- Para testar o GPS longe de Petrolina, abra o app do vistoriador com `?simular=1` no fim do endereço.

## Estrutura

```
index.html, css/, js/          site (sem etapa de compilação)
  js/admin.js                  painel do oficial
  js/field.js                  app do vistoriador
  js/store.js                  dados, distribuição e links de roteiro/resultado
  js/moci.js                   leitura do MOCI
  js/score.js                  motor de sugestões
data/cnae.json                 atividades de interesse e categorias
data/estabelecimentos.geojson  base pública (gerada pela rotina mensal)
pipeline/atualizar_base.py     rotina mensal (só biblioteca padrão do Python)
supabase/schema.sql            banco de dados com regras de acesso
```

Mapa: © colaboradores do OpenStreetMap. Biblioteca de mapas: Leaflet. Dados públicos: Receita Federal (CNPJ) e IBGE (CNEFE, Censo 2022).

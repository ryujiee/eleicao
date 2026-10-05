# Eleições 2026 — apuração em tempo real

Dashboard aberto da apuração (Presidente com mapa interativo do Brasil por UF; Governador, Senado,
Deputado Federal e Deputado Estadual de Santa Catarina), alimentado exclusivamente pelos arquivos
oficiais de divulgação do TSE (`resultados.tse.jus.br`).

Produção: https://eleicao.infinitytech.net.br

- Resultado nacional (1º, 2º, diferença, demais candidatos, % de seções totalizadas).
- Mapa SVG vetorial (malha oficial do IBGE) com a cor do partido que lidera cada UF no momento:
  PT em vermelho, PL em verde, demais em cinza, UF sem totalização tracejada, empate com aparência própria.
- Contador de UFs (PT + PL + Outros + Empate + Aguardando = 27).
- Clique/toque no estado ou seletor "Ver estado" para ver 1º/2º/3º, votos, diferença, seções e horário.
- % de apuração própria de cada UF (seções totalizadas / total) no cartão, no tooltip e, no desktop, no mapa.
- Abas Governador, Senado, Federal e Estadual de SC. Nos cargos proporcionais, "Entrando" vem da
  distribuição parcial de vagas por agremiação calculada pelo TSE (`agr.vag`: quociente partidário e
  médias), preenchida pelos mais votados de cada lista — não do ranking geral de votos. Quando o TSE
  publica a situação oficial (`st`/`e`), ela substitui a projeção. Nada é chamado de "eleito" antes disso.
- Atualização ao vivo via Server-Sent Events; só os estados que mudaram são redesenhados.

## Apuração encerrada

A interface só mostra "100% · APURAÇÃO ENCERRADA" quando o próprio TSE sinaliza: `tf = "s"`
(totalização final) ou `md = "e"`/`"s"` (resultado matematicamente definido: eleito / 2º turno).
Nunca a partir do percentual. O dado bruto continua intacto na API e visível nos detalhes
("Totalização oficial recebida: 99,97% (499.120 / 499.248 seções)"). Com o cargo encerrado, o selo
"● AO VIVO" vira "✓ RESULTADO FINAL" e o painel segue como registro histórico.

## 2º turno — análise de cenários

Aba "2º turno" com os finalistas definidos pelo TSE (situação oficial ou `md = "s"`), votos finais
do 1º turno, votos disponíveis dos demais candidatos, simulador de transferência (por candidato
eliminado, troca entre finalistas, branco/nulo/abstenção e novos votos válidos), presets
matemáticos (Transferência neutra, Repetir 1º turno, Personalizado) e mapa simulado por UF, que
aplica as mesmas premissas sobre o resultado real de cada UF. Tudo é rotulado como
"Cenário simulado — não é previsão". As contas ficam em `public/sim.js` (testadas em `test/sim.test.js`).

Pesquisas: `data/polls.json` (servido em `/api/polls`). A integração está desabilitada porque não há
fonte oficial automatizável com os números (o PesqEle do TSE publica registro, instituto e período,
mas não os resultados). Só devem entrar levantamentos identificáveis e registrados, com instituto,
período de campo, divulgação, margem de erro, registro no TSE e link da fonte. Nunca médias.

## Como os dados do TSE são consumidos

Estrutura descoberta em `https://resultados.tse.jus.br/oficial/comum/config/ele-c.json`
(eleição federal 2026, 1º turno = `6257`; 2º turno = `6258`; cargo Presidente = `c0001`).

| Arquivo | Uso |
| --- | --- |
| `ele2026/6257/dados/br/br-e006257-ab.json` | Um único arquivo com o andamento de todas as UFs (data/hora da última totalização e seções totalizadas). |
| `ele2026/6257/dados/<uf>/<uf>-c0001-e006257-u.json` | Resultado presidencial de uma UF (ou `br` para o nacional). |
| `ele2026/6259/dados/sc/sc-c0003-e006259-u.json` | Governador SC (eleição estadual `6259`; 2º turno = `6260`). |
| `ele2026/6259/dados/sc/sc-c0005-e006259-u.json` | Senador SC. |
| `ele2026/6259/dados/sc/sc-c0006-e006259-u.json` | Deputado Federal SC (com `qe` e vagas por agremiação). |
| `ele2026/6259/dados/sc/sc-c0007-e006259-u.json` | Deputado Estadual SC. |

A cada 3 segundos o backend verifica quais arquivos podem ter novidade, sempre com requisições
condicionais (`If-None-Match`; sem mudança, a resposta é `304` vazia):

- o arquivo `ab` indica quais UFs tiveram nova totalização; só essas têm o resultado consultado;
- a CDN do TSE mantém cada arquivo em cache por até ~60 s e informa o tempo restante em `max-age`.
  O backend não pergunta antes disso (a CDN não teria nada mais novo) e revalida cada arquivo assim
  que o cache dele expira. Como `ab` e os arquivos das UFs têm ciclos de cache independentes, isso
  evita somar dois atrasos: cada UF chega no máximo um ciclo de CDN depois da publicação do TSE.

Na prática são ~0,5 requisição por segundo, quase todas `304`. O navegador nunca acessa o TSE:
tudo fica em cache no backend e é distribuído aos clientes por SSE no instante em que muda.

Os horários do TSE vêm no fuso local de cada UF (AC = UTC-5; AM, RR, RO, MT, MS = UTC-4) e são
exibidos no horário de Brasília.

A cor de cada UF vem da sigla do partido do candidato (`par.sg` no arquivo do TSE), nunca do nome.
UF sem seção totalizada ou sem votos não é atribuída a ninguém; empate no 1º lugar não escolhe lado.

## Rodando

Requer Node.js 20+ e nenhuma dependência.

```sh
npm start          # http://127.0.0.1:3026
npm test           # testes unitários + pipeline completo contra um TSE simulado
npm run build:map  # regenera public/brasil.svg a partir da API de malhas do IBGE
```

Variáveis: `PORT`, `HOST`, `POLL_MS` (padrão 3000), `TSE_ELECTION` (padrão `6257`; use `6258` no 2º turno),
`TSE_STATE_ELECTION` (padrão `6259`; `6260` no 2º turno), `STATE_UF` (padrão `SC`),
`TSE_CICLO` (padrão `ele2026`), `ELECTION_NAME`, `TSE_BASE`.

API: `GET /api/president` (snapshot), `GET /api/stream` (SSE: `snapshot` ao conectar, depois `update`
apenas com as áreas alteradas), `GET /healthz`.

## Deploy

```sh
git -C /opt/eleicao pull && systemctl restart eleicao
```

O reinício é necessário: a versão do frontend (hash dos arquivos de `public/`) é calculada na
inicialização. Os assets são servidos como `app.js?v=<versão>` (cache imutável), e as páginas já
abertas recebem a nova versão pela conexão ao vivo, mostram um aviso e recarregam sozinhas.

Arquivos de referência em `deploy/` (unit do systemd e site do nginx com SSE sem buffer).

## Licença

MIT. Dados: Tribunal Superior Eleitoral. Malha territorial: IBGE.

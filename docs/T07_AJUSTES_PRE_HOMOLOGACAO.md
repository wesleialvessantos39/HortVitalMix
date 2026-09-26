# T07 — ajustes antes da homologação

## Conta e endereços

- A sessão devolve o nome cadastrado e o papel ativo junto da identidade já validada. A página mostra ambos assim que a sessão chega; consultas de perfil, endereços e preferências são independentes.
- Na lista de endereços existe uma única ação no cabeçalho: **Adicionar um endereço** para lista vazia e **Adicionar novo endereço** quando já houver registros. O estado vazio só orienta. A ação ocupa a largura disponível no mobile.
- O produtor vê endereços **pessoais** e suas preferências pessoais. O consumidor vê locais de entrega pessoal e avisos de seus pedidos. Endereço pessoal do produtor não é ponto de retirada nem propriedade rural.

## Contrato para as trilhas comerciais futuras

Esta definição orienta T08+; ainda não cria produto, pedido, checkout nem tabela nova.

1. O produtor publicará produtos e configurará para cada oferta as modalidades disponíveis: retirada em local comercial cadastrado, entrega ao endereço do consumidor ou ambas.
2. O consumidor verá as modalidades permitidas pela oferta e escolherá uma no checkout. Para retirada, verá apenas o ponto disponibilizado pelo produtor; para entrega, escolherá um endereço pessoal cadastrado.
3. O pedido guardará uma cópia imutável do endereço de entrega ou do ponto de retirada escolhido, para que edições futuras não alterem pedidos antigos.
4. O produtor só receberá acesso ao endereço de entrega vinculado ao pedido pertinente, depois da escolha do consumidor. Endereços pessoais de outros usuários permanecem privados.
5. Os contratos, a autorização por papel, a persistência e as telas comerciais serão implementados na trilha correspondente, após as dependências de produtor, oferta e pedido existirem.

## Estado do gate

O código da T07 recebeu estes ajustes; a homologação com contas reais de consumidor e produtor e aferição de latência continuam como evidências necessárias antes da selagem.

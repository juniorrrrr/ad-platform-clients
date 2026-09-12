// Camada de cliente HTTP para APIs de plataformas de anúncio — sem nenhuma
// dependência de banco de dados, tenant ou UI. Recebe token + parâmetros,
// devolve dado tipado ou lança GraphApiError classificável. Extraído do
// B2DCOM Internal (b2dcom-insight-hub) para ser consumido tanto por ele
// quanto pelo Vision Dash sem duplicar — qualquer correção aqui (ex. um novo
// código de erro de rate limit da Meta) beneficia os dois produtos com um
// bump de versão, não um diff manual portado (ou esquecido) entre repositórios.
//
// O que NÃO está aqui, de propósito: nada que resolva token a partir de um
// banco (isso depende do schema de tenancy de cada produto), nada de
// self-healing/refresh de conexão (idem), nada de UI. Ver README.md.

export * from "./graph-fetch";
export * from "./graph-error";
export * from "./instagram-api";
export * from "./facebook-api";
export * from "./ga4-query-planner";
export * from "./ga4-batch-executor";
export * from "./ga4-result-merger";

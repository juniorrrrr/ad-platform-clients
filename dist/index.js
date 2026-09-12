"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./graph-fetch"), exports);
__exportStar(require("./graph-error"), exports);
__exportStar(require("./instagram-api"), exports);
__exportStar(require("./facebook-api"), exports);
__exportStar(require("./ga4-query-planner"), exports);
__exportStar(require("./ga4-batch-executor"), exports);
__exportStar(require("./ga4-result-merger"), exports);
//# sourceMappingURL=index.js.map
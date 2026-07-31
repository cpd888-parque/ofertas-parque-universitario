/**
 * Cloudflare Pages Functions - Servir Assets do R2
 * 
 * Captura rotas /assets/:file e serve do bucket R2.
 */

import worker from '../../workers/oferta-worker.js';

export async function onRequest(context) {
    const { request, env } = context;
    // O Worker identifica a rota /assets/ e serve do R2
    return worker.fetch(request, env);
}

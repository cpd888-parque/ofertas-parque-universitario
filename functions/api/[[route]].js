/**
 * Cloudflare Pages Functions - API de Ofertas
 * 
 * Adapta o Worker principal para o formato Pages Functions.
 * Captura todas as rotas /api/* e /assets/*
 */

import worker from '../../workers/oferta-worker.js';

export async function onRequest(context) {
    const { request, env } = context;
    return worker.fetch(request, env);
}

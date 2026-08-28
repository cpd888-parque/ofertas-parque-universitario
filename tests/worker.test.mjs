/**
 * Teste funcional das correções de segurança do Worker.
 * Executar com Node 18+ (WebCrypto, fetch, FormData, File globais):
 *
 *   node test-worker.mjs
 *
 * Importa workers/oferta-worker.js e simula o ambiente Cloudflare
 * (env + R2 em memória) para validar os fluxos corrigidos.
 */

import worker from '../workers/oferta-worker.js';

let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
    if (cond) {
        passed++;
        console.log(`  ✅ ${name}`);
    } else {
        failed++;
        console.log(`  ❌ ${name} ${extra}`);
    }
}

// ===== R2 em memória =====
function makeBucket() {
    const store = new Map();
    return {
        _store: store,
        async get(key) {
            if (!store.has(key)) return null;
            const buf = store.get(key);
            const body = new ReadableStream({
                start(c) { c.enqueue(new Uint8Array(buf)); c.close(); }
            });
            return {
                body,
                httpEtag: '"abc123"',
                async text() { return buf.toString('utf-8'); }
            };
        },
        async put(key, value) {
            store.set(key, Buffer.from(value));
        },
        async delete(key) { store.delete(key); }
    };
}

function makeEnv() {
    return {
        ADMIN_PASSWORD: 'senha-segura-123',
        AUTH_SECRET: 'segredo-de-teste',
        OFERTAS_BUCKET: makeBucket()
    };
}

const BASE = 'http://worker.local';

function req(path, { method = 'GET', body, headers = {}, env } = {}) {
    const init = { method, headers };
    if (body !== undefined) {
        if (typeof body === 'string') {
            init.body = body;
            if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
        } else {
            init.body = body; // FormData
        }
    }
    const request = new Request(BASE + path, init);
    return worker.fetch(request, env);
}

// Token expirado / adulterado (formato replicado do Worker)
async function craftToken(env, exp, tamper = false) {
    const payloadB64 = btoa(JSON.stringify({ sub: 'admin', exp }));
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(env.AUTH_SECRET || env.ADMIN_PASSWORD),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
    return tamper ? payloadB64 + '.AAAA' : payloadB64 + '.' + sigB64;
}

// ===== TESTES =====
console.log('\n1) Fail-fast (ADMIN_PASSWORD ausente)');
{
    const env = { OFERTAS_BUCKET: makeBucket() };
    let r = await req('/api/login', { method: 'POST', body: '{"password":"x"}', env });
    check('login sem ADMIN_PASSWORD → 503', r.status === 503, `(${r.status})`);
    r = await req('/api/upload', { method: 'POST', body: '{}', env });
    check('upload sem ADMIN_PASSWORD → 503', r.status === 503, `(${r.status})`);
}

console.log('\n2) Login: senha errada → 401; senha certa → 200 + token');
{
    const env = makeEnv();
    let r = await req('/api/login', { method: 'POST', body: '{"password":"errada"}', env });
    check('senha errada → 401', r.status === 401, `(${r.status})`);

    r = await req('/api/login', { method: 'POST', body: JSON.stringify({ password: env.ADMIN_PASSWORD }), env });
    const data = await r.json();
    check('senha correta → 200', r.status === 200, `(${r.status})`);
    check('resposta traz token', !!data.token && typeof data.token === 'string');
    globalThis.__TOKEN = data.token;
}

console.log('\n3) Upload exige Bearer (401 sem token, 200 com token)');
{
    const env = makeEnv();
    const jpegBytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01];

    let r = await req('/api/upload', { method: 'POST', body: '{}', env });
    check('sem token → 401', r.status === 401, `(${r.status})`);

    // Token expirado → 401
    const expired = await craftToken(env, Date.now() - 1000);
    const form = new FormData();
    form.append('file', new File([new Uint8Array(jpegBytes)], 'oferta.jpg', { type: 'image/jpeg' }));
    r = await req('/api/upload', { method: 'POST', body: form, headers: { Authorization: `Bearer ${expired}` }, env });
    check('token expirado → 401', r.status === 401, `(${r.status})`);

    // Token adulterado → 401
    const tampered = await craftToken(env, Date.now() + 100000, true);
    const form2 = new FormData();
    form2.append('file', new File([new Uint8Array(jpegBytes)], 'oferta.jpg', { type: 'image/jpeg' }));
    r = await req('/api/upload', { method: 'POST', body: form2, headers: { Authorization: `Bearer ${tampered}` }, env });
    check('token adulterado → 401', r.status === 401, `(${r.status})`);

    // Conteúdo não confere (magic bytes inválidos) → 400
    const fakeBytes = [0x00, 0x01, 0x02, 0x03, 0x04];
    const form3 = new FormData();
    form3.append('file', new File([new Uint8Array(fakeBytes)], 'fake.jpg', { type: 'image/jpeg' }));
    r = await req('/api/upload', { method: 'POST', body: form3, headers: { Authorization: `Bearer ${globalThis.__TOKEN}` }, env });
    check('magic bytes inválidos → 400', r.status === 400, `(${r.status})`);

    // Upload válido → 200 e catálogo atualizado
    const form4 = new FormData();
    form4.append('file', new File([new Uint8Array(jpegBytes)], 'oferta-teste.jpg', { type: 'image/jpeg' }));
    r = await req('/api/upload', { method: 'POST', body: form4, headers: { Authorization: `Bearer ${globalThis.__TOKEN}` }, env });
    const up = await r.json();
    check('upload válido → 200', r.status === 200, `(${r.status})`);
    check('upload retorna oferta com url', !!up.oferta?.url);
    check('nome único com UUID (sem colisão)', /\d+_[0-9a-f-]{36}\.jpg$/.test(up.oferta.url.split('/').pop()));

    const list = await (await req('/api/ofertas', { env })).json();
    check('catálogo tem 1 oferta', list.length === 1);
    globalThis.__ASSET_URL = up.oferta.url;
}

console.log('\n4) serveAsset: allowlist + nosniff');
{
    const env = makeEnv();
    // Popular um arquivo direto no bucket para testar o servidor
    env.OFERTAS_BUCKET._store.set('ofertas.json', Buffer.from('[{"segredo":true}]'));
    env.OFERTAS_BUCKET._store.set('evil.html', Buffer.from('<script>alert(1)</script>'));

    let r = await req('/assets/ofertas.json', { env });
    check('catálogo não é servido → 404', r.status === 404, `(${r.status})`);

    r = await req('/assets/evil.html', { env });
    check('html não é servido → 404', r.status === 404, `(${r.status})`);

    r = await req('/assets/../ofertas.json', { env });
    check('path traversal → 404', r.status === 404, `(${r.status})`);

    // Enviar um arquivo legítimo neste mesmo bucket para servir depois
    const jpegBytes = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01];
    const form = new FormData();
    form.append('file', new File([new Uint8Array(jpegBytes)], 'oferta-serve.jpg', { type: 'image/jpeg' }));
    r = await req('/api/upload', { method: 'POST', body: form, headers: { Authorization: `Bearer ${globalThis.__TOKEN}` }, env });
    const up = await r.json();

    r = await req(up.oferta.url, { env });
    check('arquivo de oferta → 200', r.status === 200, `(${r.status})`);
    check('header nosniff presente', (r.headers.get('X-Content-Type-Options') || '') === 'nosniff');
    check('content-type correto', (r.headers.get('Content-Type') || '').startsWith('image/jpeg'));
}

console.log('\n5) Excluir exige Bearer');
{
    const env = makeEnv();
    // popular catálogo
    const catalog = [{ nome: 'Oferta A', url: '/assets/1_aaaa.jpg' }];
    env.OFERTAS_BUCKET._store.set('ofertas.json', Buffer.from(JSON.stringify(catalog)));

    let r = await req('/api/excluir', { method: 'POST', body: '{"nome":"Oferta A"}', env });
    check('sem token → 401', r.status === 401, `(${r.status})`);

    r = await req('/api/excluir', {
        method: 'POST',
        body: '{"nome":"Oferta A"}',
        headers: { Authorization: `Bearer ${globalThis.__TOKEN}` },
        env
    });
    check('com token → 200', r.status === 200, `(${r.status})`);
    const list = await (await req('/api/ofertas', { env })).json();
    check('catálogo esvaziado', list.length === 0);
}

console.log('\n6) Rate limit no login (5 falhas → 429)');
{
    const env = makeEnv();
    let last = 0;
    for (let i = 0; i < 6; i++) {
        const r = await req('/api/login', { method: 'POST', body: '{"password":"errada"}', env });
        last = r.status;
    }
    check('6ª tentativa errada → 429', last === 429, `(${last})`);
    const r = await req('/api/login', { method: 'POST', body: JSON.stringify({ password: env.ADMIN_PASSWORD }), env });
    check('mesmo IP bloqueado mesmo com senha certa → 429', r.status === 429, `(${r.status})`);
}

console.log('\n7) CORS restrito por origem');
{
    const env = makeEnv();
    let r = await req('/api/ofertas', { headers: { Origin: 'https://evil.com' }, env });
    check('origin não permitida → sem ACAO', r.headers.get('Access-Control-Allow-Origin') === null);

    r = await req('/api/ofertas', { headers: { Origin: 'https://ofertas-parque-universitario.pages.dev' }, env });
    check('origin permitida → ACAO ecoado', (r.headers.get('Access-Control-Allow-Origin') || '') === 'https://ofertas-parque-universitario.pages.dev');

    r = await req('/api/login', { method: 'OPTIONS', headers: { Origin: 'https://evil.com' }, env });
    check('preflight origin não permitida → sem ACAO', r.headers.get('Access-Control-Allow-Origin') === null);
}

console.log('\n8) Lista pública continua aberta');
{
    const env = makeEnv();
    let r = await req('/api/ofertas', { env });
    check('GET /api/ofertas → 200', r.status === 200, `(${r.status})`);
    r = await req('/api/nao-existe', { env });
    check('rota desconhecida → 404', r.status === 404, `(${r.status})`);
}

console.log(`\n===== RESULTADO: ${passed} passaram, ${failed} falharam =====`);
process.exit(failed > 0 ? 1 : 0);

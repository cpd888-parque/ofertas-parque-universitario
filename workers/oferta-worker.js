/**
 * Cloudflare Worker - API de Ofertas
 *
 * Gerencia ofertas no Cloudflare R2.
 * Endpoints:
 *   GET  /api/ofertas        - Listar todas as ofertas (público)
 *   POST /api/login          - Autenticar administrador (emite token Bearer)
 *   POST /api/upload         - Fazer upload de nova oferta (requer Bearer)
 *   POST /api/excluir        - Excluir uma oferta (requer Bearer)
 *   GET  /assets/:arquivo    - Servir arquivos do R2 (allowlist)
 *   OPTIONS /*               - CORS preflight (origens permitidas)
 *
 * Segredos (nunca versionar; usar `npx wrangler secret put`):
 *   ADMIN_PASSWORD - senha do administrador (obrigatória, mín. 8 chars)
 *   AUTH_SECRET    - segredo p/ assinar tokens de sessão (opcional; default = ADMIN_PASSWORD)
 *   ALLOWED_ORIGIN - origens CORS extras, separadas por vírgula (opcional)
 */

const CONFIG = {
    r2BucketName: 'OFERTAS_BUCKET',
    catalogFile: 'ofertas.json',
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
    maxFileSize: 20 * 1024 * 1024,
    tokenTtlMs: 12 * 60 * 60 * 1000,               // tokens de sessão válidos por 12h
    loginRateLimit: { max: 5, windowMs: 60 * 1000 } // 5 tentativas de login por minuto por IP
};

// Origem padrão do site + localhost para desenvolvimento. Em produção,
// adicione origens extras via secret ALLOWED_ORIGIN.
const DEFAULT_ALLOWED_ORIGINS = [
    'https://ofertas-parque-universitario.pages.dev',
    'http://localhost:8787',
    'http://127.0.0.1:8787'
];

// Assinaturas de arquivo (magic bytes) por extensão — validação real do conteúdo.
// webp é tratado à parte (formato RIFF....WEBP).
const FILE_SIGNATURES = {
    jpg: [0xFF, 0xD8, 0xFF],
    jpeg: [0xFF, 0xD8, 0xFF],
    png: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    pdf: [0x25, 0x50, 0x44, 0x46] // %PDF
};

// Rate limit em memória (best-effort: Workers podem ter múltiplos isolates,
// mas reduz drasticamente ataques de força bruta em um mesmo processo).
const loginAttempts = new Map();

// ===== HANDLER PRINCIPAL =====
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const method = request.method;

        if (method === 'OPTIONS') {
            return new Response(null, { headers: getCorsHeaders(request, env) });
        }

        try {
            switch (true) {
                case url.pathname === '/api/ofertas' && method === 'GET':
                    return await handleListOffers(request, env);

                case url.pathname === '/api/login' && method === 'POST':
                    return await handleLogin(request, env);

                case url.pathname === '/api/upload' && method === 'POST':
                    return await handleUpload(request, env);

                case url.pathname === '/api/excluir' && method === 'POST':
                    return await handleDelete(request, env);

                case url.pathname.startsWith('/assets/') && method === 'GET':
                    return await serveAsset(request, url.pathname, env);

                default:
                    return jsonResponse({ error: 'Rota não encontrada' }, 404, request, env);
            }
        } catch (error) {
            console.error('Worker error:', error);
            return jsonResponse({ error: 'Erro interno do servidor' }, 500, request, env);
        }
    }
};

// ===== CONFIGURAÇÃO (fail-fast) =====
// Em vez de aceitar um default inseguro, recusamos login/escrita até que
// ADMIN_PASSWORD seja definido com um valor forte. A leitura pública (GET)
// continua funcionando para não derrubar a vitrine da loja.
function ensureConfigured(env) {
    const pw = env.ADMIN_PASSWORD;
    if (typeof pw === 'string' && pw.length >= 8) return null;
    return 'ADMIN_PASSWORD ausente ou muito curta (mín. 8 caracteres). Configure com: npx wrangler secret put ADMIN_PASSWORD';
}

// ===== LISTAR OFERTAS =====
async function handleListOffers(request, env) {
    const bucket = env[CONFIG.r2BucketName];
    const catalog = await getCatalog(bucket);
    catalog.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    return jsonResponse(catalog, 200, request, env);
}

// ===== LOGIN =====
async function handleLogin(request, env) {
    const configError = ensureConfigured(env);
    if (configError) return jsonResponse({ success: false, error: configError }, 503, request, env);

    const ip = clientIpFrom(request);
    if (isRateLimited(ip)) {
        return jsonResponse({ success: false, error: 'Muitas tentativas. Aguarde 1 minuto.' }, 429, request, env);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ success: false, error: 'Corpo inválido' }, 400, request, env);
    }
    const { password } = body;
    if (!password) return jsonResponse({ success: false, error: 'Senha não fornecida' }, 401, request, env);

    // Comparação em tempo constante — evita timing attack
    const ok = constantTimeEqual(password, env.ADMIN_PASSWORD);
    if (!ok) {
        registerFailure(ip);
        return jsonResponse({ success: false, error: 'Senha incorreta' }, 401, request, env);
    }

    const token = await createToken(env);
    return jsonResponse({ success: true, token, expiresIn: CONFIG.tokenTtlMs }, 200, request, env);
}

// ===== UPLOAD =====
async function handleUpload(request, env) {
    const configError = ensureConfigured(env);
    if (configError) return jsonResponse({ error: configError }, 503, request, env);

    const authError = await requireAuth(request, env);
    if (authError) return authError;

    const bucket = env[CONFIG.r2BucketName];
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) return jsonResponse({ error: 'Nenhum arquivo enviado' }, 400, request, env);
    if (file.size > CONFIG.maxFileSize) return jsonResponse({ error: 'Arquivo excede o limite de 20MB' }, 400, request, env);

    const fileName = file.name.toLowerCase();
    const ext = fileName.split('.').pop();
    if (!CONFIG.allowedExtensions.includes(ext)) {
        return jsonResponse({ error: 'Tipo de arquivo não suportado. Use JPG, PNG, WEBP ou PDF.' }, 400, request, env);
    }

    const buffer = await file.arrayBuffer();

    // Validação real do conteúdo (magic bytes) — não confiar em extensão/MIME do cliente
    if (!hasValidSignature(new Uint8Array(buffer), ext)) {
        return jsonResponse({ error: 'Conteúdo do arquivo não confere com a extensão informada.' }, 400, request, env);
    }

    // Nome único: timestamp + UUID (elimina colisão entre uploads simultâneos)
    const timestamp = Date.now();
    const uniqueName = `${timestamp}_${crypto.randomUUID()}.${ext}`;
    const contentType = mapContentType(ext);

    await bucket.put(uniqueName, buffer, {
        httpMetadata: { contentType },
        customMetadata: { originalName: file.name }
    });

    const catalog = await getCatalog(bucket);
    const newOferta = {
        nome: file.name.replace(/\.[^/.]+$/, ''),
        tipo: contentType,
        url: `/assets/${uniqueName}`,
        data_upload: new Date().toISOString(),
        ordem: catalog.length + 1
    };
    catalog.push(newOferta);
    await saveCatalog(bucket, catalog);

    return jsonResponse({ success: true, oferta: newOferta, message: 'Oferta publicada com sucesso!' }, 200, request, env);
}

// ===== EXCLUIR =====
async function handleDelete(request, env) {
    const configError = ensureConfigured(env);
    if (configError) return jsonResponse({ error: configError }, 503, request, env);

    const authError = await requireAuth(request, env);
    if (authError) return authError;

    const bucket = env[CONFIG.r2BucketName];
    const { nome } = await request.json();
    if (!nome) return jsonResponse({ error: 'Nome da oferta não fornecido' }, 400, request, env);

    const catalog = await getCatalog(bucket);
    const index = catalog.findIndex(o => o.nome === nome);
    if (index === -1) return jsonResponse({ error: 'Oferta não encontrada' }, 404, request, env);

    const fileName = catalog[index].url.split('/').pop();
    try { await bucket.delete(fileName); } catch (e) { console.warn(e); }

    catalog.splice(index, 1);
    catalog.forEach((o, i) => { o.ordem = i + 1; });
    await saveCatalog(bucket, catalog);

    return jsonResponse({ success: true, message: 'Oferta excluída com sucesso!' }, 200, request, env);
}

// ===== CATÁLOGO =====
async function getCatalog(bucket) {
    try {
        const obj = await bucket.get(CONFIG.catalogFile);
        if (obj) return JSON.parse(await obj.text());
    } catch (e) { console.warn('Erro ao ler catálogo:', e); }
    return [];
}

async function saveCatalog(bucket, catalog) {
    await bucket.put(CONFIG.catalogFile, JSON.stringify(catalog, null, 2), {
        httpMetadata: { contentType: 'application/json' }
    });
}

// ===== SERVIR ASSETS DO R2 (allowlist) =====
async function serveAsset(request, pathname, env) {
    const bucket = env[CONFIG.r2BucketName];
    let fileName;
    try {
        fileName = decodeURIComponent(pathname.replace('/assets/', ''));
    } catch {
        return jsonResponse({ error: 'Arquivo não encontrado' }, 404, request, env);
    }

    // Apenas arquivos de oferta com extensão permitida; nunca o catálogo;
    // sem path traversal (nem "/" nem "..")
    const ext = fileName.split('.').pop().toLowerCase();
    const isValidName = fileName && !fileName.includes('/') && !fileName.includes('..');
    if (!isValidName || !CONFIG.allowedExtensions.includes(ext) || fileName === CONFIG.catalogFile) {
        return jsonResponse({ error: 'Arquivo não encontrado' }, 404, request, env);
    }

    const object = await bucket.get(fileName);
    if (!object) return jsonResponse({ error: 'Arquivo não encontrado' }, 404, request, env);

    return new Response(object.body, {
        headers: {
            'Content-Type': mapContentType(ext),
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
            'Content-Disposition': `inline; filename="${sanitizeHeader(fileName)}"`,
            'ETag': object.httpEtag || '',
            ...getCorsHeaders(request, env)
        }
    });
}

// ===== AUTENTICAÇÃO (token Bearer assinado com HMAC-SHA256) =====
async function authKey(env) {
    return env.AUTH_SECRET || env.ADMIN_PASSWORD || '';
}

function base64Encode(str) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}

function base64Decode(b64) {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
}

async function hmac(data, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return base64Encode(String.fromCharCode(...new Uint8Array(sig)));
}

async function createToken(env) {
    const payloadB64 = base64Encode(JSON.stringify({ sub: 'admin', exp: Date.now() + CONFIG.tokenTtlMs }));
    const sig = await hmac(payloadB64, await authKey(env));
    return `${payloadB64}.${sig}`;
}

async function verifyToken(token, env) {
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payloadB64, sig] = parts;

    let payload;
    try {
        payload = JSON.parse(base64Decode(payloadB64));
    } catch {
        return false;
    }
    if (payload.sub !== 'admin' || typeof payload.exp !== 'number') return false;
    if (Date.now() > payload.exp) return false; // token expirado

    const expected = await hmac(payloadB64, await authKey(env));
    return constantTimeEqual(sig, expected);
}

// Exige `Authorization: Bearer <token>`. Retorna null se autorizado,
// ou uma Response 401 pronta para devolver.
async function requireAuth(request, env) {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || !(await verifyToken(token, env))) {
        return jsonResponse({ error: 'Não autorizado' }, 401, request, env);
    }
    return null;
}

// ===== RATE LIMIT (login) =====
function clientIpFrom(request) {
    return request.headers.get('CF-Connecting-IP')
        || (request.headers.get('X-Forwarded-For') || '').split(',')[0].trim()
        || 'unknown';
}

function isRateLimited(ip) {
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (!rec) return false;
    if (now - rec.windowStart > CONFIG.loginRateLimit.windowMs) {
        loginAttempts.delete(ip);
        return false;
    }
    return rec.count >= CONFIG.loginRateLimit.max;
}

function registerFailure(ip) {
    const now = Date.now();
    const rec = loginAttempts.get(ip) || { windowStart: now, count: 0 };
    if (now - rec.windowStart > CONFIG.loginRateLimit.windowMs) {
        rec.windowStart = now;
        rec.count = 0;
    }
    rec.count += 1;
    loginAttempts.set(ip, rec);

    // Limpeza leve: evita crescimento sem limite do Map
    if (loginAttempts.size > 1000) {
        for (const [key, value] of loginAttempts) {
            if (now - value.windowStart > CONFIG.loginRateLimit.windowMs) loginAttempts.delete(key);
        }
    }
}

// ===== VALIDAÇÃO DE CONTEÚDO (magic bytes) =====
function hasValidSignature(bytes, ext) {
    if (ext === 'webp') {
        // RIFF....WEBP
        return bytes.length >= 12 &&
            bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    }
    const sig = FILE_SIGNATURES[ext];
    if (!sig || bytes.length < sig.length) return false;
    return sig.every((b, i) => bytes[i] === b);
}

// ===== CORS (origens permitidas) =====
function parseAllowedOrigins(env) {
    const extras = (env.ALLOWED_ORIGIN || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    return [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...extras])];
}

function getCorsHeaders(request, env) {
    const origin = request ? request.headers.get('Origin') : null;
    const base = {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
    };
    if (origin && parseAllowedOrigins(env).includes(origin)) {
        return { ...base, 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
    }
    // Sem Origin (curl, apps nativos) → sem header ACAO; navegadores bloqueiam origens não listadas
    return base;
}

// ===== UTILITÁRIOS =====
function jsonResponse(data, status = 200, request = null, env = null) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request, env) }
    });
}

// Comparação de strings em tempo constante — mitiga timing attack
function constantTimeEqual(a, b) {
    const ba = String(a || '');
    const bb = String(b || '');
    const max = Math.max(ba.length, bb.length);
    let diff = ba.length ^ bb.length;
    for (let i = 0; i < max; i++) {
        diff |= (ba.charCodeAt(i) || 0) ^ (bb.charCodeAt(i) || 0);
    }
    return diff === 0;
}

// Remove caracteres perigosos para uso em headers HTTP
function sanitizeHeader(value) {
    return String(value)
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/["\\\r\n]/g, '_');
}

function mapContentType(ext) {
    const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
    return map[ext] || 'application/octet-stream';
}

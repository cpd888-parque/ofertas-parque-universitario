/**
 * Cloudflare Worker - API de Ofertas
 * 
 * Gerencia ofertas no Cloudflare R2.
 * Endpoints:
 *   GET  /api/ofertas        - Listar todas as ofertas
 *   POST /api/login          - Autenticar administrador
 *   POST /api/upload         - Fazer upload de nova oferta
 *   POST /api/excluir        - Excluir uma oferta
 *   GET  /assets/:arquivo    - Servir arquivos do R2
 *   OPTIONS /*               - CORS preflight
 */

const CONFIG = {
    // Em produção, use a variável de ambiente ADMIN_PASSWORD
    // Defina com: npx wrangler secret put ADMIN_PASSWORD
    adminPassword: 'admin123',
    r2BucketName: 'OFERTAS_BUCKET',
    catalogFile: 'ofertas.json',
    allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'],
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
    maxFileSize: 20 * 1024 * 1024
};

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
};

// ===== HANDLER PRINCIPAL =====
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const method = request.method;

        if (method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }

        try {
            switch (true) {
                case url.pathname === '/api/ofertas' && method === 'GET':
                    return await handleListOffers(env);

                case url.pathname === '/api/login' && method === 'POST':
                    return await handleLogin(request, env);

                case url.pathname === '/api/upload' && method === 'POST':
                    return await handleUpload(request, env);

                case url.pathname === '/api/excluir' && method === 'POST':
                    return await handleDelete(request, env);

                case url.pathname.startsWith('/assets/') && method === 'GET':
                    return await serveAsset(url.pathname, env);

                default:
                    return jsonResponse({ error: 'Rota não encontrada' }, 404);
            }
        } catch (error) {
            console.error('Worker error:', error);
            return jsonResponse({ error: 'Erro interno do servidor' }, 500);
        }
    }
};

// ===== LISTAR OFERTAS =====
async function handleListOffers(env) {
    const bucket = env[CONFIG.r2BucketName];
    const catalog = await getCatalog(bucket);
    catalog.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    return jsonResponse(catalog);
}

// ===== LOGIN =====
async function handleLogin(request, env) {
    const body = await request.json();
    const { password } = body;
    if (!password) return jsonResponse({ success: false, error: 'Senha não fornecida' }, 401);

    // Priorizar variável de ambiente (produção), fallback para config (desenvolvimento)
    const adminPassword = env.ADMIN_PASSWORD || CONFIG.adminPassword;

    return password === adminPassword
        ? jsonResponse({ success: true })
        : jsonResponse({ success: false, error: 'Senha incorreta' }, 401);
}

// ===== UPLOAD =====
async function handleUpload(request, env) {
    const bucket = env[CONFIG.r2BucketName];
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) return jsonResponse({ error: 'Nenhum arquivo enviado' }, 400);
    if (file.size > CONFIG.maxFileSize) return jsonResponse({ error: 'Arquivo excede o limite de 20MB' }, 400);

    const fileName = file.name.toLowerCase();
    const ext = fileName.split('.').pop();
    if (!CONFIG.allowedExtensions.includes(ext)) {
        return jsonResponse({ error: 'Tipo de arquivo não suportado. Use JPG, PNG, WEBP ou PDF.' }, 400);
    }

    const timestamp = Date.now();
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueName = `${timestamp}_${safeName}`;
    const contentType = mapContentType(ext);

    await bucket.put(uniqueName, await file.arrayBuffer(), {
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

    return jsonResponse({ success: true, oferta: newOferta, message: 'Oferta publicada com sucesso!' });
}

// ===== EXCLUIR =====
async function handleDelete(request, env) {
    const bucket = env[CONFIG.r2BucketName];
    const { nome } = await request.json();
    if (!nome) return jsonResponse({ error: 'Nome da oferta não fornecido' }, 400);

    const catalog = await getCatalog(bucket);
    const index = catalog.findIndex(o => o.nome === nome);
    if (index === -1) return jsonResponse({ error: 'Oferta não encontrada' }, 404);

    const fileName = catalog[index].url.split('/').pop();
    try { await bucket.delete(fileName); } catch (e) { console.warn(e); }

    catalog.splice(index, 1);
    catalog.forEach((o, i) => { o.ordem = i + 1; });
    await saveCatalog(bucket, catalog);

    return jsonResponse({ success: true, message: 'Oferta excluída com sucesso!' });
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

// ===== SERVIR ASSETS DO R2 =====
async function serveAsset(pathname, env) {
    const bucket = env[CONFIG.r2BucketName];
    const fileName = pathname.replace('/assets/', '');
    const object = await bucket.get(fileName);
    if (!object) return jsonResponse({ error: 'Arquivo não encontrado' }, 404);

    const ext = fileName.split('.').pop().toLowerCase();
    return new Response(object.body, {
        headers: {
            'Content-Type': mapContentType(ext),
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Access-Control-Allow-Origin': '*',
            'ETag': object.httpEtag || ''
        }
    });
}

// ===== UTILITÁRIOS =====
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
}

function mapContentType(ext) {
    const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
    return map[ext] || 'application/octet-stream';
}

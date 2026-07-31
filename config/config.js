/**
 * Configuração do Sistema de Ofertas
 * 
 * Altere as configurações abaixo conforme necessário.
 * Em produção, os endpoints apontarão para o Cloudflare Worker.
 */

const CONFIG = {
    // Nome do estabelecimento
    storeName: 'Supermercado Ofertas',

    // Endpoints da API (modo produção)
    api: {
        baseUrl: 'https://ofertas-parque-universitario.pages.dev',
        offersEndpoint: '/api/ofertas',
        uploadEndpoint: '/api/upload',
        deleteEndpoint: '/api/excluir',
        loginEndpoint: '/api/login',
    },

    // Endpoints da API (modo demonstração / desenvolvimento local)
    // api: {
    //     baseUrl: '',
    //     offersEndpoint: '/api/ofertas',
    //     uploadEndpoint: '/api/upload',
    //     deleteEndpoint: '/api/excluir',
    //     loginEndpoint: '/api/login',
    // },

    // Configuração de exibição
    display: {
        // Tempo de transição entre ofertas (ms)
        transitionDuration: 400,
        // Usar navegação por swipe/touch
        enableSwipe: true,
        // Usar navegação por scroll
        enableScroll: true,
    },

    // Padronização de imagens no upload
    // Garante tamanhos consistentes e boa exibição no PC e no celular.
    imageStandardization: {
        // Dimensões máximas (limite para não gerar arquivos gigantes)
        width: 1080,
        height: 1620,
        // 'natural' - preserva o formato original da imagem (SEM cortes e SEM barras).
        //             O app se adapta: no celular preenche a tela, no PC mostra inteira.
        // 'cover'   - corta para preencher a tela inteira (pode cortar laterais)
        // 'contain' - mantém a imagem inteira com fundo escuro
        mode: 'natural',
        // Ponto de foco do corte no modo 'cover': 'center' | 'top' | 'bottom'
        focus: 'center',
        // Cor de fundo usada no modo 'contain' (igual ao tema escuro do app)
        background: '#0a0a0a',
        // Qualidade JPEG (0 a 1)
        quality: 0.92
    },

    // Configuração administrativa
    admin: {
        // Senha do administrador (em produção, validar via Worker)
        password: 'admin123',
        // Chave para sessionStorage
        sessionKey: 'admin_logged_in',
        // Tipos de arquivo permitidos no upload
        allowedTypes: [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/webp',
            'application/pdf'
        ],
        // Extensões permitidas
        allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
        // Tamanho máximo do arquivo (20MB)
        maxFileSize: 20 * 1024 * 1024
    },

    // Dados de exemplo para desenvolvimento local
    demoOffers: [
        {
            nome: 'Promoção de Carnes',
            tipo: 'image/svg+xml',
            url: 'assets/oferta1.svg',
            data_upload: '2026-07-28T10:00:00Z',
            ordem: 1
        },
        {
            nome: 'Ofertas do Mês',
            tipo: 'image/svg+xml',
            url: 'assets/oferta2.svg',
            data_upload: '2026-07-28T11:00:00Z',
            ordem: 2
        },
        {
            nome: 'Hortifruti em Destaque',
            tipo: 'image/svg+xml',
            url: 'assets/oferta3.svg',
            data_upload: '2026-07-28T12:00:00Z',
            ordem: 3
        },
        {
            nome: 'Promoção Relâmpago',
            tipo: 'image/svg+xml',
            url: 'assets/oferta4.svg',
            data_upload: '2026-07-28T13:00:00Z',
            ordem: 4
        }
    ]
};

/**
 * ImageProcessor — Padronização de Imagens de Ofertas
 *
 * Processa a imagem no navegador ANTES do upload para que todas as ofertas
 * tenham o MESMO tamanho e proporção (ex.: 1080×1620), eliminando imagens
 * cortadas ou com barras brancas — no PC e no celular.
 *
 * Modos:
 *   'natural' (padrão) — preserva o formato original da imagem, apenas
 *                        reduzindo para o tamanho máximo. Sem cortes e sem barras.
 *   'cover'             — corta a imagem para preencher exatamente o quadro,
 *                        sem barras. Use `focus` para escolher a parte preservada.
 *   'contain'           — mantém a imagem inteira, encaixando-a no quadro com
 *                        uma cor de fundo configurável (escura, casando com o app).
 *
 * Uso:
 *   const resultado = await ImageProcessor.process(file, CONFIG.imageStandardization);
 *   // resultado.file      -> File .jpg padronizado, pronto para o upload
 *   // resultado.objectUrl -> URL do resultado para preview
 *
 * PDFs (primeira página) também podem ser convertidos em imagem:
 *   const resultado = await ImageProcessor.fromPDF(file, CONFIG.imageStandardization);
 */
const ImageProcessor = (() => {

    // CDN do pdf.js (carregado no admin.html antes deste script)
    const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
    if (typeof window !== 'undefined' && window.pdfjsLib && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN + '/pdf.worker.min.js';
    }

    function getOptions(userOpts = {}) {
        return {
            width: 1080,
            height: 1620,
            mode: 'natural',     // 'natural' | 'cover' | 'contain'
            focus: 'center',     // 'center' | 'top' | 'bottom'
            background: '#0a0a0a',
            quality: 0.92,
            ...userOpts
        };
    }

    function focusFactor(focus) {
        if (focus === 'top') return 0;
        if (focus === 'bottom') return 1;
        return 0.5; // center (padrão)
    }

    function loadViaImageElement(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => resolve({ img, url, isBitmap: false });
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Falha ao carregar imagem')); };
            img.src = url;
        });
    }

    // Carrega a imagem respeitando a orientação EXIF (fotos tiradas no celular)
    function loadImage(file) {
        if ('createImageBitmap' in window) {
            return createImageBitmap(file, { imageOrientation: 'from-image' })
                .then((bitmap) => ({ img: bitmap, url: null, isBitmap: true }))
                .catch(() => loadViaImageElement(file));
        }
        return loadViaImageElement(file);
    }

    /**
     * Processa um arquivo de imagem e devolve um File padronizado (.jpg)
     * @param {File} file        - Arquivo de imagem original
     * @param {Object} userOpts  - Opções (mescladas com CONFIG.imageStandardization)
     * @returns {Promise<{file: File, objectUrl: string, width: number, height: number}>}
     */
    async function process(file, userOpts = {}) {
        const opts = getOptions(userOpts);
        const { img, url, isBitmap } = await loadImage(file);

        try {
            const iw = img.naturalWidth || img.width;
            const ih = img.naturalHeight || img.height;
            if (!iw || !ih) throw new Error('Imagem inválida');

            const cw = opts.width;
            const ch = opts.height;
            const targetRatio = cw / ch;
            const sourceRatio = iw / ih;

            // 'natural': preserva a proporção original (sem cortes e sem barras),
            // apenas reduz para caber no tamanho máximo.
            let canvasW = cw;
            let canvasH = ch;
            if (opts.mode === 'natural') {
                const s = Math.min(cw / iw, ch / ih, 1);
                canvasW = Math.max(1, Math.round(iw * s));
                canvasH = Math.max(1, Math.round(ih * s));
            }

            const canvas = document.createElement('canvas');
            canvas.width = canvasW;
            canvas.height = canvasH;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            if (opts.mode === 'natural') {
                // Redimensiona mantendo a proporção (sem padding/corte)
                ctx.drawImage(img, 0, 0, canvasW, canvasH);
            } else if (opts.mode === 'cover') {
                // ===== COVER: corta para preencher sem barras =====
                let sx, sy, sw, sh;
                if (sourceRatio > targetRatio) {
                    // Imagem mais larga que o quadro → corta as laterais
                    sh = ih;
                    sw = ih * targetRatio;
                    sx = (iw - sw) / 2;   // centralizado na horizontal
                    sy = 0;
                } else {
                    // Imagem mais alta que o quadro → corta em cima/embaixo
                    sw = iw;
                    sh = iw / targetRatio;
                    sx = 0;
                    sy = (ih - sh) * focusFactor(opts.focus);
                }
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvasW, canvasH);
            } else {
                // ===== CONTAIN: imagem inteira + fundo escuro (sem branco) =====
                ctx.fillStyle = opts.background;
                ctx.fillRect(0, 0, canvasW, canvasH);

                // Escala de encaixe, sem ampliar além do tamanho original
                const scale = Math.min(canvasW / iw, canvasH / ih, 1);
                const dw = iw * scale;
                const dh = ih * scale;
                ctx.drawImage(img, (canvasW - dw) / 2, (canvasH - dh) / 2, dw, dh);
            }

            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Falha ao converter imagem')), 'image/jpeg', opts.quality);
            });

            const nome = (file.name.replace(/\.[^/.]+$/, '') || 'oferta') + '.jpg';
            const processedFile = new File([blob], nome, { type: 'image/jpeg', lastModified: Date.now() });

            return {
                file: processedFile,
                objectUrl: URL.createObjectURL(processedFile),
                width: canvasW,
                height: canvasH
            };
        } finally {
            if (isBitmap) img.close();
            if (url) URL.revokeObjectURL(url);
        }
    }

    /**
     * Converte um PDF em imagem (JPEG) — renderiza a primeira página.
     * @param {File} file        - Arquivo PDF original
     * @param {Object} userOpts  - Opções (mescladas com CONFIG.imageStandardization)
     * @returns {Promise<{file: File, objectUrl: string, width: number, height: number}>}
     */
    async function fromPDF(file, userOpts = {}) {
        if (!window.pdfjsLib) {
            throw new Error('Biblioteca PDF (pdf.js) não carregada');
        }

        const opts = getOptions(userOpts);
        const data = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data }).promise;

        try {
            const page = await pdf.getPage(1);
            const vp1 = page.getViewport({ scale: 1 });

            // Renderiza cabendo dentro do tamanho máximo (sem ampliar demais),
            // limitado a 3x para não gerar telas gigantes.
            const scale = Math.min(3, opts.width / vp1.width, opts.height / vp1.height);
            const viewport = page.getViewport({ scale });

            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            const ctx = canvas.getContext('2d');

            await page.render({ canvasContext: ctx, viewport }).promise;

            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Falha ao converter imagem')), 'image/jpeg', opts.quality);
            });

            const nome = (file.name.replace(/\.pdf$/i, '') || 'oferta') + '.jpg';
            const processedFile = new File([blob], nome, { type: 'image/jpeg', lastModified: Date.now() });

            return {
                file: processedFile,
                objectUrl: URL.createObjectURL(processedFile),
                width: canvas.width,
                height: canvas.height
            };
        } finally {
            try { await pdf.destroy(); } catch (e) { /* ignora */ }
        }
    }

    return { process, getOptions, fromPDF };
})();

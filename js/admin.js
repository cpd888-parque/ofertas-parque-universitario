/**
 * Admin - Painel Administrativo
 * 
 * Gerencia ofertas: listar, fazer upload, excluir.
 * Em produção, tudo passa pelo Cloudflare Worker + R2.
 */

class AdminPanel {
    constructor() {
        this.ofertas = [];
        this.deleteTarget = null;

        this.init();
    }

    init() {
        // Verificar autenticação
        if (sessionStorage.getItem(CONFIG.admin.sessionKey) !== 'true') {
            window.location.href = 'login.html';
            return;
        }

        this.cacheElements();
        this.bindEvents();
        this.loadOfertas();
    }

    cacheElements() {
        this.loadingEl = document.getElementById('adminLoading');
        this.listEl = document.getElementById('ofertasList');
        this.emptyState = document.getElementById('emptyAdminState');

        // Upload modal
        this.uploadModal = document.getElementById('uploadModal');
        this.novaOfertaBtn = document.getElementById('novaOfertaBtn');
        this.closeModalBtn = document.getElementById('closeModalBtn');
        this.cancelUploadBtn = document.getElementById('cancelUploadBtn');
        this.confirmUploadBtn = document.getElementById('confirmUploadBtn');

        // Drop zone
        this.dropZone = document.getElementById('dropZone');
        this.fileInput = document.getElementById('fileInput');
        this.dropZoneContent = document.getElementById('dropZoneContent');

        // Preview
        this.previewArea = document.getElementById('previewArea');
        this.previewImage = document.getElementById('previewImage');
        this.previewPDF = document.getElementById('previewPDF');
        this.pdfFileName = document.getElementById('pdfFileName');
        this.removeFileBtn = document.getElementById('removeFileBtn');

        // Progress
        this.progressArea = document.getElementById('progressArea');
        this.progressFill = document.getElementById('progressFill');
        this.progressText = document.getElementById('progressText');

        // Messages
        this.uploadMessage = document.getElementById('uploadMessage');

        // Delete modal
        this.deleteModal = document.getElementById('deleteModal');
        this.deleteItemName = document.getElementById('deleteItemName');
        this.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        this.cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        this.closeDeleteModalBtn = document.getElementById('closeDeleteModalBtn');

        // Logout
        this.logoutBtn = document.getElementById('logoutButton');

        this.selectedFile = null;
        this.processedFile = null;
        this.previewObjectUrl = null;
    }

    bindEvents() {
        // Logout
        this.logoutBtn.addEventListener('click', () => {
            sessionStorage.removeItem(CONFIG.admin.sessionKey);
            window.location.href = 'login.html';
        });

        // Abrir/fechar modal de upload
        this.novaOfertaBtn.addEventListener('click', () => this.openUploadModal());
        this.closeModalBtn.addEventListener('click', () => this.closeUploadModal());
        this.cancelUploadBtn.addEventListener('click', () => this.closeUploadModal());

        // Fechar modal ao clicar fora
        this.uploadModal.addEventListener('click', (e) => {
            if (e.target === this.uploadModal) this.closeUploadModal();
        });

        // Fechar com ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (!this.uploadModal.classList.contains('hidden')) {
                    this.closeUploadModal();
                }
                if (!this.deleteModal.classList.contains('hidden')) {
                    this.closeDeleteModal();
                }
            }
        });

        // Upload - clique e drag-and-drop
        this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        this.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.dropZone.classList.add('drag-over');
        });
        this.dropZone.addEventListener('dragleave', () => {
            this.dropZone.classList.remove('drag-over');
        });
        this.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.dropZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.validateAndPreview(files[0]);
            }
        });

        this.removeFileBtn.addEventListener('click', () => this.removeSelectedFile());
        this.confirmUploadBtn.addEventListener('click', () => this.uploadOferta());

        // Delete modal
        this.confirmDeleteBtn.addEventListener('click', () => this.confirmDelete());
        this.cancelDeleteBtn.addEventListener('click', () => this.closeDeleteModal());
        this.closeDeleteModalBtn.addEventListener('click', () => this.closeDeleteModal());
        this.deleteModal.addEventListener('click', (e) => {
            if (e.target === this.deleteModal) this.closeDeleteModal();
        });
    }

    // ===== CARREGAR OFERTAS =====
    async loadOfertas() {
        this.showLoading();

        try {
            if (CONFIG.api.baseUrl) {
                const response = await fetch(`${CONFIG.api.baseUrl}${CONFIG.api.offersEndpoint}`);
                if (response.ok) {
                    this.ofertas = await response.json();
                    this.renderList();
                    this.hideLoading();
                    return;
                }
            }
        } catch (e) {
            console.log('API não disponível, usando dados locais');
        }

        // Fallback: sessionStorage ou demo
        this.ofertas = this.getLocalOfertas();
        this.renderList();
        this.hideLoading();
    }

    getLocalOfertas() {
        const stored = sessionStorage.getItem('ofertas_data');
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch {
                return [...CONFIG.demoOffers];
            }
        }
        // Salvar demo data na primeira vez
        const demo = [...CONFIG.demoOffers];
        sessionStorage.setItem('ofertas_data', JSON.stringify(demo));
        return demo;
    }

    saveLocalOfertas() {
        sessionStorage.setItem('ofertas_data', JSON.stringify(this.ofertas));
    }

    // ===== RENDERIZAR LISTA =====
    renderList() {
        this.listEl.innerHTML = '';

        if (this.ofertas.length === 0) {
            this.listEl.classList.add('hidden');
            this.emptyState.classList.remove('hidden');
            return;
        }

        this.listEl.classList.remove('hidden');
        this.emptyState.classList.add('hidden');

        // Ordenar por ordem
        const sorted = [...this.ofertas].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

        sorted.forEach((oferta, index) => {
            const item = document.createElement('div');
            item.className = 'oferta-item';
            item.dataset.index = index;

            // Thumbnail
            const thumb = document.createElement('div');
            thumb.className = 'oferta-item-thumb';

            if (this.isPDF(oferta)) {
                thumb.innerHTML = '<span class="pdf-thumb">📄</span>';
            } else {
                const img = document.createElement('img');
                img.src = oferta.url;
                img.alt = oferta.nome || 'Oferta';
                img.loading = 'lazy';
                img.onerror = () => {
                    thumb.innerHTML = '<span style="font-size:1.5rem;opacity:0.4">🖼️</span>';
                };
                thumb.appendChild(img);
            }

            // Info
            const info = document.createElement('div');
            info.className = 'oferta-item-info';

            const nome = document.createElement('div');
            nome.className = 'nome';
            nome.textContent = oferta.nome || `Oferta ${index + 1}`;

            const meta = document.createElement('div');
            meta.className = 'meta';
            const data = oferta.data_upload
                ? new Date(oferta.data_upload).toLocaleDateString('pt-BR')
                : '—';
            const tipo = this.getFileTypeLabel(oferta.tipo || oferta.url);
            meta.innerHTML = `<span>📅 ${data}</span> · <span>📁 ${tipo}</span>`;

            info.appendChild(nome);
            info.appendChild(meta);

            // Actions
            const actions = document.createElement('div');
            actions.className = 'oferta-item-actions';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-sm btn-danger';
            deleteBtn.innerHTML = '🗑️ Excluir';
            deleteBtn.addEventListener('click', () => this.openDeleteModal(oferta));

            actions.appendChild(deleteBtn);

            item.appendChild(thumb);
            item.appendChild(info);
            item.appendChild(actions);
            this.listEl.appendChild(item);
        });
    }

    // ===== UPLOAD - MODAL =====
    openUploadModal() {
        this.selectedFile = null;
        this.processedFile = null;
        this.revokePreviewUrl();
        this.fileInput.value = '';
        this.dropZone.classList.remove('hidden');
        this.previewArea.classList.add('hidden');
        this.progressArea.classList.add('hidden');
        this.uploadMessage.classList.add('hidden');
        this.confirmUploadBtn.disabled = true;
        this.uploadModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    closeUploadModal() {
        this.uploadModal.classList.add('hidden');
        document.body.style.overflow = '';
        this.selectedFile = null;
        this.processedFile = null;
        this.revokePreviewUrl();
        this.fileInput.value = '';
    }

    handleFileSelect(e) {
        const files = e.target.files;
        if (files.length > 0) {
            this.validateAndPreview(files[0]);
        }
    }

    async validateAndPreview(file) {
        // Validar tamanho
        if (file.size > CONFIG.admin.maxFileSize) {
            this.showUploadMessage('O arquivo excede o limite de 20MB.', 'error');
            return;
        }

        // Validar tipo/extensão
        const ext = file.name.split('.').pop().toLowerCase();
        if (!CONFIG.admin.allowedExtensions.includes(ext)) {
            this.showUploadMessage('Tipo de arquivo não suportado. Use JPG, PNG, WEBP ou PDF.', 'error');
            return;
        }

        this.selectedFile = file;
        this.processedFile = null;
        this.revokePreviewUrl();

        const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

        // Imagens são padronizadas; PDFs são convertidos em imagem (primeira página),
        // para que a oferta apareça como imagem na tela (igual aos flyers).
        try {
            this.showUploadMessage(isPDF ? 'Convertendo PDF para imagem...' : 'Padronizando imagem...', 'info');
            const result = isPDF
                ? await ImageProcessor.fromPDF(file, CONFIG.imageStandardization)
                : await ImageProcessor.process(file, CONFIG.imageStandardization);
            this.processedFile = result.file;
            this.previewObjectUrl = result.objectUrl;
        } catch (e) {
            console.warn('Não foi possível processar, enviando arquivo original:', e);
            this.processedFile = file;
        }
        this.hideUploadMessage();

        this.showPreview(file);
        this.confirmUploadBtn.disabled = false;
    }

    showPreview(file) {
        this.dropZone.classList.add('hidden');
        this.previewArea.classList.remove('hidden');
        this.uploadMessage.classList.add('hidden');

        const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

        // PDF que não pôde ser convertido mantém o fallback de visualização
        if (isPDF && !this.previewObjectUrl) {
            this.previewImage.classList.add('hidden');
            this.previewPDF.classList.remove('hidden');
            this.pdfFileName.textContent = file.name;
        } else {
            this.previewPDF.classList.add('hidden');
            this.previewImage.classList.remove('hidden');
            // Mostrar a imagem já processada (exatamente como será publicada)
            this.previewImage.src = this.previewObjectUrl || URL.createObjectURL(file);
        }
    }

    revokePreviewUrl() {
        if (this.previewObjectUrl) {
            URL.revokeObjectURL(this.previewObjectUrl);
            this.previewObjectUrl = null;
        }
    }

    removeSelectedFile() {
        this.selectedFile = null;
        this.processedFile = null;
        this.revokePreviewUrl();
        this.fileInput.value = '';
        this.dropZone.classList.remove('hidden');
        this.previewArea.classList.add('hidden');
        this.confirmUploadBtn.disabled = true;
    }

    // A padronização das imagens agora é feita por js/image-processor.js
    // (ImageProcessor.process) durante a seleção do arquivo, garantindo
    // tamanho/proporção uniformes e sem barras brancas.

    // ===== UPLOAD - ENVIAR =====
    async uploadOferta() {
        if (!this.selectedFile) return;

        this.confirmUploadBtn.disabled = true;
        this.progressArea.classList.remove('hidden');
        this.uploadMessage.classList.add('hidden');
        this.setProgress(0);

        // A imagem já foi padronizada na seleção (ImageProcessor).
        // PDFs são enviados sem alteração.
        const fileToUpload = this.processedFile || this.selectedFile;

        try {
            if (CONFIG.api.baseUrl) {
                // Upload via Worker
                const formData = new FormData();
                formData.append('file', fileToUpload);

                const xhr = new XMLHttpRequest();

                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const pct = 15 + Math.round((e.loaded / e.total) * 75);
                        this.setProgress(pct);
                    }
                };

                await new Promise((resolve, reject) => {
                    xhr.onload = () => {
                        if (xhr.status === 200) resolve();
                        else reject(new Error('Falha no upload'));
                    };
                    xhr.onerror = () => reject(new Error('Erro de conexão'));
                    xhr.open('POST', `${CONFIG.api.baseUrl}${CONFIG.api.uploadEndpoint}`);
                    xhr.send(formData);
                });
            } else {
                // Upload local (demo)
                await this.simulateUpload();
            }

            // Adicionar oferta à lista local
            const newOferta = {
                nome: this.selectedFile.name.replace(/\.[^/.]+$/, ''),
                tipo: fileToUpload.type || `image/${this.selectedFile.name.split('.').pop()}`,
                url: URL.createObjectURL(fileToUpload),
                data_upload: new Date().toISOString(),
                ordem: this.ofertas.length + 1
            };

            this.ofertas.push(newOferta);
            this.saveLocalOfertas();
            this.renderList();

            this.showUploadMessage('Oferta publicada com sucesso! ✅', 'success');
            this.setProgress(100);

            setTimeout(() => {
                this.closeUploadModal();
            }, 1200);

        } catch (err) {
            this.showUploadMessage('Erro ao enviar oferta. Tente novamente.', 'error');
            this.confirmUploadBtn.disabled = false;
            this.setProgress(0);
        }
    }

    simulateUpload() {
        return new Promise((resolve) => {
            let progress = 0;
            const interval = setInterval(() => {
                progress += Math.random() * 15 + 5;
                if (progress >= 100) {
                    progress = 100;
                    clearInterval(interval);
                    resolve();
                }
                this.setProgress(Math.min(progress, 100));
            }, 150);
        });
    }

    setProgress(pct) {
        this.progressFill.style.width = `${pct}%`;
        this.progressText.textContent = pct < 100 ? `Enviando... ${Math.round(pct)}%` : 'Enviado!';
    }

    // ===== EXCLUIR =====
    openDeleteModal(oferta) {
        this.deleteTarget = oferta;
        this.deleteItemName.textContent = oferta.nome || 'Oferta sem nome';
        this.deleteModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    closeDeleteModal() {
        this.deleteModal.classList.add('hidden');
        document.body.style.overflow = '';
        this.deleteTarget = null;
    }

    async confirmDelete() {
        if (!this.deleteTarget) return;

        this.confirmDeleteBtn.disabled = true;
        this.confirmDeleteBtn.textContent = 'Excluindo...';

        try {
            if (CONFIG.api.baseUrl) {
                // Exclusão via Worker
                const response = await fetch(`${CONFIG.api.baseUrl}${CONFIG.api.deleteEndpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nome: this.deleteTarget.nome })
                });

                if (!response.ok) {
                    throw new Error('Falha na exclusão');
                }
            }

            // Remover da lista local
            this.ofertas = this.ofertas.filter(o => o.nome !== this.deleteTarget.nome);
            this.saveLocalOfertas();
            this.renderList();

            this.closeDeleteModal();
        } catch (err) {
            alert('Erro ao excluir oferta. Tente novamente.');
        }

        this.confirmDeleteBtn.disabled = false;
        this.confirmDeleteBtn.textContent = 'Excluir';
    }

    // ===== UTILITÁRIOS =====
    isPDF(oferta) {
        return oferta.tipo === 'application/pdf' ||
               oferta.url?.toLowerCase().endsWith('.pdf');
    }

    getFileTypeLabel(tipo) {
        if (!tipo) return 'Desconhecido';
        if (tipo.includes('pdf')) return 'PDF';
        if (tipo.includes('webp')) return 'WEBP';
        if (tipo.includes('png')) return 'PNG';
        if (tipo.includes('jpeg') || tipo.includes('jpg')) return 'JPG';
        if (tipo.includes('svg')) return 'SVG';
        return tipo.split('/').pop()?.toUpperCase() || '—';
    }

    showLoading() {
        this.loadingEl.classList.remove('hidden');
        this.listEl.classList.add('hidden');
        this.emptyState.classList.add('hidden');
    }

    hideLoading() {
        this.loadingEl.classList.add('hidden');
    }

    showUploadMessage(msg, type) {
        this.uploadMessage.textContent = msg;
        this.uploadMessage.className = `upload-message ${type}`;
        this.uploadMessage.classList.remove('hidden');
    }

    hideUploadMessage() {
        this.uploadMessage.classList.add('hidden');
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    new AdminPanel();
});

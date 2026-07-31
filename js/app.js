/**
 * App de Ofertas - Interface Pública
 * Estilo TikTok/Reels para visualização de ofertas
 */

class OfertasApp {
    constructor() {
        this.ofertas = [];
        this.currentIndex = 0;
        this.isTransitioning = false;
        this.touchStartY = 0;
        this.touchCurrentY = 0;
        this.isSwiping = false;
        this.isPullToRefresh = false;
        this.pullStartY = 0;
        this.isPullToCredits = false;
        this.creditStartY = 0;

        // Elementos do DOM
        this.container = document.getElementById('ofertasContainer');
        this.counter = document.getElementById('ofertaCounter');
        this.loading = document.getElementById('loadingSpinner');
        this.emptyState = document.getElementById('emptyState');
        this.swipeIndicator = document.getElementById('swipeIndicator');
        this.pullToRefresh = document.getElementById('pullToRefresh');
        this.creditFooter = document.getElementById('creditFooter');

        this.init();
    }

    async init() {
        this.showLoading();
        await this.loadOfertas();
        this.hideLoading();

        if (this.ofertas.length === 0) {
            this.showEmptyState();
            return;
        }

        this.hideEmptyState();
        this.renderOfertas();
        this.setupEventListeners();
        // Esconder swipe indicator se tiver apenas 1 oferta
        if (this.ofertas.length <= 1 && this.swipeIndicator) {
            this.swipeIndicator.style.display = 'none';
        }
    }

    async loadOfertas() {
        try {
            // Tentar carregar do Worker em produção
            if (CONFIG.api.baseUrl) {
                const response = await fetch(`${CONFIG.api.baseUrl}${CONFIG.api.offersEndpoint}`);
                if (response.ok) {
                    this.ofertas = await response.json();
                    return;
                }
            }
        } catch (e) {
            console.log('API não disponível, usando dados de demonstração');
        }

        // Fallback para dados de demonstração
        this.ofertas = CONFIG.demoOffers || [];
    }

    renderOfertas() {
        this.container.innerHTML = '';

        this.ofertas.forEach((oferta, index) => {
            const card = document.createElement('div');
            card.className = `oferta-card ${index === 0 ? 'active' : index === 1 ? 'next' : ''}`;
            card.dataset.index = index;

            const wrapper = document.createElement('div');
            wrapper.className = 'oferta-imagem-wrapper';

            if (this.isPDF(oferta)) {
                wrapper.appendChild(this.createPDFFallback(oferta));
            } else {
                const img = document.createElement('img');
                img.className = 'oferta-imagem loading';
                img.dataset.src = oferta.url;
                img.alt = oferta.nome || 'Oferta';
                img.draggable = false;

                // Lazy loading com Intersection Observer
                img.loading = 'lazy';

                img.onload = () => {
                    img.classList.remove('loading');
                    img.classList.add('loaded');
                    this.ajustarImagemSemBarras(img);
                };

                img.onerror = () => {
                    img.classList.remove('loading');
                    img.classList.add('loaded');
                    img.style.objectFit = 'contain';
                    img.style.padding = '1rem';
                    // Mostrar fallback visual
                    wrapper.style.background = 'var(--bg-secondary)';
                };

                wrapper.appendChild(img);
            }

            card.appendChild(wrapper);
            this.container.appendChild(card);
        });

        // Iniciar lazy loading
        this.setupLazyLoading();
        this.updateCounter();
    }

    isPDF(oferta) {
        return oferta.tipo === 'application/pdf' ||
               oferta.url?.toLowerCase().endsWith('.pdf');
    }

    // ===== AJUSTE AUTOMÁTICO PARA REMOVER BARRAS PRETAS =====
    ajustarImagemSemBarras(img) {
        // Aguardar um frame para o layout estar pronto
        requestAnimationFrame(() => {
            const nw = img.naturalWidth;
            const nh = img.naturalHeight;
            if (!nw || !nh) return;

            const wrapper = img.closest('.oferta-imagem-wrapper');
            if (!wrapper) return;

            const wrapperW = wrapper.clientWidth;
            const wrapperH = wrapper.clientHeight;
            if (!wrapperW || !wrapperH) return;

            // Proporções
            const ratioImg = nw / nh;       // ex: 0.65
            const ratioBox = wrapperW / wrapperH; // ex: 0.87

            // Se a imagem for mais alta que o container (ratioImg < ratioBox)
            // usa cover para preencher sem barras laterais
            if (ratioImg < ratioBox) {
                img.style.objectFit = 'cover';
                img.style.objectPosition = 'top center';
            } else {
                // Se for mais larga, usa contain (encaixa pela largura)
                img.style.objectFit = 'contain';
                img.style.objectPosition = 'center';
            }
        });
    }

    createPDFFallback(oferta) {
        const fallback = document.createElement('div');
        fallback.className = 'oferta-pdf-fallback';

        const icon = document.createElement('div');
        icon.className = 'pdf-icon';
        icon.textContent = 'PDF';
        fallback.appendChild(icon);

        const nome = document.createElement('p');
        nome.className = 'pdf-nome';
        nome.textContent = oferta.nome || 'Documento PDF';
        fallback.appendChild(nome);

        const btn = document.createElement('a');
        btn.className = 'btn-pdf';
        btn.href = oferta.url;
        btn.target = '_blank';
        btn.rel = 'noopener noreferrer';
        btn.textContent = 'Abrir PDF';
        fallback.appendChild(btn);

        return fallback;
    }

    setupLazyLoading() {
        if ('IntersectionObserver' in window) {
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                            delete img.dataset.src;
                            img.addEventListener('load', () => this.ajustarImagemSemBarras(img), { once: true });
                        }
                        observer.unobserve(img);
                    }
                });
            }, {
                rootMargin: '200px 0px',
                threshold: 0.1
            });

            document.querySelectorAll('.oferta-imagem[data-src]').forEach(img => {
                observer.observe(img);
            });
        } else {
            // Fallback: carregar todas as imagens
            document.querySelectorAll('.oferta-imagem[data-src]').forEach(img => {
                img.src = img.dataset.src;
                delete img.dataset.src;
                img.addEventListener('load', () => this.ajustarImagemSemBarras(img), { once: true });
            });
        }
    }

    setupEventListeners() {
        // Touch events (mobile)
        if (CONFIG.display.enableSwipe) {
            this.container.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: true });
            this.container.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: true });
            this.container.addEventListener('touchend', (e) => this.onTouchEnd(e), { passive: true });
        }

        // Mouse wheel / scroll (desktop)
        if (CONFIG.display.enableScroll) {
            this.container.addEventListener('wheel', (e) => this.onWheel(e), { passive: true });
        }

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                this.next();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                this.prev();
            }
        });

        // Double-tap para zoom nas imagens
        this.setupDoubleTap();

        // Esconder indicador de swipe após primeira interação
        const hideSwipeIndicator = () => {
            if (this.swipeIndicator) {
                this.swipeIndicator.style.opacity = '0';
                this.swipeIndicator.style.transition = 'opacity 0.5s ease';
                setTimeout(() => {
                    if (this.swipeIndicator) {
                        this.swipeIndicator.style.display = 'none';
                    }
                }, 500);
            }
        };

        this.container.addEventListener('touchstart', hideSwipeIndicator, { once: true });
        this.container.addEventListener('wheel', hideSwipeIndicator, { once: true });
    }

    // ===== TOUCH HANDLING =====
    onTouchStart(e) {
        const isLastCard = this.currentIndex === this.ofertas.length - 1;

        // Pull-to-refresh: detectar se está no topo (primeira oferta)
        if (this.currentIndex === 0) {
            this.pullStartY = e.touches[0].clientY;
            this.isPullToRefresh = true;
        } else {
            this.isPullToRefresh = false;
        }

        // Pull-to-credits: detectar se está na última oferta
        if (isLastCard) {
            this.creditStartY = e.touches[0].clientY;
            this.isPullToCredits = true;
        } else {
            this.isPullToCredits = false;
        }

        if (this.isTransitioning) return;
        this.touchStartY = e.touches[0].clientY;
        this.isSwiping = true;

        // Remover transição para movimento livre
        document.querySelectorAll('.oferta-card').forEach(card => {
            card.classList.add('swiping');
        });
    }

    onTouchMove(e) {
        // Pull-to-refresh
        if (this.isPullToRefresh && this.currentIndex === 0) {
            const diff = e.touches[0].clientY - this.pullStartY;
            if (diff > 0) {
                const pull = Math.min(diff, 120);
                this.container.style.transform = `translateY(${pull * 0.4}px)`;
                this.container.style.transition = 'none';

                if (this.pullToRefresh) {
                    if (pull > 80) {
                        this.pullToRefresh.classList.add('ready');
                        this.pullToRefresh.classList.remove('visible');
                    } else if (pull > 10) {
                        this.pullToRefresh.classList.add('visible');
                        this.pullToRefresh.classList.remove('ready');
                    } else {
                        this.pullToRefresh.classList.remove('visible', 'ready');
                    }
                }
                return;
            }
        }
        this.isPullToRefresh = false;

        // Pull-to-credits: na última oferta, puxar para cima
        if (this.isPullToCredits && this.currentIndex === this.ofertas.length - 1) {
            const diff = this.creditStartY - e.touches[0].clientY;
            if (diff > 0) {
                const pull = Math.min(diff, 120);
                // Puxar o container para cima para revelar o footer
                this.container.style.transform = `translateY(${-pull * 0.3}px)`;
                this.container.style.transition = 'none';

                if (this.creditFooter) {
                    if (pull > 60) {
                        this.creditFooter.classList.add('visible');
                    } else {
                        this.creditFooter.classList.remove('visible');
                    }
                }
                return;
            }
        }
        this.isPullToCredits = false;

        if (!this.isSwiping || this.isTransitioning) return;
        this.touchCurrentY = e.touches[0].clientY;
        const diff = this.touchCurrentY - this.touchStartY;

        // Mover o card atual junto com o dedo
        const activeCard = this.getCard(this.currentIndex);
        if (activeCard) {
            activeCard.style.transform = `translateY(${diff}px)`;
        }

        // Mostrar próximo/anterior parcialmente
        if (diff < 0) {
            const nextCard = this.getCard(this.currentIndex + 1);
            if (nextCard) {
                const nextOffset = 100 + (diff / window.innerHeight) * 100 * 0.5;
                nextCard.style.transform = `translateY(${Math.max(nextOffset, 50)}%)`;
                nextCard.style.opacity = '0.95';
            }
        } else {
            const prevCard = this.getCard(this.currentIndex - 1);
            if (prevCard) {
                const prevOffset = -100 + (diff / window.innerHeight) * 100 * 0.5;
                prevCard.style.transform = `translateY(${Math.min(prevOffset, -50)}%)`;
                prevCard.style.opacity = '0.5';
            }
        }
    }

    onTouchEnd(e) {
        // Pull-to-refresh: soltou com mais de 80px puxado
        if (this.isPullToRefresh && this.currentIndex === 0) {
            const diff = e.changedTouches[0].clientY - this.pullStartY;
            // Resetar posição
            this.container.style.transform = '';
            this.container.style.transition = '';

            if (diff > 80 && this.pullToRefresh) {
                this.pullToRefresh.classList.remove('visible', 'ready');
                this.pullToRefresh.classList.add('loading');
                this.pullToRefresh.querySelector('.pull-to-refresh-text').textContent = 'Atualizando...';
                setTimeout(() => {
                    window.location.reload();
                }, 400);
                return;
            }

            if (this.pullToRefresh) {
                this.pullToRefresh.classList.remove('visible', 'ready', 'loading');
                this.pullToRefresh.querySelector('.pull-to-refresh-text').textContent = 'Solte para atualizar';
            }
            this.isPullToRefresh = false;
            return;
        }
        this.isPullToRefresh = false;

        // Pull-to-credits: na última oferta
        if (this.isPullToCredits && this.currentIndex === this.ofertas.length - 1) {
            const diff = this.creditStartY - e.changedTouches[0].clientY;
            // Resetar posição
            this.container.style.transform = '';
            this.container.style.transition = '';

            if (diff > 60 && this.creditFooter) {
                // Mostrar crédito brevemente
                this.creditFooter.classList.remove('hiding');
                this.creditFooter.classList.add('visible');
                setTimeout(() => {
                    this.creditFooter.classList.remove('visible');
                    this.creditFooter.classList.add('hiding');
                    setTimeout(() => {
                        this.creditFooter.classList.remove('hiding');
                    }, 500);
                }, 2000);
            }
            this.isPullToCredits = false;
            return;
        }
        this.isPullToCredits = false;

        if (!this.isSwiping) return;
        this.isSwiping = false;

        const diff = this.touchCurrentY - this.touchStartY;
        const threshold = window.innerHeight * 0.15;

        // Remover estilos de movimento livre
        document.querySelectorAll('.oferta-card').forEach(card => {
            card.classList.remove('swiping');
            card.style.transform = '';
            card.style.opacity = '';
        });

        if (Math.abs(diff) > threshold) {
            if (diff < 0) {
                this.next();
            } else {
                this.prev();
            }
        }

        this.touchStartY = 0;
        this.touchCurrentY = 0;
    }

    // ===== WHEEL HANDLING =====
    onWheel(e) {
        if (this.isTransitioning) return;

        // Debounce para evitar múltiplas navegações
        if (this.wheelTimeout) return;

        if (e.deltaY > 0) {
            this.next();
        } else {
            this.prev();
        }

        this.wheelTimeout = setTimeout(() => {
            this.wheelTimeout = null;
        }, 500);
    }

    // ===== DOUBLE-TAP PARA ZOOM =====
    setupDoubleTap() {
        let lastTap = 0;
        let zoomedCard = null;

        this.container.addEventListener('click', (e) => {
            const now = Date.now();
            const timeSince = now - lastTap;

            if (timeSince < 300 && timeSince > 0) {
                // Double tap detected
                const card = e.target.closest('.oferta-card');
                if (!card) return;

                const img = card.querySelector('.oferta-imagem');
                if (!img) return;

                if (zoomedCard === card) {
                    img.style.objectFit = 'contain';
                    img.style.transform = 'scale(1)';
                    zoomedCard = null;
                } else {
                    // Reset previous zoom
                    if (zoomedCard) {
                        const prevImg = zoomedCard.querySelector('.oferta-imagem');
                        if (prevImg) {
                            prevImg.style.objectFit = 'contain';
                            prevImg.style.transform = 'scale(1)';
                        }
                    }
                    img.style.objectFit = 'cover';
                    img.style.transform = 'scale(1.05)';
                    img.style.transition = 'transform 0.3s ease, object-fit 0.3s ease';
                    zoomedCard = card;
                }
            }
            lastTap = now;
        });
    }

    // ===== NAVEGAÇÃO =====
    next() {
        if (this.isTransitioning) return;
        if (this.currentIndex >= this.ofertas.length - 1) return;

        this.isTransitioning = true;
        this.currentIndex++;

        this.updateCards();
        this.loadNearbyImages();

        setTimeout(() => {
            this.isTransitioning = false;
        }, CONFIG.display.transitionDuration);
    }

    prev() {
        if (this.isTransitioning) return;
        if (this.currentIndex <= 0) return;

        this.isTransitioning = true;
        this.currentIndex--;

        this.updateCards();
        this.loadNearbyImages();

        setTimeout(() => {
            this.isTransitioning = false;
        }, CONFIG.display.transitionDuration);
    }

    updateCards() {
        const cards = document.querySelectorAll('.oferta-card');

        cards.forEach((card, index) => {
            card.classList.remove('active', 'next', 'prev');

            if (index === this.currentIndex) {
                card.classList.add('active');
            } else if (index === this.currentIndex + 1) {
                card.classList.add('next');
            } else if (index < this.currentIndex) {
                card.classList.add('prev');
            } else {
                card.classList.add('next');
            }

            // Reset zoom ao navegar
            const img = card.querySelector('.oferta-imagem');
            if (img) {
                img.style.objectFit = '';
                img.style.transform = '';
                img.style.transition = '';
            }
        });

        this.updateCounter();
    }

    loadNearbyImages() {
        // Carregar imagens próximas (se ainda não carregaram)
        const indices = [this.currentIndex, this.currentIndex + 1, this.currentIndex - 1];
        indices.forEach(idx => {
            if (idx >= 0 && idx < this.ofertas.length) {
                const card = this.getCard(idx);
                if (card) {
                    const img = card.querySelector('.oferta-imagem[data-src]');
                    if (img) {
                        img.src = img.dataset.src;
                        delete img.dataset.src;
                    }
                }
            }
        });
    }

    // ===== UTILITÁRIOS =====
    getCard(index) {
        return document.querySelector(`.oferta-card[data-index="${index}"]`);
    }

    updateCounter() {
        if (this.counter) {
            this.counter.textContent = `${this.currentIndex + 1}/${this.ofertas.length}`;
        }
    }

    showLoading() {
        if (this.loading) {
            this.loading.classList.remove('hidden');
        }
    }

    hideLoading() {
        if (this.loading) {
            this.loading.classList.add('hidden');
        }
    }

    showEmptyState() {
        if (this.emptyState) {
            this.emptyState.classList.remove('hidden');
        }
    }

    hideEmptyState() {
        if (this.emptyState) {
            this.emptyState.classList.add('hidden');
        }
    }
}

// Inicializar quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    new OfertasApp();
});

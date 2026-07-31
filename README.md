# 🛒 Ofertas do Mercado

Sistema de divulgação de ofertas de supermercado no estilo TikTok/Reels/Stories.

## 🚀 Tecnologias

- **Frontend:** HTML5, CSS3, JavaScript ES6
- **Backend:** Cloudflare Workers (via Pages Functions)
- **Armazenamento:** Cloudflare R2
- **Hospedagem:** Cloudflare Pages
- **Versionamento:** GitHub

## 📁 Estrutura

```
/
├── index.html              # Página pública (visualização de ofertas)
├── admin.html              # Painel administrativo
├── login.html              # Tela de login
├── css/
│   ├── style.css           # Estilos globais
│   └── admin.css           # Estilos do painel admin
├── js/
│   ├── app.js              # Lógica da página pública
│   ├── admin.js            # Lógica do painel admin
│   └── login.js            # Lógica do login
├── workers/
│   └── oferta-worker.js    # Cloudflare Worker (API + R2)
├── functions/api/
│   └── [[route]].js        # Pages Functions (wrapper do Worker)
├── assets/                 # Imagens placeholder (demo local)
├── config/
│   └── config.js           # Configurações
├── wrangler.toml           # Config do Worker
└── README.md
```

## 🧪 Desenvolvimento Local

1. Abra a pasta do projeto no VS Code
2. Use a extensão **Live Server** para servir os arquivos localmente
3. Acesse `http://localhost:5500`
4. Login no admin: `http://localhost:5500/login.html` (senha: `admin123`)

Sem configurar o Worker, o sistema funciona com **dados de demonstração** localmente.

## ☁️ Deploy no Cloudflare Pages

### Pré-requisitos

- [Conta GitHub](https://github.com)
- [Conta Cloudflare](https://dash.cloudflare.com)
- [Node.js](https://nodejs.org) + `npm` instalado
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/):
  ```bash
  npm install -g wrangler
  ```

### Passo a passo

#### 1. Criar Bucket R2

```bash
npx wrangler r2 bucket create ofertas-supermercado
```

#### 2. Configurar autenticação do Wrangler

```bash
npx wrangler login
```

#### 3. Ajustar o wrangler.toml

Edite `wrangler.toml` se necessário:
- Altere `bucket_name` se criou com outro nome
- O nome em `[[r2_buckets]]` com `binding = "OFERTAS_BUCKET"` deve permanecer igual

#### 4. Publicar o Worker (opcional - API standalone)

```bash
npx wrangler deploy
```

#### 5. Criar projeto no GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/seu-usuario/ofertas-site.git
git push -u origin main
```

#### 6. Conectar ao Cloudflare Pages

1. Acesse [Cloudflare Dashboard → Pages](https://dash.cloudflare.com/?to=/:account/pages)
2. Clique **Create a Pages project** → **Connect to Git**
3. Selecione o repositório `ofertas-site`
4. Configurações de build:
   - **Framework:** None
   - **Build output:** `/` (raiz)
   - **Build command:** (vazio)

> ⚡ O Cloudflare Pages detecta automaticamente a pasta `/functions/` e ativa o Worker como **Pages Functions**, servindo tanto os arquivos estáticos quanto a API.

#### 7. Configurar R2 no Pages

No Pages Project → **Settings** → **Functions** → **R2 Bucket bindings**:

| Variável | Bucket |
|----------|--------|
| `OFERTAS_BUCKET` | `ofertas-supermercado` |

#### 8. Configurar senha (segurança)

A senha do admin está hardcoded no Worker. Para maior segurança em produção:

```bash
# Como variável de ambiente (recomendado):
npx wrangler secret put ADMIN_PASSWORD

# Depois altere o worker para ler de env.ADMIN_PASSWORD
```

#### 9. Configurar domínio personalizado (opcional)

No Pages Project → **Custom domains** → adicione seu domínio.

#### 10. Publicar

Faça um novo commit que o Cloudflare Pages publica automaticamente:

```bash
git add .
git commit -m "Deploy: configuração produção"
git push
```

### Configuração pós-deploy

Edite `config/config.js` no GitHub e altere:

```js
api: {
    baseUrl: 'https://seudominio.com', // ou URL do Pages
    // ...
}
```

## 🔄 Fluxo de Upload

```
Administrador → Painel Admin → Seleciona imagem
    ↓
Cloudflare Worker → Valida arquivo
    ↓
Cloudflare R2 (bucket) → Armazena imagem
    ↓
Atualiza ofertas.json (no R2)
    ↓
Site público → Mostra nova oferta (tempo real)
```

## 📦 Funcionalidades

### ✅ Fase 1 - Interface Pública
- Interface no estilo Reels/TikTok
- Navegação por swipe, scroll e teclado
- Lazy loading de imagens
- Suporte a PDF
- Design responsivo e modo escuro

### ✅ Fase 2 - Painel Administrativo
- Login com senha única
- Upload por clique e drag-and-drop
- Barra de progresso
- Exclusão de ofertas
- Preview antes de enviar

### ✅ Fase 3 - Cloudflare Worker + R2
- API REST via Cloudflare Worker
- Armazenamento em Cloudflare R2
- Catálogo de ofertas em JSON (ofertas.json)
- Servir assets diretamente do R2
- Deploy automático via GitHub + Pages

### 🔜 Fase 4 - Testes e otimizações

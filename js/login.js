/**
 * Login - Autenticação do Administrador
 * 
 * Sistema simplificado: senha única definida no config.js
 * Em produção, a validação será feita via Cloudflare Worker.
 */

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    const passwordInput = document.getElementById('password');
    const toggleBtn = document.getElementById('togglePassword');
    const errorDiv = document.getElementById('loginError');
    const errorMessage = document.getElementById('loginErrorMessage');
    const loginButton = document.getElementById('loginButton');

    // Redirecionar se já estiver logado
    if (sessionStorage.getItem(CONFIG.admin.sessionKey) === 'true') {
        window.location.href = 'admin.html';
        return;
    }

    // Mostrar/ocultar senha
    toggleBtn.addEventListener('click', () => {
        const type = passwordInput.type === 'password' ? 'text' : 'password';
        passwordInput.type = type;
        toggleBtn.textContent = type === 'password' ? '👁️' : '👁️‍🗨️';
    });

    // Login
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = passwordInput.value.trim();

        if (!password) {
            showError('Digite a senha do administrador.');
            return;
        }

        setLoading(true);
        hideError();

        try {
            // Tentar autenticar via Worker (se configurado)
            let authenticated = false;

            if (CONFIG.api.baseUrl) {
                const response = await fetch(`${CONFIG.api.baseUrl}${CONFIG.api.loginEndpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });

                if (response.ok) {
                    const data = await response.json();
                    authenticated = data.success === true;
                }
            }

            // Fallback: autenticação local (desenvolvimento)
            if (!authenticated) {
                authenticated = password === CONFIG.admin.password;
            }

            if (authenticated) {
                sessionStorage.setItem(CONFIG.admin.sessionKey, 'true');
                window.location.href = 'admin.html';
            } else {
                showError('Senha incorreta. Tente novamente.');
                passwordInput.value = '';
                passwordInput.focus();
            }
        } catch (err) {
            // Fallback local se o Worker falhar
            if (password === CONFIG.admin.password) {
                sessionStorage.setItem(CONFIG.admin.sessionKey, 'true');
                window.location.href = 'admin.html';
            } else {
                showError('Senha incorreta. Tente novamente.');
                passwordInput.value = '';
                passwordInput.focus();
            }
        }

        setLoading(false);
    });

    function showError(msg) {
        errorMessage.textContent = msg;
        errorDiv.classList.remove('hidden');
        passwordInput.focus();
    }

    function hideError() {
        errorDiv.classList.add('hidden');
    }

    function setLoading(loading) {
        loginButton.disabled = loading;
        loginButton.textContent = loading ? 'Entrando...' : 'Entrar';
    }
});

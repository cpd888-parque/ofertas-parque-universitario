/**
 * Login - Autenticação do Administrador
 *
 * A autenticação é validada SOMENTE pelo Worker (secret ADMIN_PASSWORD),
 * que devolve um token Bearer de sessão. Não existe fallback local:
 * a senha nunca fica no bundle do frontend.
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
            const response = await fetch(`${CONFIG.api.baseUrl}${CONFIG.api.loginEndpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            const data = await response.json().catch(() => ({}));

            if (response.ok && data.success === true && data.token) {
                // Guardar o token emitido pelo Worker e marcar sessão
                sessionStorage.setItem(CONFIG.admin.tokenKey, data.token);
                sessionStorage.setItem(CONFIG.admin.sessionKey, 'true');
                window.location.href = 'admin.html';
                return;
            }

            showError((data && data.error) || 'Senha incorreta. Tente novamente.');
            passwordInput.value = '';
            passwordInput.focus();
        } catch (err) {
            showError('Não foi possível conectar ao servidor. Tente novamente.');
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

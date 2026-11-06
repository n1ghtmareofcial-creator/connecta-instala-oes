(() => {
  'use strict';

  const config = window.CONNECTA_CONFIG || {};
  const form = document.getElementById('contactForm');
  if (!form) return;

  const statusEl = document.getElementById('formStatus');
  const submitBtn = document.getElementById('submitBtn');
  const reviewDialog = document.getElementById('orderReviewDialog');
  const reviewSummary = document.getElementById('reviewSummary');
  const reviewError = document.getElementById('reviewError');
  const confirmBtn = document.getElementById('confirmOrderBtn');
  const confirmation = document.getElementById('orderConfirmation');
  const allowedMime = new Set([
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]);
  let submissionId = '';
  try { submissionId = sessionStorage.getItem('connecta-order-submission-id') || ''; } catch { /* sessão privada */ }
  const newSubmissionId = () => {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  };
  const labels = {
    whatsapp: 'WhatsApp',
    telefone: 'Ligação telefônica',
    email: 'E-mail',
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  function setStatus(message, kind = '') {
    statusEl.className = `form-status${kind ? ` ${kind}` : ''}`;
    statusEl.textContent = message;
  }

  function setError(id, message) {
    const errorEl = document.getElementById(`${id}-error`);
    const inputEl = document.getElementById(id);
    if (errorEl) errorEl.textContent = message;
    if (inputEl) {
      inputEl.classList.add('error');
      inputEl.setAttribute('aria-invalid', 'true');
    }
  }

  function clearErrors() {
    ['nome', 'email', 'telefone', 'endereco', 'preferenciaContato', 'mensagem', 'anexos', 'consentimento', 'servicos'].forEach((id) => {
      const errorEl = document.getElementById(`${id}-error`);
      const inputEl = document.getElementById(id);
      if (errorEl) errorEl.textContent = '';
      if (inputEl) {
        inputEl.classList.remove('error');
        inputEl.removeAttribute('aria-invalid');
      }
    });
    statusEl.className = 'form-status';
    statusEl.textContent = '';
    reviewError.textContent = '';
  }

  function collectPayload() {
    return {
      name: document.getElementById('nome').value.trim(),
      company: document.getElementById('empresa').value.trim(),
      email: document.getElementById('email').value.trim().toLowerCase(),
      phone: document.getElementById('telefone').value.trim(),
      address: document.getElementById('endereco').value.trim(),
      contactPreference: document.getElementById('preferenciaContato').value,
      description: document.getElementById('mensagem').value.trim(),
      services: [...form.querySelectorAll('input[name="servicos"]:checked')].map((el) => el.value),
      consent: document.getElementById('consentimento').checked,
      website: document.getElementById('website').value,
      submissionId: submissionId || (submissionId = newSubmissionId()),
    };
  }

  function validate(payload) {
    let valid = true;
    const phoneDigits = payload.phone.replace(/\D/g, '');
    if (payload.name.length < 3) { setError('nome', 'Informe seu nome completo.'); valid = false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) { setError('email', 'Informe um e-mail válido.'); valid = false; }
    if (phoneDigits.length < 10 || phoneDigits.length > 13) { setError('telefone', 'Informe um telefone válido com DDD.'); valid = false; }
    if (payload.address.length < 5) { setError('endereco', 'Informe o endereço ou local da execução.'); valid = false; }
    if (!payload.contactPreference) { setError('preferenciaContato', 'Selecione como prefere receber o retorno.'); valid = false; }
    if (payload.description.length < 10) { setError('mensagem', 'Descreva sua necessidade com pelo menos 10 caracteres.'); valid = false; }
    if (!payload.services.length) { setError('servicos', 'Selecione pelo menos um serviço.'); valid = false; }
    if (!payload.consent) { setError('consentimento', 'É necessário autorizar o uso dos dados para o atendimento.'); valid = false; }
    if (payload.website) { valid = false; }

    const files = [...document.getElementById('anexos').files];
    if (files.length > Number(config.maxFiles || 5)) {
      setError('anexos', `Anexe no máximo ${Number(config.maxFiles || 5)} arquivos.`);
      valid = false;
    }
    const maxBytes = Number(config.maxFileBytes || 5 * 1024 * 1024);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const maxTotalBytes = Number(config.maxTotalFileBytes || 5 * 1024 * 1024);
    if (totalBytes > maxTotalBytes) {
      setError('anexos', 'O tamanho total dos anexos não pode ultrapassar 5 MB.');
      valid = false;
    }
    for (const file of files) {
      if (file.size > maxBytes) {
        setError('anexos', `O arquivo ${file.name} excede o limite de 5 MB.`);
        valid = false;
        break;
      }
      if (!allowedMime.has(file.type)) {
        setError('anexos', `O formato do arquivo ${file.name} não é permitido.`);
        valid = false;
        break;
      }
    }
    return valid;
  }

  function summaryBlock(title, content) {
    return `<section class="review-block"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(content || 'Não informado')}</p></section>`;
  }

  function renderReview(payload) {
    const files = [...document.getElementById('anexos').files];
    const parts = [
      summaryBlock('Serviços', payload.services.join('\n')),
      summaryBlock('Cliente', `${payload.name}\n${payload.company || 'Pessoa física / empresa não informada'}\n${payload.phone}\n${payload.email}`),
      summaryBlock('Local de execução', payload.address),
      summaryBlock('Preferência de contato', labels[payload.contactPreference] || payload.contactPreference),
      summaryBlock('Descrição', payload.description),
    ];
    if (files.length) {
      parts.push(`<section class="review-block"><h4>Anexos</h4><div class="review-files">${files.map((file) => `<span class="review-file">${escapeHtml(file.name)} · ${(file.size / 1024 / 1024).toFixed(1)} MB</span>`).join('')}</div></section>`);
    }
    reviewSummary.innerHTML = parts.join('');
  }

  function isSupabaseConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase?.createClient);
  }

  async function createOrder() {
    const payload = collectPayload();
    if (!validate(payload)) {
      form.querySelector('[aria-invalid="true"]')?.focus();
      reviewDialog.close();
      return;
    }
    if (!isSupabaseConfigured()) {
      reviewError.textContent = 'O sistema de pedidos ainda não foi conectado ao projeto Supabase. Configure app-config.js e publique as Edge Functions antes de receber solicitações reais.';
      return;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Registrando pedido...';
    reviewError.textContent = '';

    try {
      const body = new FormData();
      try { sessionStorage.setItem('connecta-order-submission-id', payload.submissionId); } catch { /* usa chave em memória */ }
      body.append('payload', JSON.stringify(payload));
      [...document.getElementById('anexos').files].forEach((file) => body.append('attachments', file, file.name));

      const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/functions/v1/create-order`, {
        method: 'POST',
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${config.supabaseAnonKey}`,
        },
        body,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.order?.number) {
        throw new Error(result.error || 'Não foi possível registrar o pedido. Tente novamente.');
      }

      reviewDialog.close();
      document.getElementById('confirmationNumber').textContent = `#${result.order.number}`;
      document.getElementById('confirmationMessage').textContent = 'Sua solicitação foi registrada. A equipe da Connecta Instalações entrará em contato pelos dados informados.';
      document.getElementById('confirmationSummary').textContent = `Serviços: ${result.order.services.join(', ')}. Status inicial: Novo.`;
      if (result.attachmentWarnings?.length) {
        document.getElementById('confirmationSummary').textContent += ` Atenção: ${result.attachmentWarnings.join(' ')}`;
      }
      form.hidden = true;
      confirmation.hidden = false;
      setStatus('Pedido registrado com sucesso.', 'success');
      confirmation.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.reset();
      submissionId = newSubmissionId();
      try { sessionStorage.removeItem('connecta-order-submission-id'); } catch { /* sem armazenamento de sessão */ }
    } catch (error) {
      reviewError.textContent = error instanceof Error ? error.message : 'Falha ao registrar a solicitação.';
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirmar e enviar';
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearErrors();
    const payload = collectPayload();
    if (!validate(payload)) {
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    renderReview(payload);
    if (typeof reviewDialog.showModal === 'function') reviewDialog.showModal();
    else setStatus('Seu navegador não oferece suporte à etapa de revisão. Atualize o navegador para continuar.', 'error-msg');
  });

  confirmBtn.addEventListener('click', createOrder);
  document.getElementById('closeReviewBtn').addEventListener('click', () => reviewDialog.close());
  document.getElementById('editOrderBtn').addEventListener('click', () => reviewDialog.close());
  reviewDialog.addEventListener('click', (event) => {
    if (event.target === reviewDialog) reviewDialog.close();
  });
  document.getElementById('newOrderBtn').addEventListener('click', () => {
    submissionId = newSubmissionId();
    try { sessionStorage.removeItem('connecta-order-submission-id'); } catch { /* sem armazenamento de sessão */ }
    confirmation.hidden = true;
    form.hidden = false;
    setStatus('');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  ['nome', 'email', 'telefone', 'endereco', 'preferenciaContato', 'mensagem'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => {
      document.getElementById(`${id}-error`).textContent = '';
      document.getElementById(id).classList.remove('error');
      document.getElementById(id).removeAttribute('aria-invalid');
    });
  });
  form.querySelectorAll('input[name="servicos"]').forEach((input) => {
    input.addEventListener('change', () => { document.getElementById('servicos-error').textContent = ''; });
  });
  document.getElementById('consentimento').addEventListener('change', () => {
    document.getElementById('consentimento-error').textContent = '';
  });

  const telInput = document.getElementById('telefone');
  telInput.addEventListener('input', () => {
    let digits = telInput.value.replace(/\D/g, '').slice(0, 11);
    if (digits.length > 10) digits = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    else if (digits.length > 6) digits = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    else if (digits.length > 2) digits = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    else if (digits.length) digits = `(${digits}`;
    telInput.value = digits;
  });

  const businessPhone = String(config.businessWhatsAppPhone || '').replace(/\D/g, '');
  document.querySelectorAll('[data-whatsapp-link]').forEach((link) => {
    if (businessPhone.length >= 10) {
      link.href = `https://wa.me/${businessPhone}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.removeAttribute('aria-disabled');
    } else {
      link.href = '#contato';
      link.removeAttribute('target');
      link.setAttribute('aria-disabled', 'true');
      link.title = 'Configure o WhatsApp comercial em app-config.js';
    }
  });
})();

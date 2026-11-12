(() => {
  'use strict';

  const config = window.CONNECTA_CONFIG || {};
  const STATUS = [
    ['novo', 'Novo'],
    ['em_analise', 'Em análise'],
    ['aguardando_orcamento', 'Aguardando orçamento'],
    ['orcamento_enviado', 'Orçamento enviado'],
    ['aprovado', 'Aprovado'],
    ['em_execucao', 'Em execução'],
    ['concluido', 'Concluído'],
    ['cancelado', 'Cancelado'],
  ];
  const STATUS_LABEL = Object.fromEntries(STATUS);
  const PAGE_SIZE = 10;
  let supabaseClient = null;
  let currentAdmin = null;
  let currentUser = null;
  let currentView = 'dashboard';
  let currentPage = 0;
  let currentOrderId = null;
  let orderRealtimeChannel = null;
  let searchTimer = null;
  let orderCount = 0;
  let customersPage = 0;
  let customersTotal = 0;
  let customersSearchTimer = null;
  let currentCustomerId = null;
  let currentServiceId = null;
  const CUSTOMERS_PAGE_SIZE = 15;

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const formatDate = (value, withTime = true) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', withTime
      ? { dateStyle: 'short', timeStyle: 'short' }
      : { dateStyle: 'short' }).format(date);
  };
  const digits = (value) => String(value ?? '').replace(/\D/g, '');
  const statusPill = (status) => `<span class="status-pill status-${escapeHtml(status)}">${escapeHtml(STATUS_LABEL[status] || status)}</span>`;
  const notify = (message, kind = 'info') => {
    const el = $('globalMessage');
    el.textContent = message || '';
    el.dataset.kind = kind;
    if (message) window.setTimeout(() => { if (el.textContent === message) el.textContent = ''; }, 6500);
  };

  function fillStatusOptions() {
    const filter = $('statusFilter');
    const detail = $('detailStatus');
    filter.innerHTML = '<option value="">Todos os status</option>' + STATUS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    detail.innerHTML = STATUS.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  }

  const VIEW_META = {
    dashboard: { title: 'Visão geral', breadcrumb: 'VISÃO GERAL' },
    orders:    { title: 'Gerenciamento de pedidos', breadcrumb: 'PEDIDOS' },
    customers: { title: 'Clientes cadastrados', breadcrumb: 'CLIENTES' },
    services:  { title: 'Serviços e soluções', breadcrumb: 'SERVIÇOS' },
    settings:  { title: 'Configurações do sistema', breadcrumb: 'CONFIGURAÇÕES' },
    reports:   { title: 'Relatórios e desempenho', breadcrumb: 'RELATÓRIOS' },
    activity:  { title: 'Histórico de atividades', breadcrumb: 'ATIVIDADES' },
  };

  function setView(view) {
    currentView = view;
    document.querySelectorAll('.view').forEach((el) => el.classList.toggle('active', el.dataset.view === view));
    document.querySelectorAll('[data-view-target]').forEach((el) => el.classList.toggle('active', el.dataset.viewTarget === view && el.classList.contains('side-link')));
    const meta = VIEW_META[view] || VIEW_META.dashboard;
    $('pageTitle').textContent = meta.title;
    $('breadcrumbCurrent').textContent = meta.breadcrumb;
    $('sidebar').classList.remove('open');
    if (view === 'orders') loadOrders();
    else if (view === 'customers') loadCustomers();
    else if (view === 'services') loadServices();
    else if (view === 'settings') loadSettings();
    else if (view === 'reports') loadReports();
    else if (view === 'activity') loadActivityLog();
  }

  async function signIn(event) {
    event.preventDefault();
    $('loginMessage').textContent = '';
    if (!supabaseClient) {
      $('loginMessage').textContent = 'Configure supabaseUrl e supabaseAnonKey em app-config.js para conectar o painel.';
      return;
    }
    const button = $('loginButton');
    button.disabled = true;
    button.textContent = 'Validando acesso...';
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: $('loginEmail').value.trim(),
        password: $('loginPassword').value,
      });
      if (error) throw error;
      $('loginMessage').className = 'inline-message success';
      $('loginMessage').textContent = 'Credenciais válidas. Verificando autorização administrativa...';
      await checkSession();
    } catch (error) {
      $('loginMessage').className = 'inline-message';
      $('loginMessage').textContent = error instanceof Error ? error.message : 'Não foi possível autenticar.';
    } finally {
      button.disabled = false;
      button.textContent = 'Entrar no painel';
    }
  }

  async function checkSession() {
    if (!supabaseClient) return;
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session?.user) {
      $('loginView').hidden = false;
      $('appShell').hidden = true;
      return;
    }
    const user = sessionData.session.user;
    const { data: admin, error } = await supabaseClient
      .from('admin_users')
      .select('user_id,display_name,active')
      .eq('user_id', user.id)
      .eq('active', true)
      .maybeSingle();
    if (error || !admin) {
      await supabaseClient.auth.signOut();
      $('loginView').hidden = false;
      $('appShell').hidden = true;
      $('loginMessage').textContent = 'Este usuário não tem permissão administrativa. Solicite acesso ao responsável pelo sistema.';
      return;
    }
    currentUser = user;
    currentAdmin = admin;
    $('userName').textContent = admin.display_name || user.email || 'Administrador';
    $('userAvatar').textContent = (admin.display_name || user.email || 'C').trim().charAt(0).toUpperCase();
    $('loginView').hidden = true;
    $('appShell').hidden = false;
    $('todayLabel').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' }).format(new Date());
    await Promise.all([loadDashboard(), loadOrders()]);
    startRealtime();
  }

  async function forgotPassword() {
    if (!supabaseClient) {
      $('loginMessage').textContent = 'Configure o Supabase em app-config.js primeiro.';
      return;
    }
    const email = $('loginEmail').value.trim();
    if (!email) {
      $('loginMessage').textContent = 'Informe seu e-mail no campo acima para receber o link de redefinição.';
      $('loginEmail').focus();
      return;
    }
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/admin/`,
      });
      if (error) throw error;
      $('loginMessage').className = 'inline-message success';
      $('loginMessage').textContent = 'Se o e-mail estiver cadastrado, você receberá as instruções de redefinição.';
    } catch (error) {
      $('loginMessage').className = 'inline-message';
      $('loginMessage').textContent = error instanceof Error ? error.message : 'Não foi possível iniciar a recuperação.';
    }
  }

  async function signOut() {
    if (orderRealtimeChannel) await supabaseClient.removeChannel(orderRealtimeChannel);
    await supabaseClient.auth.signOut();
    currentUser = null;
    currentAdmin = null;
    $('appShell').hidden = true;
    $('loginView').hidden = false;
    $('loginPassword').value = '';
  }

  async function loadDashboard() {
    if (!supabaseClient || !currentAdmin) return;
    const statuses = STATUS.map(([status]) => status);
    const countPromises = [
      supabaseClient.from('orders').select('id', { count: 'exact', head: true }),
      ...statuses.map((status) => supabaseClient.from('orders').select('id', { count: 'exact', head: true }).eq('status', status)),
    ];
    const [totalResult, ...statusResults] = await Promise.all(countPromises);
    if (totalResult.error) {
      notify('Não foi possível carregar os indicadores: ' + totalResult.error.message, 'error');
      return;
    }
    const counts = Object.fromEntries(statuses.map((status, index) => [status, statusResults[index].count || 0]));
    const total = totalResult.count || 0;
    $('metricTotal').textContent = total;
    $('metricNovo').textContent = counts.novo;
    $('metricProgress').textContent = counts.em_analise + counts.aguardando_orcamento + counts.orcamento_enviado + counts.aprovado + counts.em_execucao;
    $('metricConcluido').textContent = counts.concluido;
    const newBadge = $('newOrderBadge');
    newBadge.textContent = counts.novo;
    newBadge.hidden = counts.novo === 0;
    const max = Math.max(1, ...Object.values(counts));
    $('statusChart').innerHTML = STATUS.map(([status, label]) => {
      const value = counts[status] || 0;
      const width = total ? Math.max(value ? 2 : 0, (value / max) * 100) : 0;
      return `<div class="chart-row"><span class="chart-label">${escapeHtml(label)}</span><div class="chart-track"><div class="chart-fill" style="width:${width}%"></div></div><strong class="chart-value">${value}</strong></div>`;
    }).join('');

    const [activityResult, recentResult, trendResult] = await Promise.all([
      supabaseClient.from('order_history').select('id,order_number,action,status_from,status_to,note,actor_label,created_at').order('created_at', { ascending: false }).limit(7),
      supabaseClient.from('orders').select('id,order_number,customer_name,customer_company,status,created_at,order_items(service_name)').order('created_at', { ascending: false }).limit(6),
      supabaseClient.from('orders').select('created_at').gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1).toISOString()).order('created_at', { ascending: true }).limit(1000),
    ]);
    if (!activityResult.error) renderActivities(activityResult.data || []);
    if (!trendResult.error) {
      const now = new Date();
      const months = Array.from({ length: 6 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - 5 + index, 1));
      const totals = months.map((month) => (trendResult.data || []).filter((item) => {
        const date = new Date(item.created_at);
        return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
      }).length);
      const peak = Math.max(1, ...totals);
      $('dashboardTrendChart').innerHTML = months.map((month, index) => {
        const label = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(month).replace('.', '');
        const height = totals[index] ? Math.max(7, (totals[index] / peak) * 100) : 2;
        return '<div class="trend-column"><div class="trend-bar-zone" title="' + totals[index] + ' pedido(s)"><span class="trend-bar" style="--bar-height:' + height + '%"></span></div><strong>' + totals[index] + '</strong><small>' + escapeHtml(label) + '</small></div>';
      }).join('');
    }
    if (!recentResult.error) $('recentOrdersBody').innerHTML = (recentResult.data || []).length
      ? recentResult.data.map((order) => recentOrderRow(order)).join('')
      : '<tr><td colspan="6" class="table-empty">Nenhum pedido registrado ainda.</td></tr>';
  }

  function activityDescription(item) {
    if (item.action === 'pedido_criado') return `Pedido <strong>${escapeHtml(item.order_number)}</strong> recebido.`;
    if (item.action === 'status_alterado') return `Pedido <strong>${escapeHtml(item.order_number)}</strong> alterado para <strong>${escapeHtml(STATUS_LABEL[item.status_to] || item.status_to)}</strong>.`;
    if (item.action === 'observacao_interna') return `Nova observação interna no pedido <strong>${escapeHtml(item.order_number)}</strong>.`;
    return `Atualização no pedido <strong>${escapeHtml(item.order_number)}</strong>.`;
  }

  function renderActivities(items) {
    $('recentActivities').innerHTML = items.length ? items.map((item) => `
      <div class="activity-item"><div class="activity-mark">${item.action === 'pedido_criado' ? '＋' : item.action === 'status_alterado' ? '↻' : '·'}</div>
      <div class="activity-copy"><p>${activityDescription(item)}</p><small>${escapeHtml(item.actor_label || 'Sistema')} · ${formatDate(item.created_at)}</small></div></div>
    `).join('') : '<div class="empty-state">Ainda não há atividades registradas.</div>';
  }

  function recentOrderRow(order) {
    const services = (order.order_items || []).map((item) => item.service_name).join(', ');
    return `<tr><td><span class="order-code">${escapeHtml(order.order_number)}</span></td><td><div class="client-cell"><strong>${escapeHtml(order.customer_name)}</strong><small>${escapeHtml(order.customer_company || 'Pessoa física')}</small></div></td><td class="service-cell">${escapeHtml(services || '—')}</td><td>${formatDate(order.created_at, false)}</td><td>${statusPill(order.status)}</td><td><button class="row-action" data-open-order="${escapeHtml(order.id)}">Abrir</button></td></tr>`;
  }

  function buildOrdersQuery() {
    const start = currentPage * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;
    const [sortColumn, sortDirection] = $('orderSort').value.split('.');
    let query = supabaseClient.from('orders').select(
      'id,order_number,customer_name,customer_company,customer_phone,customer_email,status,created_at,order_items(service_name)',
      { count: 'exact' },
    );
    const status = $('statusFilter').value;
    if (status) query = query.eq('status', status);
    const from = $('dateFrom').value;
    const to = $('dateTo').value;
    // Converte meia-noite do fuso local do operador para UTC antes de consultar timestamptz.
    if (from) query = query.gte('created_at', new Date(`${from}T00:00:00`).toISOString());
    if (to) {
      const endExclusive = new Date(`${to}T00:00:00`);
      endExclusive.setDate(endExclusive.getDate() + 1);
      query = query.lt('created_at', endExclusive.toISOString());
    }
    const search = $('orderSearch').value.trim().replace(/[(),]/g, ' ').replace(/[%_\\]/g, '').slice(0, 80);
    if (search) {
      const term = `%${search}%`;
      query = query.or(`order_number.ilike.${term},customer_name.ilike.${term},customer_phone.ilike.${term}`);
    }
    query = query.order(sortColumn, { ascending: sortDirection === 'asc' }).range(start, end);
    return query;
  }

  async function loadOrders() {
    if (!supabaseClient || !currentAdmin) return;
    $('ordersBody').innerHTML = '<tr><td colspan="8" class="table-empty">Carregando pedidos...</td></tr>';
    const { data, error, count } = await buildOrdersQuery();
    if (error) {
      $('ordersBody').innerHTML = `<tr><td colspan="8" class="table-empty">Erro ao carregar pedidos: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    orderCount = count || 0;
    const rows = data || [];
    $('ordersBody').innerHTML = rows.length ? rows.map((order) => {
      const serviceNames = (order.order_items || []).map((item) => item.service_name).join(', ');
      return `<tr><td><span class="order-code">${escapeHtml(order.order_number)}</span></td><td><div class="client-cell"><strong>${escapeHtml(order.customer_name)}</strong><small>${escapeHtml(order.customer_email)}</small></div></td><td>${escapeHtml(order.customer_company || '—')}</td><td class="service-cell" title="${escapeHtml(serviceNames)}">${escapeHtml(serviceNames || '—')}</td><td>${formatDate(order.created_at, false)}</td><td>${statusPill(order.status)}</td><td>${escapeHtml(order.customer_phone)}</td><td><button class="row-action" data-open-order="${escapeHtml(order.id)}">Detalhes</button></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="table-empty">Nenhum pedido encontrado para os filtros selecionados.</td></tr>';
    $('ordersCount').textContent = `${orderCount} pedido(s) encontrado(s)`;
    const pages = Math.max(1, Math.ceil(orderCount / PAGE_SIZE));
    $('pageInfo').textContent = `Página ${currentPage + 1} de ${pages}`;
    $('prevPage').disabled = currentPage <= 0;
    $('nextPage').disabled = currentPage + 1 >= pages;
  }

  function startRealtime() {
    if (!supabaseClient || orderRealtimeChannel) return;
    orderRealtimeChannel = supabaseClient.channel('connecta-admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refreshRealtimeData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_history' }, refreshRealtimeData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification_outbox' }, refreshRealtimeData)
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') notify('A conexão em tempo real foi interrompida. O painel tentará reconectar automaticamente.', 'error');
      });
  }

  let realtimeRefreshTimer = null;
  function refreshRealtimeData() {
    window.clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = window.setTimeout(async () => {
      await loadDashboard();
      if (currentView === 'orders') await loadOrders();
      if (currentOrderId && $('orderDetailDialog').open) await loadOrderDetails(currentOrderId, false);
    }, 350);
  }

  async function openOrder(orderId) {
    currentOrderId = orderId;
    $('detailLoading').hidden = false;
    $('detailContent').hidden = true;
    $('detailOrderNumber').textContent = 'Carregando pedido...';
    $('orderDetailDialog').showModal();
    await loadOrderDetails(orderId, true);
  }

  async function loadOrderDetails(orderId, showLoading = true) {
    if (showLoading) {
      $('detailLoading').hidden = false;
      $('detailContent').hidden = true;
    }
    const { data: order, error } = await supabaseClient.from('orders').select('*').eq('id', orderId).single();
    if (error || !order) {
      $('detailLoading').textContent = error?.message || 'Pedido não encontrado.';
      $('detailLoading').hidden = false;
      $('detailContent').hidden = true;
      return;
    }
    const [itemsRes, historyRes, notesRes, attachmentsRes, notificationRes] = await Promise.all([
      supabaseClient.from('order_items').select('id,service_name').eq('order_id', orderId).order('created_at'),
      supabaseClient.from('order_history').select('*').eq('order_id', orderId).order('created_at', { ascending: false }),
      supabaseClient.from('internal_notes').select('*').eq('order_id', orderId).order('created_at', { ascending: false }),
      supabaseClient.from('order_attachments').select('*').eq('order_id', orderId).order('created_at'),
      supabaseClient.from('notification_outbox').select('*').eq('order_id', orderId).eq('channel', 'whatsapp').maybeSingle(),
    ]);
    $('detailOrderNumber').textContent = order.order_number;
    $('detailCreatedAt').textContent = `Criado em ${formatDate(order.created_at)}`;
    $('customerDetails').innerHTML = [
      ['Nome', order.customer_name], ['Empresa', order.customer_company || 'Não informada'],
      ['Telefone / WhatsApp', order.customer_phone], ['E-mail', order.customer_email],
    ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
    const preference = { whatsapp: 'WhatsApp', telefone: 'Ligação telefônica', email: 'E-mail' }[order.contact_preference] || order.contact_preference;
    $('requestDetails').innerHTML = [
      ['Local de execução', order.location_address], ['Preferência de contato', preference],
      ['Status atual', STATUS_LABEL[order.status] || order.status], ['Última atualização', formatDate(order.updated_at)],
      ['Descrição', order.description],
    ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
    $('detailServices').innerHTML = (itemsRes.data || []).map((item) => `<span class="tag">${escapeHtml(item.service_name)}</span>`).join('') || '<span class="empty-state">Nenhum serviço informado.</span>';

    const attachmentHtml = [];
    for (const attachment of attachmentsRes.data || []) {
      const { data: signed, error: signedError } = await supabaseClient.storage.from(attachment.bucket_name).createSignedUrl(attachment.storage_path, 300);
      if (!signedError && signed?.signedUrl) {
        attachmentHtml.push(`<a class="attachment-link" href="${escapeHtml(signed.signedUrl)}" target="_blank" rel="noopener noreferrer">↧ ${escapeHtml(attachment.original_name)} · ${(attachment.size_bytes / 1024 / 1024).toFixed(1)} MB</a>`);
      } else {
        attachmentHtml.push(`<span class="attachment-link">${escapeHtml(attachment.original_name)} · link indisponível</span>`);
      }
    }
    $('detailAttachments').innerHTML = attachmentHtml.join('') || '<span class="empty-state">Nenhum arquivo anexado.</span>';

    $('detailStatus').value = order.status;
    $('statusReason').value = '';
    $('orderTimeline').innerHTML = (historyRes.data || []).map((entry) => {
      const actionText = entry.action === 'pedido_criado'
        ? 'Pedido recebido'
        : entry.action === 'status_alterado'
          ? `Status alterado: ${STATUS_LABEL[entry.status_from] || entry.status_from} → ${STATUS_LABEL[entry.status_to] || entry.status_to}`
          : entry.action === 'observacao_interna' ? 'Observação interna adicionada' : entry.action;
      return `<div class="timeline-item"><span class="timeline-dot"></span><div class="timeline-copy"><p><strong>${escapeHtml(actionText)}</strong>${entry.note ? ` · ${escapeHtml(entry.note)}` : ''}</p><small>${escapeHtml(entry.actor_label || 'Sistema')} · ${formatDate(entry.created_at)}</small></div></div>`;
    }).join('') || '<div class="empty-state">Nenhuma movimentação registrada.</div>';
    $('internalNotes').innerHTML = (notesRes.data || []).map((note) => `<div class="note-item"><p>${escapeHtml(note.content)}</p><small>${escapeHtml(note.author_label)} · ${formatDate(note.created_at)}</small></div>`).join('') || '<div class="empty-state">Nenhuma observação interna adicionada.</div>';

    await renderNotification(order, notificationRes.data);
    $('detailLoading').hidden = true;
    $('detailContent').hidden = false;
  }

  async function renderNotification(order, notification) {
    const meta = $('notificationMeta');
    const attemptsBox = $('notificationAttempts');
    const retryButton = $('retryNotificationButton');
    const manualButton = $('manualWhatsAppButton');
    if (!notification) {
      $('notificationInfo').textContent = 'Nenhum registro de notificação encontrado para este pedido.';
      meta.textContent = '';
      attemptsBox.innerHTML = '';
      retryButton.disabled = true;
      manualButton.hidden = true;
    } else {
      const statusLabels = { pending: 'Aguardando envio', sending: 'Em processamento', sent: 'Enviado pela Cloud API', failed: 'Falha no envio', manual_required: 'Ação manual necessária' };
      $('notificationInfo').textContent = statusLabels[notification.status] || notification.status;
      meta.textContent = `Tentativas: ${notification.attempt_count} de ${notification.max_attempts}${notification.last_error ? ` · ${notification.last_error}` : ''}`;
      retryButton.disabled = notification.status === 'sent' || notification.status === 'sending' || notification.attempt_count >= notification.max_attempts;
      const { data: attempts } = await supabaseClient.from('notification_attempts').select('*').eq('notification_id', notification.id).order('created_at', { ascending: false });
      attemptsBox.innerHTML = (attempts || []).map((attempt) => `<div>${attempt.outcome === 'sent' ? '✓ Envio confirmado' : '× Falha'} · tentativa ${attempt.attempt_number} · ${formatDate(attempt.created_at)}${attempt.error_message ? ` · ${escapeHtml(attempt.error_message)}` : ''}</div>`).join('');
      retryButton.dataset.notificationId = notification.id;
      const businessPhoneConfigured = digits(config.businessWhatsAppPhone).length >= 10;
      manualButton.hidden = !businessPhoneConfigured;
      manualButton.href = businessPhoneConfigured ? buildBusinessWhatsAppUrl(order) : '#';
      manualButton.textContent = 'Abrir WhatsApp comercial';
      manualButton.setAttribute('aria-disabled', businessPhoneConfigured ? 'false' : 'true');
      if (!businessPhoneConfigured && notification.status === 'manual_required') {
        $('notificationInfo').textContent += ' Configure businessWhatsAppPhone em app-config.js para habilitar o link manual.';
      }
    }

    const customerDigits = digits(order.customer_phone);
    const normalizedCustomer = customerDigits.length <= 11 ? `55${customerDigits}` : customerDigits;
    const customerMessage = `Olá, ${order.customer_name}. Aqui é da Connecta Instalações. Estamos entrando em contato sobre o pedido ${order.order_number}.`;
    $('customerWhatsAppButton').href = normalizedCustomer.length >= 12
      ? `https://wa.me/${normalizedCustomer}?text=${encodeURIComponent(customerMessage)}`
      : '#';
    $('customerWhatsAppButton').setAttribute('aria-disabled', normalizedCustomer.length >= 12 ? 'false' : 'true');
  }

  function buildBusinessWhatsAppUrl(order) {
    const phone = digits(config.businessWhatsAppPhone);
    if (phone.length < 10) return '#';
    const itemText = document.getElementById('detailServices').innerText.replace(/\n/g, ', ');
    const text = [
      'NOVO PEDIDO | CONNECTA INSTALAÇÕES',
      `Pedido: ${order.order_number}`,
      `Cliente: ${order.customer_name}`,
      `Empresa: ${order.customer_company || 'Não informada'}`,
      `Telefone: ${order.customer_phone}`,
      `Serviços: ${itemText}`,
      `Descrição: ${order.description}`,
      `Local: ${order.location_address}`,
      `Status: ${STATUS_LABEL[order.status] || order.status}`,
    ].join('\n');
    return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }

  async function saveStatus() {
    if (!currentOrderId) return;
    const button = $('saveStatusButton');
    button.disabled = true;
    try {
      const { error } = await supabaseClient.rpc('admin_update_order_status', {
        p_order_id: currentOrderId,
        p_status: $('detailStatus').value,
        p_note: $('statusReason').value.trim() || null,
      });
      if (error) throw error;
      notify('Status atualizado e registrado no histórico.', 'success');
      await Promise.all([loadDashboard(), loadOrders(), loadOrderDetails(currentOrderId, false)]);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível atualizar o status.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function addNote(event) {
    event.preventDefault();
    const content = $('noteText').value.trim();
    if (!currentOrderId || !content) return;
    const button = $('noteForm').querySelector('button');
    button.disabled = true;
    try {
      const { error } = await supabaseClient.rpc('admin_add_order_note', {
        p_order_id: currentOrderId,
        p_content: content,
      });
      if (error) throw error;
      $('noteText').value = '';
      notify('Observação interna adicionada.', 'success');
      await loadOrderDetails(currentOrderId, false);
      await loadDashboard();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível adicionar a observação.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function retryNotification() {
    const id = $('retryNotificationButton').dataset.notificationId;
    if (!id) return;
    const button = $('retryNotificationButton');
    button.disabled = true;
    button.textContent = 'Processando...';
    try {
      const { data, error } = await supabaseClient.functions.invoke('retry-notification', { body: { notificationId: id } });
      if (error) throw error;
      if (data?.status === 'sent') notify('WhatsApp enviado pela Cloud API.', 'success');
      else if (data?.status === 'manual_required') notify('API não configurada. Use o link para abrir uma mensagem manual no WhatsApp.', 'info');
      else if (data?.status === 'failed') notify('A API do WhatsApp recusou o envio: ' + (data.message || ''), 'error');
      await loadOrderDetails(currentOrderId, false);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível tentar o envio.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = '↻ Tentar envio pela API';
    }
  }

  /* ═══════════════════════════════════════════
     CLIENTES
  ═══════════════════════════════════════════ */
  async function loadCustomers() {
    if (!supabaseClient || !currentAdmin) return;
    $('customersBody').innerHTML = '<tr><td colspan="7" class="table-empty">Carregando clientes...</td></tr>';
    const start = customersPage * CUSTOMERS_PAGE_SIZE;
    const end = start + CUSTOMERS_PAGE_SIZE - 1;
    const search = $('customerSearch').value.trim().replace(/[%_\\]/g, '').slice(0, 80);
    let query = supabaseClient.from('customers').select('id,name,company,phone,email,created_at', { count: 'exact' });
    if (search) {
      const term = `%${search}%`;
      query = query.or(`name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
    }
    query = query.order('created_at', { ascending: false }).range(start, end);
    const { data, error, count } = await query;
    if (error) {
      $('customersBody').innerHTML = `<tr><td colspan="7" class="table-empty">Erro: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    customersTotal = count || 0;
    const rows = data || [];

    // Para cada cliente, buscar contagem de pedidos
    const customerIds = rows.map((c) => c.id);
    let orderCounts = {};
    if (customerIds.length) {
      const { data: ordData } = await supabaseClient
        .from('orders')
        .select('customer_id')
        .in('customer_id', customerIds);
      (ordData || []).forEach((o) => { orderCounts[o.customer_id] = (orderCounts[o.customer_id] || 0) + 1; });
    }

    $('customersBody').innerHTML = rows.length ? rows.map((c) => {
      const qty = orderCounts[c.id] || 0;
      return `<tr>
        <td><div class="client-cell"><strong>${escapeHtml(c.name)}</strong></div></td>
        <td>${escapeHtml(c.company || '—')}</td>
        <td>${escapeHtml(c.email)}</td>
        <td>${escapeHtml(c.phone)}</td>
        <td><span style="font-weight:800;color:${qty > 1 ? 'var(--blue)' : 'var(--ink)'}">${qty}</span>${qty > 1 ? ' <small style="color:var(--blue);font-size:.6rem">recorrente</small>' : ''}</td>
        <td>${formatDate(c.created_at, false)}</td>
        <td><button class="row-action" data-open-customer="${escapeHtml(c.id)}">Perfil</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="7" class="table-empty">Nenhum cliente encontrado.</td></tr>';

    $('customersCount').textContent = `${customersTotal} cliente(s) cadastrado(s)`;
    const pages = Math.max(1, Math.ceil(customersTotal / CUSTOMERS_PAGE_SIZE));
    $('customersPageInfo').textContent = `Página ${customersPage + 1} de ${pages}`;
    $('customersPrevPage').disabled = customersPage <= 0;
    $('customersNextPage').disabled = customersPage + 1 >= pages;
  }

  async function openCustomer(customerId) {
    currentCustomerId = customerId;
    $('customerDetailName').textContent = 'Carregando...';
    $('customerDetailSince').textContent = '';
    $('customerContactDl').innerHTML = '';
    $('customerOrdersBody').innerHTML = '<tr><td colspan="5" class="table-empty">Carregando...</td></tr>';
    $('customerDetailDialog').showModal();

    const { data: customer, error } = await supabaseClient.from('customers').select('*').eq('id', customerId).single();
    if (error || !customer) {
      $('customerDetailName').textContent = 'Erro ao carregar cliente';
      return;
    }
    $('customerDetailName').textContent = customer.name;
    $('customerDetailSince').textContent = `Cadastrado em ${formatDate(customer.created_at)}`;
    $('customerContactDl').innerHTML = [
      ['Nome completo', customer.name],
      ['Empresa', customer.company || 'Não informada'],
      ['Telefone / WhatsApp', customer.phone],
      ['E-mail', customer.email],
      ['Atualizado em', formatDate(customer.updated_at)],
    ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');

    $('editCustomerName').value = customer.name;
    $('editCustomerCompany').value = customer.company || '';
    $('editCustomerPhone').value = customer.phone;
    $('editCustomerEmail').value = customer.email;

    // Pedidos do cliente
    const { data: orders } = await supabaseClient
      .from('orders')
      .select('id,order_number,status,created_at,order_items(service_name)')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });
    $('customerOrdersBody').innerHTML = (orders || []).length
      ? orders.map((o) => {
          const svcs = (o.order_items || []).map((i) => i.service_name).join(', ');
          return `<tr><td><span class="order-code">${escapeHtml(o.order_number)}</span></td><td class="service-cell" title="${escapeHtml(svcs)}">${escapeHtml(svcs || '—')}</td><td>${formatDate(o.created_at, false)}</td><td>${statusPill(o.status)}</td><td><button class="row-action" data-open-order="${escapeHtml(o.id)}">Abrir</button></td></tr>`;
        }).join('')
      : '<tr><td colspan="5" class="table-empty">Nenhum pedido registrado.</td></tr>';
  }

  async function saveCustomer() {
    if (!currentCustomerId) return;
    const name = $('editCustomerName').value.trim();
    const phone = $('editCustomerPhone').value.trim();
    const email = $('editCustomerEmail').value.trim().toLowerCase();
    if (!name || !phone || !email) { notify('Preencha nome, telefone e e-mail.', 'error'); return; }
    const btn = $('saveCustomerButton');
    btn.disabled = true;
    try {
      const { error } = await supabaseClient.from('customers').update({
        name,
        company: $('editCustomerCompany').value.trim() || null,
        phone,
        email,
        email_normalized: email,
      }).eq('id', currentCustomerId);
      if (error) throw error;
      notify('Dados do cliente atualizados.', 'success');
      $('customerDetailName').textContent = name;
      await loadCustomers();
    } catch (err) {
      notify(err.message || 'Erro ao salvar cliente.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  /* ═══════════════════════════════════════════
     SERVIÇOS
  ═══════════════════════════════════════════ */
  async function loadServices() {
    if (!supabaseClient || !currentAdmin) return;
    $('servicesBody').innerHTML = '<tr><td colspan="5" class="table-empty">Carregando...</td></tr>';
    const { data, error } = await supabaseClient.from('services').select('*').order('sort_order');
    if (error) {
      $('servicesBody').innerHTML = `<tr><td colspan="5" class="table-empty">Erro: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    const rows = data || [];
    $('servicesCount').textContent = `${rows.length} serviço(s) cadastrado(s)`;
    $('servicesBody').innerHTML = rows.length ? rows.map((s) => `
      <tr>
        <td style="font-weight:800;color:#8295a3;font-size:.7rem;text-align:center">${s.sort_order}</td>
        <td><strong style="font-size:.73rem;color:var(--navy)">${escapeHtml(s.name)}</strong><div style="font-size:.62rem;color:#9aa7b2;margin-top:.2rem">${escapeHtml(s.slug)}</div></td>
        <td style="font-size:.67rem;color:#607589;max-width:280px">${escapeHtml(s.description || '—')}</td>
        <td><button class="service-active-toggle ${s.is_active ? 'on' : 'off'}" data-service-toggle="${escapeHtml(s.id)}" data-service-active="${s.is_active}">${s.is_active ? '● Ativo' : '○ Inativo'}</button></td>
        <td><button class="row-action" data-edit-service="${escapeHtml(s.id)}">Editar</button></td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="table-empty">Nenhum serviço cadastrado.</td></tr>';
  }

  function openServiceDialog(serviceId = null) {
    currentServiceId = serviceId;
    $('editServiceId').value = serviceId || '';
    $('serviceDialogTitle').textContent = serviceId ? 'Editar serviço' : 'Novo serviço';
    $('deleteServiceButton').hidden = !serviceId;

    if (!serviceId) {
      $('editServiceName').value = '';
      $('editServiceSlug').value = '';
      $('editServiceDesc').value = '';
      $('editServiceOrder').value = '10';
      $('editServiceActive').checked = true;
    } else {
      supabaseClient.from('services').select('*').eq('id', serviceId).single().then(({ data: s }) => {
        if (!s) return;
        $('editServiceName').value = s.name;
        $('editServiceSlug').value = s.slug;
        $('editServiceDesc').value = s.description || '';
        $('editServiceOrder').value = s.sort_order;
        $('editServiceActive').checked = s.is_active;
      });
    }
    $('serviceDialog').showModal();
  }

  async function saveService() {
    const name = $('editServiceName').value.trim();
    const slug = $('editServiceSlug').value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name || !slug) { notify('Nome e slug são obrigatórios.', 'error'); return; }
    const payload = {
      name,
      slug,
      description: $('editServiceDesc').value.trim(),
      sort_order: parseInt($('editServiceOrder').value, 10) || 10,
      is_active: $('editServiceActive').checked,
    };
    const btn = $('saveServiceButton');
    btn.disabled = true;
    try {
      let error;
      if (currentServiceId) {
        ({ error } = await supabaseClient.from('services').update(payload).eq('id', currentServiceId));
      } else {
        ({ error } = await supabaseClient.from('services').insert(payload));
      }
      if (error) throw error;
      notify(currentServiceId ? 'Serviço atualizado.' : 'Serviço criado.', 'success');
      $('serviceDialog').close();
      await loadServices();
    } catch (err) {
      notify(err.message || 'Erro ao salvar serviço.', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteService() {
    if (!currentServiceId) return;
    if (!window.confirm('Excluir este serviço permanentemente? Pedidos existentes não serão afetados.')) return;
    try {
      const { error } = await supabaseClient.from('services').delete().eq('id', currentServiceId);
      if (error) throw error;
      notify('Serviço excluído.', 'success');
      $('serviceDialog').close();
      await loadServices();
    } catch (err) {
      notify(err.message || 'Erro ao excluir serviço.', 'error');
    }
  }

  async function toggleServiceActive(serviceId, currentActive) {
    try {
      const { error } = await supabaseClient.from('services').update({ is_active: !currentActive }).eq('id', serviceId);
      if (error) throw error;
      notify(currentActive ? 'Serviço desativado.' : 'Serviço ativado.', 'success');
      await loadServices();
    } catch (err) {
      notify(err.message || 'Erro ao alterar status.', 'error');
    }
  }

  /* ═══════════════════════════════════════════
     CONFIGURAÇÕES
  ═══════════════════════════════════════════ */
  const SETTINGS_TABLE = 'system_settings';

  async function loadSettings() {
    if (!supabaseClient || !currentAdmin) return;
    // Tenta carregar da tabela system_settings; se não existir, usa valores padrão silenciosamente
    try {
      const { data } = await supabaseClient.from(SETTINGS_TABLE).select('key,value');
      if (data && data.length) {
        const map = Object.fromEntries(data.map((row) => [row.key, row.value]));
        const setVal = (id, key) => { const el = $(id); if (el) el.value = map[key] || ''; };
        setVal('cfgCompanyName', 'company_name');
        setVal('cfgCnpj', 'cnpj');
        setVal('cfgEmail', 'contact_email');
        setVal('cfgWhatsapp', 'whatsapp_phone');
        setVal('cfgPhone', 'phone');
        setVal('cfgAddress', 'address');
        setVal('cfgInstagram', 'instagram');
        setVal('cfgLinkedin', 'linkedin');
        setVal('cfgFacebook', 'facebook');
        setVal('cfgWeekdays', 'hours_weekdays');
        setVal('cfgSaturday', 'hours_saturday');
        setVal('cfgSunday', 'hours_sunday');
        setVal('cfgHoursNote', 'hours_note');
      }
    } catch (_) {
      // Tabela ainda não criada — carrega em branco sem erro visual
    }
  }

  async function upsertSettings(pairs) {
    // Tenta inserir/atualizar; se a tabela não existir, informa o usuário
    try {
      const rows = pairs.map(([key, value]) => ({ key, value: value || '' }));
      const { error } = await supabaseClient.from(SETTINGS_TABLE).upsert(rows, { onConflict: 'key' });
      if (error) {
        // Tabela inexistente: orienta o usuário a criá-la
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          notify('Execute a migração de configurações no Supabase para habilitar esta seção. Ver README.', 'error');
        } else {
          throw error;
        }
        return false;
      }
      return true;
    } catch (err) {
      notify(err.message || 'Erro ao salvar configurações.', 'error');
      return false;
    }
  }

  async function saveCompanySettings() {
    const ok = await upsertSettings([
      ['company_name', $('cfgCompanyName').value.trim()],
      ['cnpj', $('cfgCnpj').value.trim()],
      ['contact_email', $('cfgEmail').value.trim()],
      ['whatsapp_phone', $('cfgWhatsapp').value.trim()],
      ['phone', $('cfgPhone').value.trim()],
      ['address', $('cfgAddress').value.trim()],
    ]);
    if (ok) notify('Dados da empresa salvos.', 'success');
  }

  async function saveSocialSettings() {
    const ok = await upsertSettings([
      ['instagram', $('cfgInstagram').value.trim()],
      ['linkedin', $('cfgLinkedin').value.trim()],
      ['facebook', $('cfgFacebook').value.trim()],
    ]);
    if (ok) notify('Redes sociais salvas.', 'success');
  }

  async function saveHoursSettings() {
    const ok = await upsertSettings([
      ['hours_weekdays', $('cfgWeekdays').value.trim()],
      ['hours_saturday', $('cfgSaturday').value.trim()],
      ['hours_sunday', $('cfgSunday').value.trim()],
      ['hours_note', $('cfgHoursNote').value.trim()],
    ]);
    if (ok) notify('Horários de funcionamento salvos.', 'success');
  }

  /* ─── auto-slug ─── */
  function slugify(text) {
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }


  function animateAdminNumber(id,target,suffix=''){
    const element=$(id);if(!element)return;
    const start=Number(String(element.textContent).replace(/[^\d]/g,''))||0;
    const end=Number(target)||0;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){element.textContent=end.toLocaleString('pt-BR')+suffix;return;}
    const started=performance.now(),duration=850;
    const frame=(now)=>{
      const progress=Math.min(1,(now-started)/duration),eased=1-Math.pow(1-progress,4);
      element.textContent=Math.round(start+(end-start)*eased).toLocaleString('pt-BR')+suffix;
      if(progress<1)requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  async function loadReports(){
    if(!supabaseClient||!currentAdmin)return;
    const range=$('reportRange').value;
    let query=supabaseClient.from('orders').select('id,order_number,status,created_at,order_items(service_name)').order('created_at',{ascending:true}).limit(1000);
    if(range!=='all'){const days=Number(range)||90,since=new Date();since.setDate(since.getDate()-days);query=query.gte('created_at',since.toISOString());}
    const {data,error}=await query;
    if(error){notify('Não foi possível carregar os relatórios: '+error.message,'error');return;}
    const orders=data||[];
    const completed=orders.filter(order=>order.status==='concluido').length;
    const canceled=orders.filter(order=>order.status==='cancelado').length;
    const open=Math.max(0,orders.length-completed-canceled);
    const rate=orders.length?Math.round(completed/orders.length*100):0;
    animateAdminNumber('reportTotal',orders.length);
    animateAdminNumber('reportCompleted',completed);
    animateAdminNumber('reportOpen',open);
    animateAdminNumber('reportRate',rate,'%');

    const sixMonthsSince=new Date(new Date().getFullYear(),new Date().getMonth()-5,1);
    const {data:trendData,error:trendError}=await supabaseClient.from('orders').select('created_at')
      .gte('created_at',sixMonthsSince.toISOString()).order('created_at',{ascending:true}).limit(1000);
    if(trendError)notify('Indicadores carregados, mas a série mensal falhou: '+trendError.message,'error');
    const now=new Date();
    const months=Array.from({length:6},(_,index)=>new Date(now.getFullYear(),now.getMonth()-5+index,1));
    const monthTotals=months.map(month=>(trendData||[]).filter(item=>{
      const date=new Date(item.created_at);
      return date.getFullYear()===month.getFullYear()&&date.getMonth()===month.getMonth();
    }).length);
    const maxMonth=Math.max(1,...monthTotals),width=760,height=210,left=28,top=18;
    const graphWidth=width-left*2,graphHeight=height-top-28;
    const points=monthTotals.map((value,index)=>({x:left+index*graphWidth/(months.length-1),y:top+graphHeight-(value/maxMonth)*graphHeight,value}));
    const polyline=points.map(point=>point.x.toFixed(1)+','+point.y.toFixed(1)).join(' ');
    const areaPath='M '+points[0].x+' '+(top+graphHeight)+' L '+points.map(point=>point.x+' '+point.y).join(' L ')+' L '+points[points.length-1].x+' '+(top+graphHeight)+' Z';
    const circles=points.map((point,index)=>'<circle class="report-point" style="animation-delay:'+(index*90)+'ms" cx="'+point.x+'" cy="'+point.y+'" r="5"><title>'+point.value+' pedido(s)</title></circle>').join('');
    const grid=[0,1,2,3].map(step=>'<line class="grid-line" x1="'+left+'" x2="'+(width-left)+'" y1="'+(top+graphHeight*step/3)+'" y2="'+(top+graphHeight*step/3)+'"/>').join('');
    $('reportTimeline').innerHTML='<svg class="report-line-svg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Pedidos mensais: '+monthTotals.join(', ')+'"><defs><linearGradient id="reportAreaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#139bd0" stop-opacity=".32"/><stop offset="100%" stop-color="#139bd0" stop-opacity="0"/></linearGradient></defs>'+grid+'<path class="report-area" d="'+areaPath+'"/><polyline class="report-line" pathLength="1" points="'+polyline+'"/>'+circles+'</svg><div class="report-month-labels">'+months.map(month=>'<span>'+escapeHtml(new Intl.DateTimeFormat('pt-BR',{month:'short'}).format(month).replace('.',''))+'</span>').join('')+'</div>';

    const serviceCounts={};
    orders.forEach(order=>(order.order_items||[]).forEach(item=>{
      const name=item.service_name||'Serviço não identificado';
      serviceCounts[name]=(serviceCounts[name]||0)+1;
    }));
    const topServices=Object.entries(serviceCounts).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const maxService=Math.max(1,...topServices.map(entry=>entry[1]));
    $('reportServices').innerHTML=topServices.length?topServices.map(([name,count])=>
      '<div class="report-service-row"><strong title="'+escapeHtml(name)+'">'+escapeHtml(name)+'</strong><small>'+count+'</small><div class="report-service-track"><div class="report-service-fill" style="--fill:'+((count/maxService)*100).toFixed(1)+'%"></div></div></div>'
    ).join(''):'<div class="empty-state">Ainda não há serviços associados aos pedidos deste período.</div>';

    const bestMonthIndex=monthTotals.indexOf(Math.max(...monthTotals));
    const bestMonth=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(months[bestMonthIndex]);
    const topServiceText=topServices[0]?topServices[0][0]:'sem dados suficientes';
    $('reportInsights').innerHTML=
      '<article class="report-insight"><strong>'+orders.length.toLocaleString('pt-BR')+' solicitações</strong><p>Volume de pedidos no intervalo selecionado, com base nos registros disponíveis.</p></article>'+
      '<article class="report-insight"><strong>'+rate+'% de conclusão</strong><p>'+completed+' pedidos concluídos de '+orders.length+' registrados. '+canceled+' cancelados não entram no volume em aberto.</p></article>'+
      '<article class="report-insight"><strong>'+escapeHtml(topServiceText)+'</strong><p>Serviço com maior frequência no período. Mês de maior entrada: '+escapeHtml(bestMonth)+' ('+Math.max(...monthTotals)+' pedidos).</p></article>';
    $('reportUpdated').textContent='Atualizado em '+formatDate(new Date().toISOString());
  }

  async function loadActivityLog(){
    if(!supabaseClient||!currentAdmin)return;
    const {data,error}=await supabaseClient.from('order_history')
      .select('id,order_number,action,status_from,status_to,note,actor_label,created_at')
      .order('created_at',{ascending:false}).limit(60);
    if(error){notify('Não foi possível carregar o histórico: '+error.message,'error');return;}
    const items=data||[];
    $('activityCount').textContent=items.length.toLocaleString('pt-BR');
    $('activityFeed').innerHTML=items.length?items.map(item=>{
      const icon=item.action==='pedido_criado'?'+':item.action==='status_alterado'?'↻':'·';
      return '<div class="activity-feed-item"><span class="activity-feed-mark">'+icon+'</span><div class="activity-feed-copy"><p>'+activityDescription(item)+'</p><small>'+escapeHtml(item.actor_label||'Sistema')+' · '+formatDate(item.created_at)+'</small></div></div>';
    }).join(''):'<div class="empty-state">Ainda não há movimentações registradas.</div>';
  }

  function exportOrdersCsv(){
    if(!supabaseClient||!currentAdmin)return;
    notify('Preparando exportação dos pedidos...');
    supabaseClient.from('orders')
      .select('order_number,customer_name,customer_company,customer_email,customer_phone,location_address,status,created_at,order_items(service_name)')
      .order('created_at',{ascending:false}).limit(2000)
      .then(({data,error})=>{
        if(error)throw error;
        const headers=['Pedido','Cliente','Empresa','E-mail','Telefone','Local','Status','Criado em','Serviços'];
        const rows=(data||[]).map(order=>[
          order.order_number,order.customer_name,order.customer_company,order.customer_email,
          order.customer_phone,order.location_address,STATUS_LABEL[order.status]||order.status,
          formatDate(order.created_at),(order.order_items||[]).map(item=>item.service_name).join('; ')
        ]);
        const csv=[headers,...rows].map(row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
        const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
        const url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download='connecta-pedidos-'+new Date().toISOString().slice(0,10)+'.csv';
        document.body.appendChild(link);link.click();link.remove();
        window.setTimeout(()=>URL.revokeObjectURL(url),1200);
        notify((data||[]).length+' pedido(s) exportado(s) em CSV.','success');
      }).catch(error=>notify('Falha na exportação: '+(error.message||'erro desconhecido'),'error'));
  }

  function applyAdminTheme(theme){
    const allowed=['azure','emerald','violet'];
    const selected=allowed.includes(theme)?theme:'azure';
    document.body.dataset.adminTheme=selected;
    const selector=$('adminThemeSelect');
    if(selector)selector.value=selected;
    try{localStorage.setItem('connecta-admin-theme',selected);}catch(_){}
  }

  function bindEvents() {
    $('loginForm').addEventListener('submit', signIn);
    $('forgotPasswordButton').addEventListener('click', forgotPassword);
    $('logoutButton').addEventListener('click', signOut);
    document.querySelectorAll('[data-view-target]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.viewTarget)));
    $('menuToggle').addEventListener('click', () => $('sidebar').classList.toggle('open'));
    $('refreshDashboard').addEventListener('click', loadDashboard);
    $('reportRange').addEventListener('change', loadReports);
    $('refreshReports').addEventListener('click', loadReports);
    $('refreshActivity').addEventListener('click', loadActivityLog);
    $('exportOrdersButton').addEventListener('click', exportOrdersCsv);
    $('adminThemeSelect').addEventListener('change', (event) => applyAdminTheme(event.target.value));
    $('refreshOrders').addEventListener('click', loadOrders);
    $('prevPage').addEventListener('click', () => { if (currentPage > 0) { currentPage -= 1; loadOrders(); } });
    $('nextPage').addEventListener('click', () => { if ((currentPage + 1) * PAGE_SIZE < orderCount) { currentPage += 1; loadOrders(); } });
    ['statusFilter', 'dateFrom', 'dateTo', 'orderSort'].forEach((id) => $(id).addEventListener('change', () => { currentPage = 0; loadOrders(); }));
    $('orderSearch').addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => { currentPage = 0; loadOrders(); }, 300);
    });
    $('ordersBody').addEventListener('click', (event) => {
      const button = event.target.closest('[data-open-order]');
      if (button) openOrder(button.dataset.openOrder);
    });
    $('recentOrdersBody').addEventListener('click', (event) => {
      const button = event.target.closest('[data-open-order]');
      if (button) openOrder(button.dataset.openOrder);
    });
    $('closeDetail').addEventListener('click', () => { $('orderDetailDialog').close(); currentOrderId = null; });
    $('saveStatusButton').addEventListener('click', saveStatus);
    $('noteForm').addEventListener('submit', addNote);
    $('retryNotificationButton').addEventListener('click', retryNotification);
    $('orderDetailDialog').addEventListener('close', () => { currentOrderId = null; });

    // Clientes
    $('refreshCustomers').addEventListener('click', loadCustomers);
    $('customerSearch').addEventListener('input', () => {
      window.clearTimeout(customersSearchTimer);
      customersSearchTimer = window.setTimeout(() => { customersPage = 0; loadCustomers(); }, 300);
    });
    $('customersPrevPage').addEventListener('click', () => { if (customersPage > 0) { customersPage -= 1; loadCustomers(); } });
    $('customersNextPage').addEventListener('click', () => { if ((customersPage + 1) * CUSTOMERS_PAGE_SIZE < customersTotal) { customersPage += 1; loadCustomers(); } });
    $('customersBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-open-customer]');
      if (btn) openCustomer(btn.dataset.openCustomer);
      // Pedido dentro do dialog de cliente
      const ordBtn = e.target.closest('[data-open-order]');
      if (ordBtn) { $('customerDetailDialog').close(); openOrder(ordBtn.dataset.openOrder); }
    });
    $('closeCustomerDetail').addEventListener('click', () => { $('customerDetailDialog').close(); currentCustomerId = null; });
    $('saveCustomerButton').addEventListener('click', saveCustomer);
    // Clique em pedido dentro do perfil do cliente
    $('customerOrdersBody').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-open-order]');
      if (btn) { $('customerDetailDialog').close(); openOrder(btn.dataset.openOrder); }
    });

    // Serviços
    $('newServiceButton').addEventListener('click', () => openServiceDialog(null));
    $('servicesBody').addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edit-service]');
      if (editBtn) { openServiceDialog(editBtn.dataset.editService); return; }
      const toggleBtn = e.target.closest('[data-service-toggle]');
      if (toggleBtn) { toggleServiceActive(toggleBtn.dataset.serviceToggle, toggleBtn.dataset.serviceActive === 'true'); }
    });
    $('closeServiceDialog').addEventListener('click', () => $('serviceDialog').close());
    $('saveServiceButton').addEventListener('click', saveService);
    $('deleteServiceButton').addEventListener('click', deleteService);
    // Auto-slug ao digitar nome
    $('editServiceName').addEventListener('input', () => {
      if (!currentServiceId) $('editServiceSlug').value = slugify($('editServiceName').value);
    });

    // Configurações
    $('saveCompanySettings').addEventListener('click', saveCompanySettings);
    $('saveSocialSettings').addEventListener('click', saveSocialSettings);
    $('saveHoursSettings').addEventListener('click', saveHoursSettings);
  }

  async function initialize() {
    $('yearLabel').textContent = new Date().getFullYear();
    try { applyAdminTheme(localStorage.getItem('connecta-admin-theme') || 'azure'); } catch (_) { applyAdminTheme('azure'); }
    fillStatusOptions();
    bindEvents();
    const configured = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase?.createClient);
    if (!configured) {
      $('loginMessage').textContent = 'Painel preparado, mas ainda não conectado. Preencha supabaseUrl e supabaseAnonKey em app-config.js e aplique a migração do banco.';
      return;
    }
    const infoEl = $('infoSupabaseUrl');
    if (infoEl) infoEl.textContent = config.supabaseUrl ? config.supabaseUrl.replace('https://', '').split('.')[0] + '.supabase.co' : '—';
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    try {
      await checkSession();
    } catch (error) {
      $('loginMessage').textContent = error instanceof Error ? error.message : 'Não foi possível iniciar o painel.';
    }
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        $('loginView').hidden = false;
        $('appShell').hidden = true;
      } else if (event === 'SIGNED_IN' && session?.user && !currentAdmin) {
        window.setTimeout(() => checkSession().catch((error) => notify(error.message, 'error')), 0);
      }
    });
  }

  initialize();
})();

import { createServiceClient, corsHeaders, jsonResponse, originIsAllowed, requireAdmin } from '../_shared/http.ts';
import { dispatchWhatsApp } from '../_shared/whatsapp.ts';

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Método não permitido.' }, 405);
  if (!originIsAllowed(request)) return jsonResponse(request, { error: 'Origem não autorizada.' }, 403);

  try {
    const adminClient = createServiceClient();
    await requireAdmin(request, adminClient);

    const body = await request.json().catch(() => null);
    const notificationId = String(body?.notificationId ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(notificationId)) {
      return jsonResponse(request, { error: 'Identificador de notificação inválido.' }, 400);
    }

    const { data: notification, error: notificationError } = await adminClient
      .from('notification_outbox')
      .select('id, order_id, status, attempt_count, max_attempts')
      .eq('id', notificationId)
      .single();
    if (notificationError || !notification) return jsonResponse(request, { error: 'Notificação não encontrada.' }, 404);
    if (notification.status === 'sent') return jsonResponse(request, { status: 'sent', message: 'Esta notificação já foi enviada.' }, 200);
    if (notification.attempt_count >= notification.max_attempts) {
      return jsonResponse(request, { error: 'Limite máximo de tentativas atingido.' }, 409);
    }

    const { data: order, error: orderError } = await adminClient
      .from('orders')
      .select('id, order_number, customer_name, customer_company, customer_phone, customer_email, location_address, description, status')
      .eq('id', notification.order_id)
      .single();
    if (orderError || !order) return jsonResponse(request, { error: 'Pedido relacionado não encontrado.' }, 404);

    const { data: items, error: itemsError } = await adminClient
      .from('order_items')
      .select('service_name')
      .eq('order_id', order.id);
    if (itemsError) return jsonResponse(request, { error: 'Não foi possível carregar os serviços do pedido.' }, 500);

    const result = await dispatchWhatsApp(
      adminClient,
      notification.id,
      order,
      (items ?? []).map((item: { service_name: string }) => item.service_name),
    );
    return jsonResponse(request, result, result.status === 'failed' ? 502 : 200);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const unauthorized = message.includes('Sessão administrativa') || message.includes('permissão administrativa');
    return jsonResponse(request, { error: unauthorized ? message : 'Não foi possível processar a notificação.' }, unauthorized ? 403 : 500);
  }
});

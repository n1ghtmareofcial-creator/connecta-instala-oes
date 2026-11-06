import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = request.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sessão administrativa necessária." }, 401);
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Sessão administrativa inválida." }, 401);
    const { data: admin } = await adminClient.from("admin_users")
      .select("user_id").eq("user_id", authData.user.id).eq("active", true).maybeSingle();
    if (!admin) return json({ error: "Usuário sem permissão administrativa." }, 403);

    const body = await request.json().catch(() => ({}));
    const notificationId = String(body.notificationId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(notificationId)) return json({ error: "Identificador inválido." }, 400);

    const { data: notification, error: notificationError } = await adminClient
      .from("notification_outbox").select("id,order_id,status,attempt_count,max_attempts")
      .eq("id", notificationId).maybeSingle();
    if (notificationError || !notification) return json({ error: "Notificação não encontrada." }, 404);
    if (notification.status === "sent") return json({ status: "sent", message: "Esta notificação já foi enviada." });

    const secrets = ["WHATSAPP_TOKEN","WHATSAPP_PHONE_NUMBER_ID","WHATSAPP_NOTIFY_TO",
      "WHATSAPP_TEMPLATE_NAME","WHATSAPP_TEMPLATE_LANGUAGE","WHATSAPP_GRAPH_API_VERSION"];
    const missing = secrets.filter((key) => !Deno.env.get(key));
    if (missing.length) {
      await adminClient.from("notification_outbox").update({
        status: "manual_required",
        last_error: "Cloud API não configurada; use o envio manual pelo WhatsApp.",
        next_attempt_at: null,
      }).eq("id", notificationId);
      return json({ status: "manual_required", message: "Cloud API não configurada. Use o link de WhatsApp manual." });
    }

    const { data: attempt, error: claimError } = await adminClient.rpc("claim_whatsapp_notification", {
      p_notification_id: notificationId,
    });
    if (claimError) throw claimError;
    if (!attempt) return json({ status: notification.status, message: "Notificação indisponível para nova tentativa." }, 409);

    const { data: order, error: orderError } = await adminClient.from("orders")
      .select("id,order_number,customer_name,customer_company,customer_phone,customer_email,location_address,description,status")
      .eq("id", notification.order_id).single();
    if (orderError) throw orderError;
    const { data: items, error: itemsError } = await adminClient.from("order_items")
      .select("service_name").eq("order_id", order.id);
    if (itemsError) throw itemsError;

    const values = [
      order.order_number, order.customer_name, order.customer_company || "Não informado",
      order.customer_phone, (items || []).map((x: {service_name:string}) => x.service_name).join(", "),
      order.description, order.location_address, order.status,
    ];
    const template = Deno.env.get("WHATSAPP_TEMPLATE_NAME")!;
    const language = Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE")!;
    const version = Deno.env.get("WHATSAPP_GRAPH_API_VERSION")!;
    const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")!;
    const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Deno.env.get("WHATSAPP_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: Deno.env.get("WHATSAPP_NOTIFY_TO"),
        type: "template",
        template: {
          name: template,
          language: { code: language },
          components: [{ type: "body", parameters: values.map((text) => ({ type: "text", text: String(text).slice(0, 1024) })) }],
        },
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = String(result.error?.message || "A Cloud API recusou o envio.").slice(0, 1000);
      await adminClient.from("notification_outbox").update({
        status: "failed", last_error: message, next_attempt_at: new Date(Date.now() + Math.min(60, 2 ** attempt) * 60000).toISOString(),
      }).eq("id", notificationId);
      await adminClient.from("notification_attempts").insert({
        notification_id: notificationId, attempt_number: attempt, outcome: "failed", error_message: message,
      });
      return json({ status: "failed", message }, 502);
    }
    const messageId = result.messages?.[0]?.id ?? null;
    await adminClient.from("notification_outbox").update({
      status: "sent", provider_message_id: messageId, sent_at: new Date().toISOString(), last_error: null, next_attempt_at: null,
    }).eq("id", notificationId);
    await adminClient.from("notification_attempts").insert({
      notification_id: notificationId, attempt_number: attempt, outcome: "sent", provider_message_id: messageId,
    });
    return json({ status: "sent", messageId });
  } catch (error) {
    console.error("retry-notification:", error instanceof Error ? error.message : String(error));
    return json({ error: "Não foi possível processar a notificação." }, 500);
  }
});

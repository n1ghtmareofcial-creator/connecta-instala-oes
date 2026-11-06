import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

const validText = (v: unknown, min: number, max: number) =>
  typeof v === "string" && v.trim().length >= min && v.trim().length <= max;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Configuração interna do Supabase ausente.");

    const form = await request.formData();
    const raw = form.get("payload");
    if (typeof raw !== "string" || raw.length > 20000) return json({ error: "Solicitação inválida." }, 400);
    const payload = JSON.parse(raw);

    if (!validText(payload.name, 3, 160) ||
        !validText(payload.email, 5, 254) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
        !validText(payload.phone, 10, 30) ||
        !validText(payload.address, 5, 500) ||
        !validText(payload.description, 10, 5000) ||
        !["whatsapp", "telefone", "email"].includes(payload.contactPreference) ||
        payload.consent !== true ||
        typeof payload.website !== "string" || payload.website.length !== 0 ||
        !Array.isArray(payload.services) || payload.services.length < 1 || payload.services.length > 6 ||
        !/^[0-9a-f-]{36}$/i.test(payload.submissionId ?? "")) {
      return json({ error: "Confira os campos obrigatórios e tente novamente." }, 400);
    }

    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(forwarded + ":" + serviceKey));
    const fingerprint = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

    const { data: allowed, error: limitError } = await client.rpc("consume_public_request_limit", {
      p_fingerprint_hash: fingerprint,
      p_max_requests: 5,
      p_window_minutes: 60,
    });
    if (limitError) throw limitError;
    if (allowed !== true) return json({ error: "Limite de solicitações atingido. Tente novamente mais tarde." }, 429);

    const cleanPayload = {
      name: payload.name.trim(),
      company: typeof payload.company === "string" ? payload.company.trim().slice(0, 160) : "",
      email: payload.email.trim().toLowerCase(),
      phone: payload.phone.trim(),
      address: payload.address.trim(),
      contactPreference: payload.contactPreference,
      description: payload.description.trim(),
    };
    const serviceNames = [...new Set(payload.services.map((v: unknown) => String(v).trim()))];
    if (serviceNames.length !== payload.services.length || serviceNames.some((v: string) => v.length > 120)) {
      return json({ error: "Seleção de serviços inválida." }, 400);
    }

    const { data: order, error } = await client.rpc("create_public_order", {
      p_payload: cleanPayload,
      p_service_names: serviceNames,
      p_submission_id: payload.submissionId,
    });
    if (error) {
      console.error("create_public_order failed:", error.message);
      return json({ error: "Não foi possível registrar o pedido. Verifique os dados e tente novamente." }, 400);
    }

    return json({
      order: { number: order.order_number, status: order.status, services: serviceNames },
      duplicate: Boolean(order.is_duplicate),
      attachmentWarnings: [],
    }, 201);
  } catch (error) {
    console.error("create-order error:", error instanceof Error ? error.message : String(error));
    return json({ error: "Falha ao processar a solicitação." }, 500);
  }
});

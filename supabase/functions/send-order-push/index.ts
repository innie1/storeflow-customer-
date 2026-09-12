// send-order-push
// Internal-only Web Push router for StoreFlow order events.
//
// Orders-table triggers call this function through pg_net and authenticate with
// a random secret held encrypted in Supabase Vault. Browsers cannot select an
// order, target, status, phone number or notification body anymore.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:support@storeflow.app";

interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function sendAndCleanup(
  supabase: any,
  subs: PushTarget[],
  payload: string,
  tableName: string,
): Promise<number> {
  if (!subs?.length) return 0;

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
    )
  );

  const deadIds: string[] = [];
  let sent = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      sent += 1;
      return;
    }
    const code = (result.reason as any)?.statusCode || (result.reason as any)?.status;
    if (code === 404 || code === 410) deadIds.push(subs[index].id);
    else console.error(`[${tableName}] push failed:`, (result.reason as any)?.message || result.reason);
  });

  if (deadIds.length) {
    await supabase.from(tableName).delete().in("id", deadIds);
  }
  return sent;
}

function safeNotes(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function customerStatusContent(status: string, orderRef: string) {
  const map: Record<string, { title: string; body: string }> = {
    accepted: { title: "👍 Order Accepted!", body: `Great news! Your order ${orderRef} has been accepted.` },
    preparing: { title: "👨‍🍳 Preparing Your Order", body: `Your order ${orderRef} is being prepared.` },
    ready: { title: "🎉 Order Ready!", body: `Your order ${orderRef} is ready for pickup or delivery.` },
    completed: { title: "✅ Order Completed!", body: `Your order ${orderRef} has been completed. Thank you!` },
    rejected: { title: "❌ Order Rejected", body: `The store could not accept order ${orderRef}. Open StoreFlow to see its status.` },
    cancelled: { title: "🚫 Order Cancelled", body: `Order ${orderRef} has been cancelled.` },
    "changes requested": { title: "📝 Changes Requested", body: `The store requested changes to order ${orderRef}.` },
  };
  return map[status] || { title: "📦 Order Status Update", body: `Your order ${orderRef} is now ${status || "updated"}.` };
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(JSON.stringify({ error: "Push service is not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // pg_net sends this header from the orders trigger. The plaintext secret is
    // never stored in the app or this function; the database verifies it against
    // the encrypted Vault value using a service-role-only RPC.
    const presentedSecret = req.headers.get("x-storeflow-internal-secret") || "";
    if (!presentedSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: validSecret, error: secretError } = await supabase.rpc(
      "verify_order_push_internal_secret",
      { p_secret: presentedSecret },
    );
    if (secretError || validSecret !== true) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const orderId = String(body?.order_id || "");
    const event = String(body?.event || "");
    if (!orderId || !["new_order", "status_update"].includes(event)) {
      return new Response(JSON.stringify({ error: "Invalid internal push event" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, store_id, customer_name, total, order_number, status, notes")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const orderRef = order.order_number ? `#${order.order_number}` : `#${order.id.slice(0, 8)}`;
    const customerName = order.customer_name || "A customer";
    const status = String(order.status || "").toLowerCase().trim();
    const notes = safeNotes(order.notes);

    // New orders and customer cancellations are merchant-facing. We determine
    // cancellation authorship from the server-written order notes, not a field
    // supplied by the HTTP caller.
    const customerCancelled = notes.customer_cancelled === true;
    const notifyMerchant = event === "new_order" || (event === "status_update" && status === "cancelled" && customerCancelled);

    if (notifyMerchant) {
      const { data: merchantSubs } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("store_id", order.store_id);

      if (!merchantSubs?.length) {
        return new Response(JSON.stringify({ target: "merchant", sent: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const amount = order.total ? `₦${Number(order.total).toLocaleString()}` : "";
      const isCancellation = event === "status_update";
      const title = isCancellation ? "🚫 Order Cancelled!" : "📦 New Order!";
      const message = isCancellation
        ? `${customerName} cancelled order ${orderRef}${amount ? ` (${amount})` : ""}.`
        : `${customerName} placed an order${amount ? ` — ${amount}` : ""}.`;
      const notificationId = isCancellation ? `order-${order.id}-cancelled` : `order-new-${order.id}`;
      const payload = JSON.stringify({
        title,
        body: message,
        tag: notificationId,
        notification_id: notificationId,
        url: "/?tab=orders",
        orderId: order.id,
        orderNumber: order.order_number || "",
        priority: "critical",
      });

      const sent = await sendAndCleanup(supabase, merchantSubs, payload, "push_subscriptions");
      if (isCancellation) {
        await supabase.from("notifications").insert({
          store_id: order.store_id,
          title: "Order Cancelled 🚫",
          message: `${customerName} order ${orderRef} was cancelled.`,
          type: "order_cancelled",
          is_read: false,
        });
      }

      return new Response(JSON.stringify({ target: "merchant", sent }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Merchant/system status changes are customer-facing. Subscription rows are
    // bound to this exact order token, not found by fuzzy phone matching.
    const { data: customerSubs } = await supabase
      .from("customer_order_push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("order_id", order.id);

    if (!customerSubs?.length) {
      return new Response(JSON.stringify({ target: "customer", sent: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const content = customerStatusContent(status, orderRef);
    const notificationId = `order-${order.id}-${status || "updated"}`;
    const payload = JSON.stringify({
      title: content.title,
      body: content.body,
      tag: notificationId,
      notification_id: notificationId,
      url: `/?tracking_order_id=${order.id}`,
      orderId: order.id,
      orderNumber: order.order_number || "",
      priority: ["accepted", "rejected", "cancelled"].includes(status) ? "critical" : "normal",
    });

    const sent = await sendAndCleanup(
      supabase,
      customerSubs,
      payload,
      "customer_order_push_subscriptions",
    );

    return new Response(JSON.stringify({ target: "customer", sent, status }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("send-order-push error:", error);
    return new Response(JSON.stringify({ error: "Push dispatch failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

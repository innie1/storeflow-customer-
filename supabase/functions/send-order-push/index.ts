// send-order-push
//
// Production-grade push notification router for StoreFlow.
//
// KEY DESIGN PRINCIPLE: Never notify the user who initiated the action.
// The `initiated_by` field ("merchant" | "customer") controls routing:
//   - If initiated_by === "customer" → push goes to merchant only
//   - If initiated_by === "merchant" → push goes to customer only
//   - If omitted (legacy/trigger) → push goes to BOTH (backward compat)
//
// Notification IDs are deterministic for deduplication.
// Priority field controls requireInteraction behavior in the SW.
//
// Required secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// Already-available: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:support@storeflow.app";

// ── Helpers ──────────────────────────────────────────────────────────────

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
  tableName: string
): Promise<number> {
  if (!subs || subs.length === 0) return 0;

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
    )
  );

  const deadIds: string[] = [];
  let sent = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent++;
    } else {
      const code = (r.reason as any)?.statusCode || (r.reason as any)?.status;
      if (code === 404 || code === 410) {
        deadIds.push(subs[i].id);
      } else {
        console.error(`[${tableName}] Push failed for ${subs[i].id}:`, (r.reason as any)?.message || r.reason);
      }
    }
  });

  if (deadIds.length > 0) {
    await supabase.from(tableName).delete().in("id", deadIds);
    console.log(`[${tableName}] Cleaned ${deadIds.length} expired subscriptions`);
  }

  return sent;
}

function getStatusContent(normStatus: string, orderRef: string, customerName: string, total: number | null) {
  const amount = total ? `₦${Number(total).toLocaleString()}` : "";

  // Content for MERCHANT receiving notification about customer action
  const merchantContent: Record<string, { title: string; body: string }> = {
    cancelled: {
      title: "🚫 Order Cancelled!",
      body: `${customerName} cancelled Order ${orderRef}${amount ? ` (${amount})` : ""}. Tap to view.`,
    },
  };

  // Content for CUSTOMER receiving notification about merchant action
  const customerContent: Record<string, { title: string; body: string }> = {
    accepted: {
      title: "👍 Order Accepted!",
      body: `Great news! Your order ${orderRef} has been accepted and is being processed.`,
    },
    preparing: {
      title: "👨‍🍳 Preparing Your Order",
      body: `Your order ${orderRef} is actively being prepared!`,
    },
    ready: {
      title: "🎉 Order Ready!",
      body: `Your order ${orderRef} is ready for pickup/delivery!`,
    },
    completed: {
      title: "✅ Order Completed!",
      body: `Thank you! Your order ${orderRef} has been marked completed.`,
    },
    rejected: {
      title: "❌ Order Rejected",
      body: `We're sorry, your order ${orderRef} could not be accepted. Tap to view details.`,
    },
    cancelled: {
      title: "🚫 Order Cancelled",
      body: `Your order ${orderRef} has been cancelled.`,
    },
    "changes requested": {
      title: "📝 Changes Requested",
      body: `The store has requested changes to your order ${orderRef}. Tap to review.`,
    },
  };

  return { merchantContent, customerContent };
}

function getPriority(normStatus: string): "critical" | "normal" {
  return ["cancelled", "rejected", "accepted"].some((s) => normStatus.includes(s))
    ? "critical"
    : "normal";
}

// ── Main Handler ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  try {
    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error("Missing VAPID keys");
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }), { status: 500 });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const bodyJson = await req.json();
    const order_id = bodyJson.order_id;
    // Who performed the action: "merchant" | "customer" | undefined
    const initiatedBy: string | undefined = bodyJson.initiated_by;
    const isStatusUpdate = bodyJson.is_customer_update || Boolean(bodyJson.new_status && bodyJson.old_status);

    if (!order_id) {
      return new Response(JSON.stringify({ error: "order_id is required" }), { status: 400 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, store_id, customer_name, customer_phone, total, order_number, status")
      .eq("id", order_id)
      .single();

    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: "Order not found", detail: orderErr?.message }), { status: 404 });
    }

    const orderRef = order.order_number ? `#${order.order_number}` : `#${order.id.slice(0, 8)}`;
    const customerName = order.customer_name || "A customer";

    // =====================================================================
    // BRANCH 1: STATUS UPDATE (Accept, Reject, Cancel, Prepare, Ready, etc)
    // =====================================================================
    if (isStatusUpdate) {
      const rawStatus = (bodyJson.new_status || order.status || "").toString();
      const normStatus = rawStatus.toLowerCase().trim();
      const priority = getPriority(normStatus);
      const { merchantContent, customerContent } = getStatusContent(normStatus, orderRef, customerName, order.total);

      // Deterministic notification ID for deduplication (per order + status)
      const notificationId = `order-${order.id}-${normStatus}`;

      let merchantSent = 0;
      let customerSent = 0;

      // ── Send to MERCHANT (only if NOT initiated by merchant) ────────
      const shouldNotifyMerchant = initiatedBy !== "merchant";
      if (shouldNotifyMerchant) {
        const { data: merchantSubs } = await supabase
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .eq("store_id", order.store_id);

        if (merchantSubs && merchantSubs.length > 0) {
          const content = merchantContent[normStatus] || {
            title: "📦 Order Update",
            body: `Order ${orderRef} status changed to ${rawStatus}.`,
          };

          const payload = JSON.stringify({
            title: content.title,
            body: content.body,
            tag: notificationId,
            notification_id: notificationId,
            url: "/?tab=orders",
            orderId: order.id,
            priority,
          });

          merchantSent = await sendAndCleanup(supabase, merchantSubs, payload, "push_subscriptions");
        }

        // Also insert an in-app notification row for the merchant
        const isCancel = normStatus.includes("cancel");
        const isReject = normStatus.includes("reject");
        if (isCancel || isReject) {
          await supabase.from("notifications").insert({
            store_id: order.store_id,
            title: isCancel ? "Order Cancelled 🚫" : "Order Rejected ❌",
            message: `${customerName} order ${orderRef} was ${isCancel ? "cancelled" : "rejected"}.`,
            type: isCancel ? "order_cancelled" : "order_rejected",
            is_read: false,
          });
        }
      }

      // ── Send to CUSTOMER (only if NOT initiated by customer) ────────
      const shouldNotifyCustomer = initiatedBy !== "customer";
      if (shouldNotifyCustomer && order.customer_phone) {
        const cleanedPhone = order.customer_phone.replace(/\D/g, "");
        const phoneTail = cleanedPhone.length >= 10 ? cleanedPhone.slice(-10) : cleanedPhone;

        if (phoneTail && phoneTail.length >= 5) {
          const { data: customerSubs } = await supabase
            .from("customer_push_subscriptions")
            .select("id, endpoint, p256dh, auth")
            .like("customer_phone", `%${phoneTail}%`);

          if (customerSubs && customerSubs.length > 0) {
            const content = customerContent[normStatus] || {
              title: "📦 Order Status Update",
              body: `Your order ${orderRef} is now ${rawStatus}.`,
            };

            const payload = JSON.stringify({
              title: content.title,
              body: content.body,
              tag: notificationId,
              notification_id: notificationId,
              url: `/?tracking_order_id=${order.id}`,
              orderId: order.id,
              orderNumber: order.order_number || "",
              priority,
            });

            customerSent = await sendAndCleanup(supabase, customerSubs, payload, "customer_push_subscriptions");
          }
        }
      }

      return new Response(
        JSON.stringify({
          target: "status_update",
          initiated_by: initiatedBy || "unknown",
          merchantSent,
          customerSent,
          status: normStatus,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // =====================================================================
    // BRANCH 2: NEW ORDER (always notify merchant, never notify customer)
    // =====================================================================
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("store_id", order.store_id);

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ message: "No push subscriptions for this store" }), { status: 200 });
    }

    const amount = order.total ? `₦${Number(order.total).toLocaleString()}` : "";
    const notificationId = `order-new-${order.id}`;
    const payload = JSON.stringify({
      title: "📦 New Order!",
      body: `${customerName} just placed an order${amount ? ` — ${amount}` : ""}. Tap to view.`,
      tag: notificationId,
      notification_id: notificationId,
      url: "/?tab=orders",
      orderId: order.id,
      priority: "critical",
    });

    const sent = await sendAndCleanup(supabase, subs, payload, "push_subscriptions");

    return new Response(
      JSON.stringify({ target: "merchant", sent, total: subs.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("send-order-push error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

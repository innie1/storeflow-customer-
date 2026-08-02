// send-order-push
//
// Handles comprehensive push notification workflows for StoreFlow:
// 1) Merchant New Order Notification: Alert merchants when a new order is placed.
// 2) Customer Status Update Notification: Alert customers when order status changes (Accepted, Preparing, Ready, Completed).
// 3) Merchant Cancellation/Update Alert: Alert merchants immediately even when app is closed if an order is cancelled or rejected.
//
// Required secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// Already-available secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:support@storeflow.app";

Deno.serve(async (req: Request) => {
  try {
    if (!vapidPublicKey || !vapidPrivateKey) {
      console.error("Missing VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY secrets");
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }), { status: 500 });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const bodyJson = await req.json();
    const order_id = bodyJson.order_id;
    const isCustomerUpdate = bodyJson.is_customer_update || Boolean(bodyJson.new_status && bodyJson.old_status);

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

    // =========================================================================
    // BRANCH 1: ORDER STATUS UPDATE (Notify Customer + Merchant on Cancellation)
    // =========================================================================
    if (isCustomerUpdate) {
      const rawStatus = (bodyJson.new_status || order.status || "").toString();
      const normStatus = rawStatus.toLowerCase().trim();
      const orderRef = order.order_number ? `#${order.order_number}` : `#${order.id.slice(0, 8)}`;

      // 1A. Check if this is a cancellation or rejection — MUST alert merchant if app is closed!
      let merchantCancelsSent = 0;
      if (normStatus === "cancelled" || normStatus === "rejected") {
        const { data: merchantSubs } = await supabase
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth")
          .eq("store_id", order.store_id);

        if (merchantSubs && merchantSubs.length > 0) {
          const cancelTitle = normStatus === "cancelled" ? "🚫 Order Cancelled!" : "❌ Order Rejected";
          const cancelBody = `${order.customer_name || "A customer"} order ${orderRef} is now ${rawStatus}. Tap to view in StoreFlow.`;
          const cancelPayload = JSON.stringify({
            title: cancelTitle,
            body: cancelBody,
            tag: `order-cancel-${order.id}`,
            url: "/?tab=orders",
            orderId: order.id
          });

          const mResults = await Promise.allSettled(
            merchantSubs.map((sub: any) =>
              webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                cancelPayload
              )
            )
          );

          const deadMSubIds: string[] = [];
          mResults.forEach((r, i) => {
            if (r.status === "rejected") {
              const statusCode = (r.reason && ((r.reason as any).statusCode || (r.reason as any).status)) || null;
              if (statusCode === 404 || statusCode === 410) {
                deadMSubIds.push(merchantSubs[i].id);
              }
            } else {
              merchantCancelsSent++;
            }
          });
          if (deadMSubIds.length > 0) {
            await supabase.from("push_subscriptions").delete().in("id", deadMSubIds);
          }
        }

        // Also ensure an in-app notification row exists in database for the merchant
        await supabase.from("notifications").insert({
          store_id: order.store_id,
          title: normStatus === "cancelled" ? "Order Cancelled 🚫" : "Order Rejected ❌",
          message: `${order.customer_name || "A customer"} order ${orderRef} was set to ${rawStatus}.`,
          type: normStatus === "cancelled" ? "order_cancelled" : "order_rejected",
          is_read: false
        });
      }

      // 1B. Notify customer of their status change
      let customerSent = 0;
      if (order.customer_phone) {
        const cleanedPhone = order.customer_phone.replace(/\D/g, "");
        const phoneTail = cleanedPhone.length >= 10 ? cleanedPhone.slice(-10) : cleanedPhone;
        
        if (phoneTail && phoneTail.length >= 5) {
          const { data: customerSubs } = await supabase
            .from("customer_push_subscriptions")
            .select("id, endpoint, p256dh, auth")
            .like("customer_phone", `%${phoneTail}%`);

          if (customerSubs && customerSubs.length > 0) {
            let title = "📦 Order Status Update";
            let bodyText = `Your order ${orderRef} is now ${rawStatus}.`;

            if (normStatus === "accepted") {
              title = "👍 Order Accepted!";
              bodyText = `Great news! Your order ${orderRef} has been accepted by the store and is being processed.`;
            } else if (normStatus === "preparing") {
              title = "👨‍🍳 Preparing Your Order";
              bodyText = `Your order ${orderRef} is actively being prepared!`;
            } else if (normStatus === "ready") {
              title = "🎉 Order Ready!";
              bodyText = `Your order ${orderRef} is ready for pickup/delivery!`;
            } else if (normStatus === "completed") {
              title = "✅ Order Completed!";
              bodyText = `Thank you! Your order ${orderRef} has been marked completed.`;
            } else if (normStatus === "rejected") {
              title = "❌ Order Rejected";
              bodyText = `We are sorry, your order ${orderRef} could not be accepted by the store. Tap to view details.`;
            } else if (normStatus === "cancelled") {
              title = "🚫 Order Cancelled";
              bodyText = `Your order ${orderRef} has been cancelled.`;
            }

            const payload = JSON.stringify({
              title,
              body: bodyText,
              tag: `order-${order.id}`,
              url: `/?tracking_order_id=${order.id}`,
              orderId: order.id,
              orderNumber: order.order_number || "",
            });

            const results = await Promise.allSettled(
              customerSubs.map((sub: any) =>
                webpush.sendNotification(
                  { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                  payload
                )
              )
            );

            const deadSubIds: string[] = [];
            results.forEach((r, i) => {
              if (r.status === "rejected") {
                const statusCode = (r.reason && ((r.reason as any).statusCode || (r.reason as any).status)) || null;
                if (statusCode === 404 || statusCode === 410) {
                  deadSubIds.push(customerSubs[i].id);
                }
              } else {
                customerSent++;
              }
            });
            if (deadSubIds.length > 0) {
              await supabase.from("customer_push_subscriptions").delete().in("id", deadSubIds);
            }
          }
        }
      }

      return new Response(JSON.stringify({ target: "status_update", customerSent, merchantCancelsSent }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // =========================================================================
    // BRANCH 2: MERCHANT NEW ORDER NOTIFICATION
    // =========================================================================
    const { data: subs, error: subsErr } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("store_id", order.store_id);
    if (subsErr) {
      return new Response(JSON.stringify({ error: subsErr.message }), { status: 500 });
    }
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ message: "No push subscriptions for this store" }), { status: 200 });
    }

    const amount = order.total ? `₦${Number(order.total).toLocaleString()}` : "";
    const payload = JSON.stringify({
      title: "📦 New Order!",
      body: `${order.customer_name || "A customer"} just placed an order${amount ? ` — ${amount}` : ""}. Tap to view.`,
      tag: `order-${order.id}`,
      url: "/?tab=orders",
    });

    const results = await Promise.allSettled(
      subs.map((sub: any) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      )
    );

    const deadSubIds: string[] = [];
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const statusCode = (r.reason && ((r.reason as any).statusCode || (r.reason as any).status)) || null;
        if (statusCode === 404 || statusCode === 410) {
          deadSubIds.push(subs[i].id);
        } else {
          console.error("Merchant push send failed:", r.reason?.message || r.reason);
        }
      }
    });
    if (deadSubIds.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", deadSubIds);
    }

    const sent = results.filter(r => r.status === "fulfilled").length;
    return new Response(JSON.stringify({ target: "merchant", sent, total: subs.length, removed: deadSubIds.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("send-order-push error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});

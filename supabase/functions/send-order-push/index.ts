// send-order-push
//
// Handles two distinct push notification workflows:
// 1) Merchant Notifications: Called by Postgres trigger when a new row is inserted into `orders`.
//    Looks up subscriptions in `push_subscriptions` by store_id and alerts merchants.
// 2) Customer Notifications: Called by Postgres trigger `on_order_status_update_send_push` when `orders.status` is updated.
//    Looks up customer device endpoints in `customer_push_subscriptions` matching `customer_phone`, and alerts customers even if their browser/app is completely closed.
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
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:support@example.com";

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
    // BRANCH 1: CUSTOMER ORDER STATUS UPDATE NOTIFICATION
    // =========================================================================
    if (isCustomerUpdate) {
      if (!order.customer_phone) {
        return new Response(JSON.stringify({ message: "No customer_phone associated with order" }), { status: 200 });
      }

      // Extract last 10 digits of phone number to match any formatting (+23480..., 080..., 23480...)
      const cleanedPhone = order.customer_phone.replace(/\D/g, "");
      const phoneTail = cleanedPhone.length >= 10 ? cleanedPhone.slice(-10) : cleanedPhone;
      if (!phoneTail || phoneTail.length < 5) {
        return new Response(JSON.stringify({ message: "Invalid customer phone format" }), { status: 200 });
      }

      const { data: customerSubs, error: subsErr } = await supabase
        .from("customer_push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .like("customer_phone", `%${phoneTail}%`);

      if (subsErr) {
        return new Response(JSON.stringify({ error: subsErr.message }), { status: 500 });
      }
      if (!customerSubs || customerSubs.length === 0) {
        return new Response(JSON.stringify({ message: "No push subscriptions registered for this customer phone" }), { status: 200 });
      }

      const rawStatus = (bodyJson.new_status || order.status || "").toString();
      const normStatus = rawStatus.toLowerCase().trim();
      const orderRef = order.order_number ? `#${order.order_number}` : `#${order.id.slice(0, 8)}`;

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
          const statusCode = (r.reason && (r.reason.statusCode || r.reason.status)) || null;
          if (statusCode === 404 || statusCode === 410) {
            deadSubIds.push(customerSubs[i].id);
          } else {
            console.error("Customer push send failed:", r.reason?.message || r.reason);
          }
        }
      });
      if (deadSubIds.length > 0) {
        await supabase.from("customer_push_subscriptions").delete().in("id", deadSubIds);
      }

      const sent = results.filter(r => r.status === "fulfilled").length;
      return new Response(JSON.stringify({ target: "customer", sent, total: customerSubs.length, removed: deadSubIds.length }), {
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

    const amount = order.total ? `\u20a6${Number(order.total).toLocaleString()}` : "";
    const payload = JSON.stringify({
      title: "\ud83d\udce6 New Order!",
      body: `${order.customer_name || "A customer"} just placed an order${amount ? ` \u2014 ${amount}` : ""}. Tap to view.`,
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
        const statusCode = (r.reason && (r.reason.statusCode || r.reason.status)) || null;
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

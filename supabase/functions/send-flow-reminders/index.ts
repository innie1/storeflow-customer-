// send-flow-reminders
//
// Handles background Web Push notifications for StoreFlow merchants when their app
// is closed or not running in the background.
// Supports three main categories of reminders:
// 1) Streak Reminders: Encourages merchants to open StoreFlow and maintain their daily usage streak & Flow rewards.
// 2) Sales Check-In: Reminds merchants to track daily sales, check margins, and review performance.
// 3) Debt & Bill Reminders: Prompts merchants to review overdue customer balances and recurring bills.
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
      return new Response(JSON.stringify({ error: "VAPID keys not configured" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    let storeId: string | null = null;
    let reminderType: "streak" | "sales" | "debt" | "auto" = "auto";
    let customTitle: string | null = null;
    let customBody: string | null = null;

    if (req.method === "POST" || req.method === "PUT") {
      try {
        const bodyJson = await req.json();
        if (bodyJson.store_id || bodyJson.storeId) storeId = bodyJson.store_id || bodyJson.storeId;
        if (bodyJson.reminder_type || bodyJson.reminderType || bodyJson.type) {
          reminderType = bodyJson.reminder_type || bodyJson.reminderType || bodyJson.type;
        }
        if (bodyJson.title) customTitle = bodyJson.title;
        if (bodyJson.body) customBody = bodyJson.body;
      } catch (e) {
        console.log("No JSON body in request, defaulting to auto batch reminder mode.");
      }
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Query active merchant push subscriptions from database
    let query = supabase.from("push_subscriptions").select("id, store_id, endpoint, p256dh, auth");
    if (storeId) {
      query = query.eq("store_id", storeId);
    }

    const { data: subs, error: subsErr } = await query;
    if (subsErr) {
      return new Response(JSON.stringify({ error: subsErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ message: "No active push subscriptions found", sent: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Determine payload based on reminder type or daily rotation
    // In 'auto' mode, pick based on day of year to cycle between streak, sales, and debt reminders
    let actualType = reminderType;
    if (actualType === "auto") {
      const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
      const types: ("streak" | "sales" | "debt")[] = ["streak", "sales", "streak", "debt"];
      actualType = types[dayOfYear % types.length];
    }

    let title = "⚡ StoreFlow Alert";
    let bodyText = "Take 60 seconds to review your inventory and cash flow today!";
    let tag = "flow-reminder";
    let url = "/?tab=dashboard";
    let actions = [{ action: "open", title: "⚡ Open StoreFlow" }];

    if (actualType === "streak") {
      title = "🔥 Protect Your Flow Streak!";
      bodyText = "Don't let your daily streak reset! Tap to log in today, record your progress, and earn Flow rewards.";
      tag = "flow-streak-reminder";
      url = "/?tab=dashboard";
      actions = [{ action: "open", title: "🔥 Protect Streak" }];
    } else if (actualType === "sales") {
      title = "📈 Daily Flow Sales Check-In";
      bodyText = "How is your store tracking today? Open StoreFlow to check your margins and restock score.";
      tag = "flow-sales-reminder";
      url = "/?tab=history";
      actions = [{ action: "open", title: "📈 Check Sales" }];
    } else if (actualType === "debt") {
      title = "⏰ Pending Balance & Repayment Reminder";
      bodyText = "Flow noticed pending balances or bills due soon. Tap to send 1-click WhatsApp collection reminders!";
      tag = "flow-debt-reminder";
      url = "/?tab=pending";
      actions = [{ action: "open", title: "💰 View Pending" }];
    }

    if (customTitle) title = customTitle;
    if (customBody) bodyText = customBody;

    const payload = JSON.stringify({
      title,
      body: bodyText,
      tag,
      url,
      actions
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
          console.error(`Push send failed for store ${subs[i].store_id}:`, r.reason?.message || r.reason);
        }
      }
    });

    if (deadSubIds.length > 0) {
      await supabase.from("push_subscriptions").delete().in("id", deadSubIds);
      console.log(`Cleaned up ${deadSubIds.length} expired push subscriptions.`);
    }

    const sent = results.filter(r => r.status === "fulfilled").length;
    return new Response(JSON.stringify({ target: "merchant_reminders", type: actualType, sent, total: subs.length, removed: deadSubIds.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("send-flow-reminders error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

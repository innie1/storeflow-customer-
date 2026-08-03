import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "StoreFlow <onboarding@resend.dev>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!RESEND_API_KEY) {
      console.error("Missing RESEND_API_KEY secret in environment.");
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY is not configured in Supabase Edge Function secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { to, storeName, accessCode, storeId, storeUrl, emergencyRecoveryKey, recoveryQuestion, type, code } = body;

    if (!to || typeof to !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing required 'to' email address." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let subject = "";
    let htmlContent = "";

    const cleanStoreName = storeName ? storeName.trim() : "StoreFlow Business";
    const effectiveStoreId = storeId || accessCode || "";

    // Case 1: Verification Code for Account Recovery / Reset Password
    if (type === "verification_code" || code) {
      subject = `${code} is your StoreFlow verification code`;
      htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #09090b; color: #f4f4f5; padding: 40px 20px; margin: 0;">
          <div style="max-width: 500px; margin: 0 auto; background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
            <!-- Header -->
            <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 32px 24px; text-align: center;">
              <h1 style="color: #ffffff; font-size: 28px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">StoreFlow</h1>
              <p style="color: #bfdbfe; font-size: 14px; margin: 6px 0 0 0; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">Security & Verification</p>
            </div>
            
            <!-- Body -->
            <div style="padding: 32px 24px;">
              <h2 style="color: #f4f4f5; font-size: 20px; font-weight: 700; margin: 0 0 12px 0;">Hello, ${cleanStoreName}</h2>
              <p style="color: #a1a1aa; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
                We received a request to verify your identity or recover access to your StoreFlow dashboard. Enter the verification code below:
              </p>
              
              <!-- Verification Code Box -->
              <div style="background-color: #27272a; border: 2px dashed #3f3f46; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
                <span style="font-family: monospace; font-size: 36px; font-weight: 800; color: #60a5fa; letter-spacing: 6px;">${code}</span>
              </div>
              
              <p style="color: #71717a; font-size: 13px; line-height: 1.5; margin: 0 0 24px 0;">
                If you did not request this verification code, please ignore this email or check your store security settings.
              </p>
              
              <hr style="border: none; border-top: 1px solid #27272a; margin: 24px 0;">
              
              <p style="color: #52525b; font-size: 12px; text-align: center; margin: 0;">
                &copy; ${new Date().getFullYear()} StoreFlow Intelligent Retail Dashboard
              </p>
            </div>
          </div>
        </body>
        </html>
      `;
    } 
    // Case 2: Store Onboarding / Security Setup & QR Code Delivery
    else {
      const isNewAccount = type === "new_account";
      subject = isNewAccount 
        ? `🎉 Welcome to StoreFlow — Account Details & QR Code for ${cleanStoreName}`
        : `🛡️ Security & Store Details for ${cleanStoreName}`;

      const headerBg = isNewAccount 
        ? "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" 
        : "linear-gradient(135deg, #065f46 0%, #10b981 100%)";
      const headerTitle = isNewAccount ? "Welcome to StoreFlow" : "StoreFlow Vault";
      const headerSub = isNewAccount ? "Your Store Credentials & QR Code" : "Account Recovery & Store Details";
      const introText = isNewAccount
        ? `Congratulations on getting set up with <strong>${cleanStoreName}</strong>! Below are your important store credentials, login codes, and custom storefront QR Code so you have everything ready in one place.`
        : `You have successfully configured security recovery details for <strong>${cleanStoreName}</strong>. Keep this email safe! You can use the credentials and storefront details below anytime you need to manage your business.`;

      htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #09090b; color: #f4f4f5; padding: 40px 20px; margin: 0;">
          <div style="max-width: 560px; margin: 0 auto; background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
            <!-- Header -->
            <div style="background: ${headerBg}; padding: 36px 24px; text-align: center;">
              <h1 style="color: #ffffff; font-size: 28px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">${headerTitle}</h1>
              <p style="color: #e2e8f0; font-size: 14px; margin: 8px 0 0 0; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">${headerSub}</p>
            </div>
            
            <!-- Body -->
            <div style="padding: 32px 24px;">
              <h2 style="color: #f4f4f5; font-size: 20px; font-weight: 700; margin: 0 0 12px 0;">Hello, ${cleanStoreName}! 👋</h2>
              <p style="color: #a1a1aa; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
                ${introText}
              </p>
              
              <!-- Vault & Store Credentials Box -->
              <div style="background-color: #27272a; border: 1px solid #3f3f46; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
                <h3 style="color: #ffffff; font-size: 16px; font-weight: 700; margin: 0 0 16px 0; border-bottom: 1px solid #3f3f46; padding-bottom: 12px;">🔑 Store Credentials</h3>
                
                <div style="margin-bottom: 16px;">
                  <span style="display: block; color: #a1a1aa; font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Store Business Name</span>
                  <strong style="color: #f4f4f5; font-size: 16px;">${cleanStoreName}</strong>
                </div>
                ${accessCode ? `
                <div style="margin-bottom: 16px;">
                  <span style="display: block; color: #a1a1aa; font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Merchant Access Code (For Dashboard Login)</span>
                  <div style="margin-top: 4px;">
                    <strong style="font-family: monospace; background-color: #09090b; padding: 6px 12px; border-radius: 6px; border: 1px solid #3f3f46; color: #34d399; font-size: 20px; letter-spacing: 3px; display: inline-block;">${accessCode}</strong>
                  </div>
                </div>` : ""}
                ${effectiveStoreId && effectiveStoreId !== accessCode ? `
                <div style="margin-bottom: 16px;">
                  <span style="display: block; color: #a1a1aa; font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Customer Store ID (For Ordering App)</span>
                  <strong style="font-family: monospace; color: #60a5fa; font-size: 18px; letter-spacing: 1px;">${effectiveStoreId}</strong>
                </div>` : ""}
                ${emergencyRecoveryKey ? `
                <div style="margin-bottom: 16px;">
                  <span style="display: block; color: #a1a1aa; font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Emergency Recovery Key (Keep Secret)</span>
                  <div style="background-color: #18181b; padding: 10px 14px; border-radius: 8px; border: 1px solid #3f3f46; margin-top: 4px;">
                    <strong style="font-family: monospace; color: #fbbf24; font-size: 16px; letter-spacing: 1px;">${emergencyRecoveryKey}</strong>
                  </div>
                </div>` : ""}
                ${recoveryQuestion ? `
                <div>
                  <span style="display: block; color: #a1a1aa; font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px;">Security Challenge Question</span>
                  <strong style="color: #e4e4e7; font-size: 15px;">"${recoveryQuestion}"</strong>
                </div>` : ""}
              </div>

              <!-- Customer Storefront & QR Code Box -->
              ${storeUrl ? `
              <div style="background-color: #18181b; border: 1px solid #3f3f46; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px; box-shadow: inset 0 2px 4px 0 rgba(0, 0, 0, 0.2);">
                <h3 style="color: #ffffff; font-size: 16px; font-weight: 700; margin: 0 0 8px 0;">📱 Customer Storefront & QR Code</h3>
                <p style="color: #a1a1aa; font-size: 13px; line-height: 1.5; margin: 0 0 20px 0;">
                  Share this interactive QR code or web link with your customers! When they scan or tap it, they will land directly inside your store ready to order.
                </p>
                <a href="${storeUrl}" target="_blank" style="display: inline-block; text-decoration: none;">
                  <img src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&color=000000&bgcolor=FFFFFF&margin=12&data=${encodeURIComponent(storeUrl)}" alt="Store QR Code" width="180" height="180" style="display: block; margin: 0 auto; border-radius: 12px; background-color: #ffffff; padding: 6px; border: 3px solid #3b82f6; box-shadow: 0 10px 15px -3px rgba(59, 130, 246, 0.3);" />
                </a>
                <div style="margin-top: 18px; background-color: #09090b; padding: 10px 14px; border-radius: 8px; border: 1px solid #27272a; word-break: break-all;">
                  <span style="display: block; color: #71717a; font-size: 11px; text-transform: uppercase; font-weight: 700; margin-bottom: 4px;">Storefront URL Link</span>
                  <a href="${storeUrl}" target="_blank" style="color: #60a5fa; font-size: 13px; text-decoration: none; font-weight: 600;">${storeUrl}</a>
                </div>
              </div>` : ""}
              
              <div style="background-color: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 8px; padding: 16px; margin-bottom: 24px;">
                <p style="color: #93c5fd; font-size: 13px; margin: 0; line-height: 1.5;">
                  <strong>💡 Pro Tip:</strong> For complete security, your account passwords are never stored in plain text and are omitted from email backups.
                </p>
              </div>
              
              <hr style="border: none; border-top: 1px solid #27272a; margin: 24px 0;">
              
              <p style="color: #52525b; font-size: 12px; text-align: center; margin: 0;">
                &copy; ${new Date().getFullYear()} StoreFlow Intelligent Retail Dashboard &mdash; Powered by Resend
              </p>
            </div>
          </div>
        </body>
        </html>
      `;
    }

    console.log(`Sending Resend email [${subject}] to [${to}]...`);

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [to],
        subject: subject,
        html: htmlContent,
      }),
    });

    const result = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("Resend API error:", result);
      return new Response(
        JSON.stringify({ error: "Failed to send email via Resend API", details: result }),
        { status: resendResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Successfully sent Resend email! Result:", result);

    return new Response(
      JSON.stringify({ success: true, resendId: result.id || result, type: type || "recovery_vault" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("send-account-recovery-email uncaught error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Unknown internal error occurred in edge function" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

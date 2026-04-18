/**
 * Email Alert Netlify Function
 *
 * Sends compliance email alerts via configured email service.
 * Called by workflow-engine.js when email_alert actions fire.
 *
 * Requires EMAIL_SERVICE_URL env var (e.g., SendGrid, Resend, or custom endpoint).
 */

import type { Config, Context } from "@netlify/functions";
import { checkRateLimit } from "./middleware/rate-limit.mts";
import { authenticate } from "./middleware/auth.mts";
import { fetchWithTimeout } from "../../src/utils/fetchWithTimeout";

interface AlertPayload {
  subject: string;
  message: string;
  priority: "low" | "medium" | "high" | "critical";
  ruleName?: string;
  entityName?: string;
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Rate limit: 10 requests per IP per 15 minutes (use context.ip for reliable IP)
  const rateLimitResponse = await checkRateLimit(req, { max: 10, clientIp: context.ip });
  if (rateLimitResponse) return rateLimitResponse;

  // Authentication required — prevent unauthenticated alert injection
  const auth = authenticate(req);
  if (!auth.ok) return auth.response!;

  const emailServiceUrl = Netlify.env.get("EMAIL_SERVICE_URL");
  const emailFrom = Netlify.env.get("EMAIL_FROM") || "";
  const emailTo = Netlify.env.get("EMAIL_TO_CO") || "";

  if (!emailServiceUrl) {
    return Response.json(
      { sent: false, reason: "EMAIL_SERVICE_URL not configured", queued: true },
      { status: 200 }
    );
  }
  if (!emailFrom) {
    return Response.json(
      { sent: false, reason: "EMAIL_FROM not configured" },
      { status: 200 }
    );
  }
  if (!emailTo) {
    return Response.json(
      { sent: false, reason: "EMAIL_TO_CO not configured" },
      { status: 200 }
    );
  }

  // Only allow outbound email delivery to a curated set of hosts. Prevents a
  // misconfigured EMAIL_SERVICE_URL from reaching an internal metadata
  // endpoint or an arbitrary attacker-controlled host.
  const EMAIL_HOST_ALLOWLIST = new Set<string>([
    'api.sendgrid.com',
    'api.resend.com',
    'api.postmarkapp.com',
    'api.mailgun.net',
    'api.sparkpost.com',
  ]);
  let parsedUrl: URL;
  try { parsedUrl = new URL(emailServiceUrl); } catch { return Response.json({ error: 'EMAIL_SERVICE_URL invalid' }, { status: 500 }); }
  if (parsedUrl.protocol !== 'https:' || !EMAIL_HOST_ALLOWLIST.has(parsedUrl.hostname)) {
    console.error('[send-alert] EMAIL_SERVICE_URL rejected: ' + parsedUrl.hostname);
    return Response.json({ error: 'EMAIL_SERVICE_URL host not allowed' }, { status: 500 });
  }

  try {
    const payload: AlertPayload = await req.json();

    if (!payload.subject || !payload.message) {
      return Response.json({ error: "subject and message required" }, { status: 400 });
    }

    // Sanitize EVERY field — not just subject. CRLF injection into the
    // email body lets an attacker craft BCC headers / add attachments
    // via the upstream provider's free-form API.
    const sanitize = (s: string) => String(s).replace(/[\r\n\u0000-\u001F]/g, " ").slice(0, 2000);
    const sanitizeShort = (s: string) => String(s).replace(/[\r\n\u0000-\u001F]/g, " ").slice(0, 200);
    const sanitizedMessage = sanitize(payload.message);
    const sanitizedSubject = sanitizeShort(`[${payload.priority?.toUpperCase() || "ALERT"}] ${payload.subject}`);
    const sanitizedRule    = sanitizeShort(payload.ruleName || "manual");
    const sanitizedEntity  = sanitizeShort(payload.entityName || "N/A");
    const sanitizedPriority= sanitizeShort(payload.priority || "medium");

    // Forward to configured email service
    const emailBody = {
      from: emailFrom,
      to: emailTo,
      subject: sanitizedSubject,
      text: [
        sanitizedMessage,
        "",
        `Rule: ${sanitizedRule}`,
        `Entity: ${sanitizedEntity}`,
        `Priority: ${sanitizedPriority}`,
        `Timestamp: ${new Date().toISOString()}`,
        "",
        "— Hawkeye Sterling V2 Compliance Suite",
      ].join("\n"),
    };

    const response = await fetchWithTimeout(emailServiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailBody),
      timeoutMs: 10000,
    });

    if (!response.ok) {
      console.error('[send-alert] upstream failure: ' + response.status);
      return Response.json(
        { sent: false, reason: `Email service returned ${response.status}` },
        { status: 502 }
      );
    }

    return Response.json({ sent: true, to: emailTo, subject: emailBody.subject });
  } catch (e) {
    console.error('[send-alert] delivery error:', (e as Error).message);
    return Response.json(
      { error: "Failed to send alert email" },
      { status: 500 }
    );
  }
};

export const config: Config = {
  path: "/api/send-alert",
  method: ["POST", "OPTIONS"],
};

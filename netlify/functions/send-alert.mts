/**
 * Email Alert Netlify Function
 *
 * Sends compliance email alerts via configured email service.
 * Called by workflow-engine.js when email_alert actions fire.
 *
 * Requires EMAIL_SERVICE_URL env var (e.g., SendGrid, Resend, or custom endpoint).
 */

import type { Config } from "@netlify/functions";

interface AlertPayload {
  subject: string;
  message: string;
  priority: "low" | "medium" | "high" | "critical";
  ruleName?: string;
  entityName?: string;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const emailServiceUrl = Netlify.env.get("EMAIL_SERVICE_URL");
  const emailFrom = Netlify.env.get("EMAIL_FROM") || "compliance@hawkeye-sterling.com";
  const emailTo = Netlify.env.get("EMAIL_TO_CO") || "";

  if (!emailServiceUrl) {
    return Response.json(
      { sent: false, reason: "EMAIL_SERVICE_URL not configured", queued: true },
      { status: 200 }
    );
  }

  if (!emailTo) {
    return Response.json(
      { sent: false, reason: "EMAIL_TO_CO not configured" },
      { status: 200 }
    );
  }

  try {
    const payload: AlertPayload = await req.json();

    if (!payload.subject || !payload.message) {
      return Response.json({ error: "subject and message required" }, { status: 400 });
    }

    // Forward to configured email service
    const emailBody = {
      from: emailFrom,
      to: emailTo,
      subject: `[${payload.priority?.toUpperCase() || "ALERT"}] ${payload.subject}`,
      text: [
        payload.message,
        "",
        `Rule: ${payload.ruleName || "manual"}`,
        `Entity: ${payload.entityName || "N/A"}`,
        `Priority: ${payload.priority || "medium"}`,
        `Timestamp: ${new Date().toISOString()}`,
        "",
        "— Hawkeye Sterling V2 Compliance Suite",
      ].join("\n"),
    };

    const response = await fetch(emailServiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailBody),
    });

    if (!response.ok) {
      return Response.json(
        { sent: false, reason: `Email service returned ${response.status}` },
        { status: 502 }
      );
    }

    return Response.json({ sent: true, to: emailTo, subject: emailBody.subject });
  } catch (e) {
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

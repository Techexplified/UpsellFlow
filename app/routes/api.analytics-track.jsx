/**
 * api.analytics-track.jsx
 *
 * CORS-enabled endpoint for checkout extensions & storefront scripts to log
 * real-time impressions and conversions into AnalyticsEvent table.
 */

import prisma from "../db.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const text = await request.text();
    const body = JSON.parse(text);
    const { shop, featureType, eventType, revenue, offerId } = body;

    if (!shop || !featureType || !eventType) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      });
    }

    await prisma.analyticsEvent.create({
      data: {
        shop,
        featureType, // "SWAP", "THANK_YOU_UPSELL", "DISCOUNT_WIDGET", "REFERRAL_WIDGET"
        eventType,   // "IMPRESSION", "CONVERSION"
        revenue: parseFloat(revenue) || 0.0,
        offerId: offerId || null,
      },
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  } catch (err) {
    console.error("[Analytics Track] Error logging event:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
};

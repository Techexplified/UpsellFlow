/**
 * api.edit-order.jsx
 *
 * A dedicated, CORS-enabled API endpoint for the Thank You page UI extension to
 * add products to an existing order. Uses unauthenticated.admin for server-side
 * Shopify Admin GraphQL access — no proxy HMAC signature required.
 *
 * Route: /api/edit-order
 */

import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";

// ── CORS ────────────────────────────────────────────────────────────────────
const CORS_ORIGINS = [
  "https://extensions.shopifycdn.com",
  "https://checkout.shopify.com",
];

const getCorsHeaders = (request) => {
  const origin = request.headers.get("origin") || "";
  // Allow known Shopify extension CDN origins, or echo back if it matches *.shopify.com
  const allowedOrigin =
    CORS_ORIGINS.includes(origin) || origin.endsWith(".shopify.com") || origin.endsWith(".myshopify.com")
      ? origin
      : CORS_ORIGINS[0];

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
};

// Handle OPTIONS preflight — must be in loader (GET) since Remix routes OPTIONS there
export const loader = async ({ request }) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
};

export const action = async ({ request }) => {
  // Always handle OPTIONS (some clients send it via action too)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  }

  const corsHeaders = getCorsHeaders(request);

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try {
    const text = await request.text();
    body = JSON.parse(text);
  } catch (e) {
    console.error("[UpsellFlow API] Failed to parse request body:", e);
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const { orderId, variantId, shop } = body;

  if (!orderId || !variantId || !shop) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: orderId, variantId, shop" }),
      { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  console.log(`[UpsellFlow API] Edit order request — shop: ${shop}, order: ${orderId}, variant: ${variantId}`);

  // ── Authenticate via unauthenticated.admin ────────────────────────────────
  let admin;
  try {
    const authResult = await unauthenticated.admin(shop);
    admin = authResult.admin;
  } catch (e) {
    console.error("[UpsellFlow API] unauthenticated.admin() failed:", e);
    return new Response(
      JSON.stringify({ error: "Could not authenticate with Shopify Admin. Make sure the app is installed." }),
      { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  try {
    // ── STEP 1: orderEditBegin ──────────────────────────────────────────────
    const beginRes = await admin.graphql(
      `mutation orderEditBegin($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder { id }
          userErrors { field message }
        }
      }`,
      { variables: { id: orderId } }
    );
    const beginJson = await beginRes.json();
    const beginData = beginJson?.data?.orderEditBegin;

    if (beginData?.userErrors?.length > 0) {
      console.error("[UpsellFlow API] orderEditBegin userErrors:", beginData.userErrors);
      return new Response(
        JSON.stringify({ error: beginData.userErrors[0].message }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const calculatedOrderId = beginData?.calculatedOrder?.id;
    if (!calculatedOrderId) {
      return new Response(
        JSON.stringify({ error: "Failed to begin order edit session" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ── STEP 2: orderEditAddVariant ─────────────────────────────────────────
    const addRes = await admin.graphql(
      `mutation orderEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
        orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
          calculatedLineItem { id }
          userErrors { field message }
        }
      }`,
      { variables: { id: calculatedOrderId, quantity: 1, variantId } }
    );
    const addJson = await addRes.json();
    const addData = addJson?.data?.orderEditAddVariant;

    if (addData?.userErrors?.length > 0) {
      console.error("[UpsellFlow API] orderEditAddLineItem userErrors:", addData.userErrors);
      return new Response(
        JSON.stringify({ error: addData.userErrors[0].message }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // ── STEP 3: orderEditCommit ─────────────────────────────────────────────
    const commitRes = await admin.graphql(
      `mutation orderEditCommit($id: ID!, $notifyCustomer: Boolean!, $staffNote: String!) {
        orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
          order { id }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          id: calculatedOrderId,
          notifyCustomer: false,
          staffNote: "Product added via UpsellFlow post-purchase upsell",
        },
      }
    );
    const commitJson = await commitRes.json();
    const commitData = commitJson?.data?.orderEditCommit;

    if (commitData?.userErrors?.length > 0) {
      console.error("[UpsellFlow API] orderEditCommit userErrors:", commitData.userErrors);
      return new Response(
        JSON.stringify({ error: commitData.userErrors[0].message }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`[UpsellFlow API] ✅ Successfully added variant ${variantId} to order ${orderId}`);

    // Fetch the payment collection URL for the outstanding balance
    let additionalPaymentCollectionUrl = null;
    try {
      const paymentRes = await admin.graphql(
        `query getOrderPaymentUrl($id: ID!) {
          order(id: $id) {
            paymentCollectionDetails {
              additionalPaymentCollectionUrl
            }
          }
        }`,
        { variables: { id: orderId } }
      );
      const paymentJson = await paymentRes.json();
      additionalPaymentCollectionUrl = paymentJson?.data?.order?.paymentCollectionDetails?.additionalPaymentCollectionUrl;
      console.log(`[UpsellFlow API] Resolved payment URL: ${additionalPaymentCollectionUrl}`);
    } catch (e) {
      console.error("[UpsellFlow API] Failed to fetch paymentCollectionDetails:", e);
    }

    // Fetch variant price dynamically to log accurate revenue
    let variantPrice = 25.00;
    try {
      const variantRes = await admin.graphql(
        `query getVariantPrice($id: ID!) {
          productVariant(id: $id) {
            price
          }
        }`,
        { variables: { id: variantId } }
      );
      const variantJson = await variantRes.json();
      const fetchedPrice = parseFloat(variantJson?.data?.productVariant?.price);
      if (!isNaN(fetchedPrice)) {
        variantPrice = fetchedPrice;
      }
    } catch (e) {
      console.error("[UpsellFlow API] Failed to fetch variant price for analytics:", e);
    }

    // Record Real-Time Analytics Event
    try {
      await prisma.analyticsEvent.create({
        data: {
          shop,
          featureType: "THANK_YOU_UPSELL",
          eventType: "CONVERSION",
          revenue: variantPrice,
        },
      });
    } catch (e) {
      console.error("[UpsellFlow API] Failed to log analytics conversion event:", e);
    }

    return new Response(JSON.stringify({
      success: true,
      orderId,
      additionalPaymentCollectionUrl
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch (err) {
    console.error("[UpsellFlow API] Unexpected error during order edit:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error: " + (err?.message || String(err)) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

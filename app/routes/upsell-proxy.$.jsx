import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";

const getCorsHeaders = (request) => {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin =
    !origin ||
    origin.endsWith(".shopify.com") ||
    origin.endsWith(".myshopify.com") ||
    origin.includes("shopifycdn.com")
      ? origin || "*"
      : "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, text/plain",
    "Vary": "Origin",
  };
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: getCorsHeaders(request),
    });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response(JSON.stringify({ error: "Missing shop parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
    });
  }

  try {
    const offers = await prisma.upsellOffer.findMany({
      where: {
        shop,
        isActive: true,
      },
    });

    return new Response(JSON.stringify({ offers }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
    });
  } catch (error) {
    console.error("Error in upsell-proxy loader:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
    });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: getCorsHeaders(request),
    });
  }

  const url = new URL(request.url);
  const isEditOrderPath = url.pathname.endsWith("/api/edit-order");
  const isAnalyticsTrackPath = url.pathname.endsWith("/api/analytics-track");

  if (isAnalyticsTrackPath && request.method === "POST") {
    try {
      const text = await request.text();
      const body = JSON.parse(text);
      const { shop, featureType, eventType, revenue, offerId } = body;

      if (!shop || !featureType || !eventType) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
        });
      }

      await prisma.analyticsEvent.create({
        data: {
          shop,
          featureType,
          eventType,
          revenue: parseFloat(revenue) || 0.0,
          offerId: offerId || null,
        },
      });

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
      });
    } catch (err) {
      console.error("[Proxy Analytics Track] Error logging event:", err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
      });
    }
  }

  if (isEditOrderPath && request.method === "POST") {
    try {
      const text = await request.text();
      const body = JSON.parse(text);
      const { orderId, variantId, shop } = body;

      if (!orderId || !variantId) {
        return new Response(JSON.stringify({ error: "Missing orderId or variantId" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
        });
      }

      // 1. Authenticate admin client (try Proxy auth, fallback to direct session storage lookup)
      let admin;
      try {
        const authResult = await authenticate.public.appProxy(request);
        admin = authResult.admin;
      } catch (e) {
        console.log("[UpsellFlow Proxy] Proxy auth failed. Attempting unauthenticated fallback for shop:", shop);
        if (!shop) {
          return new Response(JSON.stringify({ error: "Missing shop domain for fallback authentication" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
          });
        }
        try {
          const authResult = await unauthenticated.admin(shop);
          admin = authResult.admin;
        } catch (err) {
          console.error("[UpsellFlow Proxy] Unauthenticated admin client fallback failed:", err);
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
          });
        }
      }

      console.log(`[UpsellFlow Proxy] Starting order edit for order: ${orderId}, variant: ${variantId}`);

      // ── STEP 1: orderEditBegin ──
      const beginQuery = `
        mutation orderEditBegin($id: ID!) {
          orderEditBegin(id: $id) {
            calculatedOrder { id }
            userErrors { field message }
          }
        }
      `;
      const beginRes = await admin.graphql(beginQuery, { variables: { id: orderId } });
      const beginJson = await beginRes.json();
      const beginData = beginJson?.data?.orderEditBegin;

      if (beginData?.userErrors && beginData.userErrors.length > 0) {
        console.error("[UpsellFlow Proxy] orderEditBegin error:", beginData.userErrors);
        return new Response(JSON.stringify({ error: beginData.userErrors[0].message }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
        });
      }

      const calculatedOrderId = beginData?.calculatedOrder?.id;
      if (!calculatedOrderId) {
        return new Response(JSON.stringify({ error: "Could not create order edit session" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
        });
      }

      // ── STEP 2: orderEditAddLineItem ──
      const addQuery = `
        mutation orderEditAddLineItem($id: ID!, $quantity: Int!, $variantId: ID!) {
          orderEditAddLineItem(id: $id, quantity: $quantity, variantId: $variantId) {
            calculatedOrder { id }
            userErrors { field message }
          }
        }
      `;
      const addRes = await admin.graphql(addQuery, {
        variables: {
          id: calculatedOrderId,
          quantity: 1,
          variantId: variantId,
        },
      });
      const addJson = await addRes.json();
      const addData = addJson?.data?.orderEditAddLineItem;

      if (addData?.userErrors && addData.userErrors.length > 0) {
        console.error("[UpsellFlow Proxy] orderEditAddLineItem error:", addData.userErrors);
        return new Response(JSON.stringify({ error: addData.userErrors[0].message }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
        });
      }

      // ── STEP 3: orderEditCommit ──
      const commitQuery = `
        mutation orderEditCommit($id: ID!) {
          orderEditCommit(id: $id) {
            order { id }
            userErrors { field message }
          }
        }
      `;
      const commitRes = await admin.graphql(commitQuery, { variables: { id: calculatedOrderId } });
      const commitJson = await commitRes.json();
      const commitData = commitJson?.data?.orderEditCommit;

      if (commitData?.userErrors && commitData.userErrors.length > 0) {
        console.error("[UpsellFlow Proxy] orderEditCommit error:", commitData.userErrors);
        return new Response(JSON.stringify({ error: commitData.userErrors[0].message }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
        });
      }

      console.log(`[UpsellFlow Proxy] ✅ Order ${orderId} edited successfully!`);

      // Fetch additionalPaymentCollectionUrl for the outstanding balance
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
        additionalPaymentCollectionUrl =
          paymentJson?.data?.order?.paymentCollectionDetails?.additionalPaymentCollectionUrl;
      } catch (e) {
        console.error("[UpsellFlow Proxy] Failed to fetch paymentCollectionDetails:", e);
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
        console.error("[UpsellFlow Proxy] Failed to fetch variant price for analytics:", e);
      }



      return new Response(JSON.stringify({ success: true, orderId, additionalPaymentCollectionUrl }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
      });

    } catch (err) {
      console.error("[UpsellFlow Proxy] Order edit exception:", err);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
      });
    }
  }

  return new Response(JSON.stringify({ error: "Not Found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
  });
};

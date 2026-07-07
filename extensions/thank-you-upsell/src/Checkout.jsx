// @ts-nocheck
import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';

// 1. Export the extension
export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const impressionTracked = useRef(false);
  const [loadingOfferId, setLoadingOfferId] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [paymentUrls, setPaymentUrls] = useState({});
  const [copied, setCopied] = useState(false);
  const [copiedReferral, setCopiedReferral] = useState(false);

  // Storefront products fetched dynamically
  const [storeProducts, setStoreProducts] = useState([]);
  const [selectedUpsells, setSelectedUpsells] = useState([]);

  // 2. Local state with Subscription pattern for reactive shopify object updates
  const [orderConfirmation, setOrderConfirmation] = useState(shopify.orderConfirmation?.value);
  const [order, setOrder] = useState(shopify.order?.value);
  const [appMetafields, setAppMetafields] = useState(shopify.appMetafields?.value || []);
  const [lines, setLines] = useState(shopify.lines?.value || []);

  useEffect(() => {
    const unsubOrderConf = shopify.orderConfirmation?.subscribe((val) => {
      setOrderConfirmation(val);
    });
    const unsubOrder = shopify.order?.subscribe((val) => {
      setOrder(val);
    });
    const unsubMetafields = shopify.appMetafields?.subscribe((val) => {
      setAppMetafields(val || []);
    });
    const unsubLines = shopify.lines?.subscribe((val) => {
      setLines(val || []);
    });

    return () => {
      if (unsubOrderConf) unsubOrderConf();
      if (unsubOrder) unsubOrder();
      if (unsubMetafields) unsubMetafields();
      if (unsubLines) unsubLines();
    };
  }, []);

  // Fetch products from Shopify Storefront API dynamically when component mounts
  useEffect(() => {
    async function fetchStoreProducts() {
      try {
        const response = await shopify.query(`
          query {
            products(first: 12) {
              nodes {
                id
                title
                featuredImage {
                  url
                }
                variants(first: 1) {
                  nodes {
                    id
                    title
                    price {
                      amount
                    }
                  }
                }
              }
            }
          }
        `);
        
        if (response.data?.products?.nodes) {
          setStoreProducts(response.data.products.nodes);
        }
      } catch (err) {
        console.error("[UpsellFlow Extension] Error querying Storefront API:", err);
      }
    }

    fetchStoreProducts();
  }, []);

  // Pick 2 random products from the store that are NOT already in the order and have images
  useEffect(() => {
    if (storeProducts.length > 0) {
      // Find GIDs of products already purchased in this order to avoid duplicates
      const purchasedProductIds = lines.map((l) => l.merchandise?.product?.id);
      
      const filtered = storeProducts.filter((p) => {
        // Exclude if already in the order
        if (purchasedProductIds.includes(p.id)) return false;
        // Exclude if it has no variants or price
        if (!p.variants?.nodes?.[0]?.id) return false;
        // Exclude if the product has no image uploaded in the admin
        if (!p.featuredImage?.url) return false;
        return true;
      });

      // Shuffle and pick 2
      const shuffled = [...filtered].sort(() => 0.5 - Math.random());
      setSelectedUpsells(shuffled.slice(0, 2));
    }
  }, [storeProducts, lines]);

  // Parse settings metafield
  const settingsMetafield = appMetafields.find(
    (meta) =>
      meta.metafield?.namespace === "upsellflow" &&
      meta.metafield?.key === "settings"
  );
  let settings = {
    thankYouWidgetEnabled: true,
    referralWidgetEnabled: true,
    discountWidgetEnabled: true,
    discountCode: "VIP-15-FLASH"
  };
  try {
    if (settingsMetafield?.metafield?.value) {
      settings = JSON.parse(settingsMetafield.metafield.value);
    }
  } catch (e) {
    console.error("[UpsellFlow Extension] Settings parse error:", e);
  }



  // If order details aren't loaded yet, show a clean loading state
  if (!orderConfirmation && !order) {
    return <s-text>Loading order details...</s-text>;
  }

  const activeOrder = orderConfirmation?.order || order;
  const orderCreatedAt = activeOrder?.processedAt;

  // Calculate remaining seconds
  const calculateSecondsLeft = () => {
    // Fallback to current time if order is still processing asynchronously on first land
    const orderTime = orderCreatedAt ? new Date(orderCreatedAt).getTime() : Date.now();
    const durationMinutes = settings.timerDuration ?? 15;
    const expiryTime = orderTime + durationMinutes * 60 * 1000;
    const now = Date.now();
    return Math.max(0, Math.floor((expiryTime - now) / 1000));
  };

  const [secondsLeft, setSecondsLeft] = useState(0);

  // Initialize and keep in sync with order / settings load
  useEffect(() => {
    setSecondsLeft(calculateSecondsLeft());
  }, [orderCreatedAt, settings.timerDuration]);

  // Tick the countdown every second
  useEffect(() => {
    if (secondsLeft <= 0) return;

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [secondsLeft]);

  // Format time as XXm XXs
  const formatTime = (totalSeconds) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}m ${seconds.toString().padStart(2, "0")}s`;
  };

  // Action: Add cross-sell product to the existing order using the app backend API
  const handleAddProduct = async (product) => {
    console.log("[DEBUG] handleAddProduct entered:", product.title);

    const variantId = product.variants?.nodes?.[0]?.id;
    if (!variantId) {
      setSuccessMessage("Error: Product variant not found.");
      return;
    }

    if (loadingOfferId) return;
    setLoadingOfferId(product.id);

    try {
      // activeOrder.id may be gid://shopify/OrderIdentity/XXX on Thank You page
      // but orderEditBegin requires gid://shopify/Order/XXX
      const rawId = activeOrder?.id || orderConfirmation?.order?.id;
      if (!rawId) {
        setSuccessMessage(`Error: Could not resolve order ID. activeOrder is ${typeof activeOrder}`);
        setLoadingOfferId(null);
        return;
      }
      // Normalize: replace any GID type with "Order"
      const orderId = rawId.replace(/gid:\/\/shopify\/[^/]+\//, "gid://shopify/Order/");
      console.log("[DEBUG] Raw order ID:", rawId, "→ Normalized:", orderId);

      // Call api/edit-order directly on the app backend using the URL stored
      // in the shop metafield. This is updated each time the merchant visits
      // the app dashboard — visit it once after each `shopify app dev` restart.
      const baseUrl = settings.appUrl
        ? settings.appUrl.replace(/\/$/, "")
        : `https://${shopify.shop.myshopifyDomain}`;
      const apiUrl = baseUrl + "/api/edit-order";

      console.log("[DEBUG] Posting to:", apiUrl, "shop:", shopify.shop.myshopifyDomain);

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId: orderId,
          variantId: variantId,
          shop: shopify.shop.myshopifyDomain,
        }),
      });

      const resJson = await response.json();
      if (resJson.success) {
        setSuccessMessage(`Successfully added ${product.title} to your order!`);
        if (resJson.additionalPaymentCollectionUrl) {
          setPaymentUrls((prev) => ({
            ...prev,
            [product.id]: resJson.additionalPaymentCollectionUrl,
          }));
        } else {
          const itemPrice = parseFloat(product.variants?.nodes?.[0]?.price?.amount || "0");
          trackEvent("THANK_YOU_UPSELL", "CONVERSION", itemPrice);
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        }
      } else {
        console.error("Failed to edit order:", resJson.error);
        setSuccessMessage("Error adding product to order. Please try again.");
      }
    } catch (err) {
      console.error("Error editing order:", err);
      setSuccessMessage(`Connection Error: ${err.message || String(err)}`);
    } finally {
      setLoadingOfferId(null);
    }
  };

  const trackEvent = (featureType, eventType, revenue = 0) => {
    try {
      const baseUrl = settings.appUrl
        ? settings.appUrl.replace(/\/$/, "")
        : `https://${shopify.shop.myshopifyDomain}`;
      fetch(`${baseUrl}/api/analytics-track`, {
        method: "POST",
        mode: "no-cors",
        body: JSON.stringify({
          shop: shopify.shop.myshopifyDomain,
          featureType,
          eventType,
          revenue,
        }),
      }).catch(() => {});
    } catch (e) {}
  };

  useEffect(() => {
    if (!settings?.appUrl) return;
    if (impressionTracked.current) return;
    impressionTracked.current = true;

    trackEvent("THANK_YOU_UPSELL", "IMPRESSION");
    trackEvent("DISCOUNT_WIDGET", "IMPRESSION");
    trackEvent("REFERRAL_WIDGET", "IMPRESSION");
  }, [settings?.appUrl]);

  const handleCopyCode = () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(settings.discountCode || "NEXT10");
      }
    } catch (e) {
      console.error("[UpsellFlow] Clipboard copy failed:", e);
    }
    setCopied(true);
    trackEvent("DISCOUNT_WIDGET", "CONVERSION", 10.0);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const getWhatsAppUrl = () => {
    const text = encodeURIComponent(`I just placed an order on ${shopify.shop.name}! Use this link to check out their products: https://${shopify.shop.myshopifyDomain}`);
    return `https://wa.me/?text=${text}`;
  };

  const getEmailUrl = () => {
    const subject = encodeURIComponent("Check out this awesome store!");
    const body = encodeURIComponent(`I just bought something awesome at ${shopify.shop.name}. Check it out here: https://${shopify.shop.myshopifyDomain}`);
    return `mailto:?subject=${subject}&body=${body}`;
  };

  const handleCopyReferral = () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(`https://${shopify.shop.myshopifyDomain}?ref=thankyou`);
      }
    } catch (e) {
      console.error("[UpsellFlow] Clipboard copy failed:", e);
    }
    setCopiedReferral(true);
    trackEvent("REFERRAL_WIDGET", "CONVERSION", 15.0);
    setTimeout(() => {
      setCopiedReferral(false);
    }, 2000);
  };

  return (
    <s-stack gap="base">

      {/* ── 1. Cross-sell / Upsell Widget ── */}
      {settings.thankYouWidgetEnabled && secondsLeft > 0 && selectedUpsells.length > 0 && (
        <s-box padding="base" border="base" borderRadius="base" background="surface">
          <s-stack gap="base">

            {/* Header with native vector icons */}
            <s-stack gap="extraTight">
              <s-stack direction="inline" gap="tight" blockAlignment="center">
                <s-icon type="delivery" name="delivery" />
                <s-heading level="2">Add before it ships!</s-heading>
              </s-stack>
              <s-stack direction="inline" gap="extraTight" blockAlignment="center">
                <s-icon type="clock" name="clock" tone="critical" />
                <s-text tone="critical" size="small">Offer closes in {formatTime(secondsLeft)} — act fast!</s-text>
              </s-stack>
            </s-stack>

            <s-divider />

            {/* Product Cards — single horizontal row matching reference design */}
            <s-stack gap="base">
              {selectedUpsells.map((product) => {
                const price = parseFloat(product.variants?.nodes?.[0]?.price?.amount || "0").toFixed(2);
                const imageUrl = product.featuredImage?.url;

                return (
                  <s-box padding="tight" border="base" borderRadius="base" background="surface" key={product.id}>
                    <s-grid columns="1fr auto" gap="base" blockAlignment="center">

                      <s-stack direction="inline" gap="base" blockAlignment="center">
                        <s-product-thumbnail
                          src={imageUrl}
                          alt={product.title}
                          size="small"
                        />
                        <s-stack gap="extraTight">
                          <s-text weight="bold" size="small">{product.title}</s-text>
                          <s-text size="small" tone="subdued">Limited time add-on</s-text>
                        </s-stack>
                      </s-stack>

                      {paymentUrls[product.id] ? (
                        <s-link href={paymentUrls[product.id]} target="_top">
                          <s-button
                            variant="primary"
                            tone="success"
                            onPress={() => trackEvent("THANK_YOU_UPSELL", "CONVERSION", parseFloat(price))}
                            onClick={() => trackEvent("THANK_YOU_UPSELL", "CONVERSION", parseFloat(price))}
                          >
                            Pay ${price}
                          </s-button>
                        </s-link>
                      ) : (
                        <s-button
                          variant="secondary"
                          onPress={() => handleAddProduct(product)}
                          onClick={() => handleAddProduct(product)}
                          disabled={loadingOfferId !== null}
                        >
                          {loadingOfferId === product.id ? "Adding..." : `Add for $${price}`}
                        </s-button>
                      )}

                    </s-grid>
                  </s-box>
                );
              })}
            </s-stack>

            {successMessage && (
              <s-banner tone={successMessage.includes("Error") ? "warning" : "success"}>
                {successMessage}
              </s-banner>
            )}

          </s-stack>
        </s-box>
      )}

      {/* ── 2. VIP Reward / Discount Code Widget ── */}
      {settings.discountWidgetEnabled && (
        <s-box padding="base" border="base" borderRadius="base" background="surface">
          <s-stack gap="base">

            {/* Header with native vector icon */}
            <s-stack gap="extraTight">
              <s-stack direction="inline" gap="tight" blockAlignment="center">
                <s-icon type="discount" name="discount" />
                <s-heading level="2">You unlocked a VIP Reward!</s-heading>
              </s-stack>
              <s-text size="small" tone="subdued">Exclusive offer for first-time subscribers</s-text>
            </s-stack>

            <s-divider />

            {/* Discount Code Row */}
            <s-stack gap="tight">
              <s-text size="small" tone="subdued" weight="bold">YOUR DISCOUNT CODE</s-text>
              <s-grid columns={["1fr", "auto"]} gap="base" blockAlignment="center">
                <s-box padding="base" border="base" borderRadius="base" background="subdued">
                  <s-text size="large" weight="bold">{settings.discountCode}</s-text>
                </s-box>
                <s-button variant="primary" onPress={handleCopyCode} onClick={handleCopyCode}>
                  {copied ? "Copied!" : "Copy Code"}
                </s-button>
              </s-grid>
            </s-stack>

          </s-stack>
        </s-box>
      )}

      {/* ── 3. Referral / Share Widget ── */}
      {settings.referralWidgetEnabled && (
        <s-box padding="base" border="base" borderRadius="base" background="surface">
          <s-stack gap="base">

            {/* Header with native vector icon */}
            <s-stack direction="inline" gap="tight" blockAlignment="center">
              <s-icon type="gift" name="gift" />
              <s-heading level="2">Love your order? Share with your friends.</s-heading>
            </s-stack>

            <s-divider />

            {/* Share Buttons using native s-button with href */}
            <s-stack direction="inline" gap="base">
              <s-button href={getWhatsAppUrl()} target="_blank" variant="primary" tone="success">
                WhatsApp
              </s-button>
              <s-button href={getEmailUrl()} target="_top" variant="secondary">
                Email
              </s-button>
            </s-stack>

            {/* Referral Link */}
            <s-stack gap="tight">
              <s-text size="small" tone="subdued" weight="bold">REFERRAL LINK</s-text>
              <s-box padding="base" border="base" borderRadius="base" background="subdued">
                <s-text size="small">{`https://${shopify.shop.myshopifyDomain}?ref=customer`}</s-text>
              </s-box>
            </s-stack>

          </s-stack>
        </s-box>
      )}

    </s-stack>
  );
}
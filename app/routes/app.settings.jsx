import { useState, useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useSubmit, useLoaderData, useActionData, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncOffersToMetafield } from "../lib/syncMetafield";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const stepParam = parseInt(url.searchParams.get("step") || "1", 10);

  let offer = null;
  if (id) {
    offer = await prisma.upsellOffer.findUnique({
      where: { id, shop },
    });
  }

  // Load thank-you settings
  let settings = await prisma.upsellSettings.findUnique({
    where: { shop },
  });
  if (!settings) {
    settings = await prisma.upsellSettings.create({
      data: { shop },
    });
  }

  return { offer, settings, stepParam, shop };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const actionType = formData.get("actionType");
  const offerId = formData.get("offerId");

  console.log("[UpsellFlow Settings] Action triggered:", { actionType, offerId, shop });

  if (actionType === "SIZE_UPGRADE" || actionType === "PACK_UPGRADE") {
    const triggerProductId = formData.get("triggerProductId");
    const triggerProductTitle = formData.get("triggerProductTitle");
    const triggerParentProductId = formData.get("triggerParentProductId");
    const triggerProductImage = formData.get("triggerProductImage");
    const upgradeProductId = formData.get("upgradeProductId");
    const upgradeProductTitle = formData.get("upgradeProductTitle");
    const upgradeParentProductId = formData.get("upgradeParentProductId");
    const upgradeProductImage = formData.get("upgradeProductImage");
    const priceDifference = parseFloat(formData.get("priceDifference") || "0");
    console.log("[UpsellFlow Settings] Size/Pack Upgrade form details:", {
      triggerProductId,
      triggerProductTitle,
      upgradeProductId,
      upgradeProductTitle,
    });

    // Check if another active/inactive mapping already triggers on the exact same product/variant
    const existingOffer = await prisma.upsellOffer.findFirst({
      where: {
        shop,
        triggerProductId,
        NOT: offerId && offerId !== "" ? { id: offerId } : undefined,
      },
    });

    console.log("[UpsellFlow Settings] existingOffer check:", existingOffer);

    if (existingOffer) {
      console.warn("[UpsellFlow Settings] Validation failed: mapping already exists on trigger product.");
      return { error: "This mapping already exists" };
    }

    let savedOffer;
    if (offerId && offerId !== "") {
      savedOffer = await prisma.upsellOffer.update({
        where: { id: offerId, shop },
        data: {
          triggerProductId,
          triggerProductTitle,
          triggerParentProductId,
          triggerProductImage,
          upgradeProductId,
          upgradeProductTitle,
          upgradeParentProductId,
          upgradeProductImage,
          priceDifference,
        },
      });
    } else {
      savedOffer = await prisma.upsellOffer.create({
        data: {
          shop,
          type: actionType,
          triggerProductId,
          triggerProductTitle,
          triggerParentProductId,
          triggerProductImage,
          upgradeProductId,
          upgradeProductTitle,
          upgradeParentProductId,
          upgradeProductImage,
          priceDifference,
          isActive: true,
        },
      });
    }
    console.log("[UpsellFlow Settings] Successfully saved offer:", savedOffer);
    
    // Sync active offers to shop metafield so storefront stays up-to-date
    await syncOffersToMetafield(admin, shop, prisma);

    console.log(`[UpsellFlow Settings] Returning step 4 for offer: ${savedOffer.id}`);
    return { success: true, step: 4, offerId: savedOffer.id };
  }

  if (actionType === "THANK_YOU_SETTINGS") {
    const thankYouWidgetEnabled = formData.get("thankYouWidgetEnabled") === "true";
    const referralWidgetEnabled = formData.get("referralWidgetEnabled") === "true";
    const discountWidgetEnabled = formData.get("discountWidgetEnabled") === "true";
    const discountCode = formData.get("discountCode") || "";
    const timerDuration = parseInt(formData.get("timerDuration") || "15", 10);

    await prisma.upsellSettings.upsert({
      where: { shop },
      update: {
        thankYouWidgetEnabled,
        referralWidgetEnabled,
        discountWidgetEnabled,
        discountCode,
        timerDuration,
      },
      create: {
        shop,
        thankYouWidgetEnabled,
        referralWidgetEnabled,
        discountWidgetEnabled,
        discountCode,
        timerDuration,
      },
    });

    // Sync settings to metafield
    const proto = request.headers.get("x-forwarded-proto") || "https";
    const host = request.headers.get("x-forwarded-host") || new URL(request.url).host;
    let appUrl = `${proto}://${host}`;
    if (appUrl.startsWith("http://")) {
      appUrl = appUrl.replace("http://", "https://");
    }
    const { syncSettingsToMetafield } = await import("../lib/syncMetafield");
    await syncSettingsToMetafield(admin, shop, prisma, appUrl);

    // Return JSON response instead of redirecting to stay inside settings sidebar
    return { success: true, step: 5 };
  }

  return redirect("/app");
};

export default function SettingsTemplatePage() {
  const { offer, settings, stepParam, shop } = useLoaderData() || { offer: null, settings: null, stepParam: 1, shop: "" };
  const actionData = useActionData();
  const shopify = useAppBridge();
  const submit = useSubmit();

  // Wizard steps: 1 = Template Selector, 2 = Configure Size Swap, 3 = Configure Pack Upgrade, 4 = Thank You Settings, 5 = Almost Live
  const [step, setStep] = useState(stepParam || 1);
  const [selectedTemplate, setSelectedTemplate] = useState("SIZE_UPGRADE");

  console.log("[UpsellFlow Frontend] Render - stepParam:", stepParam, "step state:", step);

  useEffect(() => {
    if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    } else if (actionData?.success && actionData?.step) {
      setStep(actionData.step);
    }
  }, [actionData, shopify]);

  // Keep step state in sync with URL parameter changes (for routing back/forth)
  useEffect(() => {
    if (stepParam) {
      setStep(stepParam);
    }
  }, [stepParam]);

  // Configuration form states
  const [triggerProduct, setTriggerProduct] = useState(null);
  const [upgradeProduct, setUpgradeProduct] = useState(null);
  const [priceDifference, setPriceDifference] = useState("");

  const [triggerProductPack, setTriggerProductPack] = useState(null);
  const [bundleProduct, setBundleProduct] = useState(null);
  const [priceDifferencePack, setPriceDifferencePack] = useState("");

  // Thank You Settings states
  const [thankYouWidget, setThankYouWidget] = useState(settings?.thankYouWidgetEnabled ?? true);
  const [discountWidget, setDiscountWidget] = useState(settings?.discountWidgetEnabled ?? true);
  const [referralWidget, setReferralWidget] = useState(settings?.referralWidgetEnabled ?? true);
  const [discountCode, setDiscountCode] = useState(settings?.discountCode || "NEXT10");
  const [timerDuration, setTimerDuration] = useState(settings?.timerDuration || 15);
  const [activeSetupTab, setActiveSetupTab] = useState("pre-checkout");

  // Helper to dynamically build selectionIds for pre-selecting variants/products in App Bridge
  const getSelectionIds = (product) => {
    if (!product || !product.id) return [];
    
    // If it's a variant selection
    if (product.id.includes("ProductVariant")) {
      if (product.parentId) {
        return [{
          id: product.parentId,
          variants: [{ id: product.id }]
        }];
      }
      // Return empty if parentId is missing to prevent Shopify locking/freezing checkboxes
      return [];
    }
    
    // If it's a standard product selection
    if (product.id.includes("Product")) {
      return [{ id: product.id }];
    }
    
    return [];
  };

  useEffect(() => {
    if (offer) {
      if (offer.type === "SIZE_UPGRADE") {
        setStep(2);
        setSelectedTemplate("SIZE_UPGRADE");
        setTriggerProduct({
          id: offer.triggerProductId,
          parentId: offer.triggerParentProductId,
          title: (offer.triggerProductTitle || "").replace(" - Default Title", ""),
          image: offer.triggerProductImage,
        });
        setUpgradeProduct({
          id: offer.upgradeProductId,
          parentId: offer.upgradeParentProductId,
          title: (offer.upgradeProductTitle || "").replace(" - Default Title", ""),
          image: offer.upgradeProductImage,
        });
        setPriceDifference(String(offer.priceDifference ?? ""));
      } else if (offer.type === "PACK_UPGRADE") {
        setStep(3);
        setSelectedTemplate("PACK_UPGRADE");
        setTriggerProductPack({
          id: offer.triggerProductId,
          parentId: offer.triggerParentProductId,
          title: (offer.triggerProductTitle || "").replace(" - Default Title", ""),
          image: offer.triggerProductImage,
        });
        setBundleProduct({
          id: offer.upgradeProductId,
          parentId: offer.upgradeParentProductId,
          title: (offer.upgradeProductTitle || "").replace(" - Default Title", ""),
          image: offer.upgradeProductImage,
        });
        setPriceDifferencePack(String(offer.priceDifference ?? ""));
      }
    }
  }, [offer]);

  const handleSaveSizeUpgrade = () => {
    if (!triggerProduct || !upgradeProduct) {
      shopify.toast.show("Please select both base and upgrade products");
      return;
    }
    submit(
      {
        actionType: "SIZE_UPGRADE",
        offerId: offer?.id || "",
        triggerProductId: triggerProduct.id || "mock-trigger-id",
        triggerProductTitle: triggerProduct.title || "Mock Base Product",
        triggerParentProductId: triggerProduct.parentId || "",
        triggerProductImage: triggerProduct.image || "",
        upgradeProductId: upgradeProduct.id || "mock-upgrade-id",
        upgradeProductTitle: upgradeProduct.title || "Mock Upgrade Product",
        upgradeParentProductId: upgradeProduct.parentId || "",
        upgradeProductImage: upgradeProduct.image || "",
        priceDifference: "0.00",
      },
      { method: "POST" }
    );
  };

  const handleSavePackUpgrade = () => {
    if (!triggerProductPack || !bundleProduct) {
      shopify.toast.show("Please select both base and bundle products");
      return;
    }
    submit(
      {
        actionType: "PACK_UPGRADE",
        offerId: offer?.id || "",
        triggerProductId: triggerProductPack.id || "mock-trigger-id",
        triggerProductTitle: triggerProductPack.title || "Mock Base Product",
        triggerParentProductId: triggerProductPack.parentId || "",
        triggerProductImage: triggerProductPack.image || "",
        upgradeProductId: bundleProduct.id || "mock-bundle-id",
        upgradeProductTitle: bundleProduct.title || "Mock Bundle Product",
        upgradeParentProductId: bundleProduct.parentId || "",
        upgradeProductImage: bundleProduct.image || "",
        priceDifference: "0.00",
      },
      { method: "POST" }
    );
  };

  const handleSaveThankYouSettings = () => {
    submit(
      {
        actionType: "THANK_YOU_SETTINGS",
        thankYouWidgetEnabled: String(thankYouWidget),
        referralWidgetEnabled: String(referralWidget),
        discountWidgetEnabled: String(discountWidget),
        discountCode,
        timerDuration: String(timerDuration),
      },
      { method: "POST" }
    );
  };

  // Resource Pickers using Shopify App Bridge v4
  const handleSelectTriggerProduct = async () => {
    try {
      const selectionIds = getSelectionIds(triggerProduct);
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: false,
        selectionIds,
      });
      if (selected && selected.length > 0) {
        const product = selected[0];
        if (product.variants && product.variants.length > 1) {
          shopify.toast.show("Please select only one variant. Using the first selection.", { isError: true });
        }
        const variant = product.variants?.[0];
        const imgUrl = variant?.image?.originalSrc || variant?.image?.src || product.images?.[0]?.originalSrc || product.images?.[0]?.src || "";
        setTriggerProduct({
          id: variant?.id || product.id,
          parentId: product.id,
          title: variant && variant.title && variant.title !== "Default Title"
            ? `${product.title} - ${variant.title}`
            : product.title,
          image: imgUrl,
        });
      }
    } catch (e) {
      console.error(e);
      setTriggerProduct({ id: "gid://shopify/Product/mock-base", title: "Sample Base Product (S)", image: "" });
    }
  };

  const handleSelectUpgradeProduct = async () => {
    try {
      const selectionIds = getSelectionIds(upgradeProduct);
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: false,
        selectionIds,
      });
      if (selected && selected.length > 0) {
        const product = selected[0];
        if (product.variants && product.variants.length > 1) {
          shopify.toast.show("Please select only one variant. Using the first selection.", { isError: true });
        }
        const variant = product.variants?.[0];
        const imgUrl = variant?.image?.originalSrc || variant?.image?.src || product.images?.[0]?.originalSrc || product.images?.[0]?.src || "";
        setUpgradeProduct({
          id: variant?.id || product.id,
          parentId: product.id,
          title: variant && variant.title && variant.title !== "Default Title"
            ? `${product.title} - ${variant.title}`
            : product.title,
          image: imgUrl,
        });
      }
    } catch (e) {
      console.error(e);
      setUpgradeProduct({ id: "gid://shopify/Product/mock-upgrade", title: "Sample Upgrade Product (L)", image: "" });
    }
  };

  const handleSelectTriggerProductPack = async () => {
    try {
      const selectionIds = getSelectionIds(triggerProductPack);
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: false,
        selectionIds,
      });
      if (selected && selected.length > 0) {
        const product = selected[0];
        if (product.variants && product.variants.length > 1) {
          shopify.toast.show("Please select only one variant. Using the first selection.", { isError: true });
        }
        const variant = product.variants?.[0];
        const imgUrl = variant?.image?.originalSrc || variant?.image?.src || product.images?.[0]?.originalSrc || product.images?.[0]?.src || "";
        setTriggerProductPack({
          id: variant?.id || product.id,
          parentId: product.id,
          title: variant && variant.title && variant.title !== "Default Title"
            ? `${product.title} - ${variant.title}`
            : product.title,
          image: imgUrl,
        });
      }
    } catch (e) {
      console.error(e);
      setTriggerProductPack({ id: "gid://shopify/Product/mock-base-pack", title: "Sample Base Product Pack", image: "" });
    }
  };

  const handleSelectBundleProduct = async () => {
    try {
      const selectionIds = getSelectionIds(bundleProduct);
      const selected = await shopify.resourcePicker({
        type: "product",
        multiple: false,
        selectionIds,
      });
      if (selected && selected.length > 0) {
        const product = selected[0];
        if (product.variants && product.variants.length > 1) {
          shopify.toast.show("Please select only one variant. Using the first selection.", { isError: true });
        }
        const variant = product.variants?.[0];
        const imgUrl = variant?.image?.originalSrc || variant?.image?.src || product.images?.[0]?.originalSrc || product.images?.[0]?.src || "";
        setBundleProduct({
          id: variant?.id || product.id,
          parentId: product.id,
          title: variant && variant.title && variant.title !== "Default Title"
            ? `${product.title} - ${variant.title}`
            : product.title,
          image: imgUrl,
        });
      }
    } catch (e) {
      console.error(e);
      setBundleProduct({ id: "gid://shopify/Product/mock-bundle", title: "Sample Bundle Product (3-Pack)", image: "" });
    }
  };

  return (
    <div
      style={{
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        backgroundColor: "#f1f1f1",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        color: "#202223",
      }}
    >
      {/* Main Content Area */}
      <main
        style={{
          flex: 1,
          maxWidth: "960px",
          width: "100%",
          margin: "0 auto",
          padding: "16px 24px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        
        {/* STEP 1: Template Selection */}
        {step === 1 && (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
            {/* Page Headings */}
            <div style={{ textAlign: "center", marginBottom: "40px", maxWidth: "600px" }}>
              <h1
                style={{
                  fontSize: "28px",
                  fontWeight: "700",
                  margin: "0 0 12px 0",
                  color: "#202223",
                  letterSpacing: "-0.02em",
                }}
              >
                Create Your First Upsell Offer
              </h1>
              <p style={{ fontSize: "15px", color: "#6d7175", margin: 0, lineHeight: "1.5" }}>
                Select a template to get started. You can customize everything or change this later.
              </p>
            </div>

            {/* Template Cards Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                gap: "24px",
                width: "100%",
                maxWidth: "800px",
                marginBottom: "32px",
              }}
            >
              {/* Size Upgrade Template Card */}
              <div
                onClick={() => {
                  setStep(2); // Instantly open page 2 on click
                }}
                style={{
                  backgroundColor: "#ffffff",
                  border: "2px solid #dfe3e8",
                  borderRadius: "12px",
                  padding: "28px",
                  cursor: "pointer",
                  position: "relative",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
                  transition: "all 0.2s ease-in-out",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.border = "2px solid #5c6ac4";
                  e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.06)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.border = "2px solid #dfe3e8";
                  e.currentTarget.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.04)";
                }}
              >
                {/* Custom Icon Box (Size Upgrade) */}
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    backgroundColor: "#f1f2fa",
                    borderRadius: "10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "20px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-end", gap: "6px" }}>
                    <div
                      style={{
                        width: "8px",
                        height: "18px",
                        backgroundColor: "#b5bce8",
                        borderRadius: "2px 2px 1px 1px",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          width: "4px",
                          height: "3px",
                          backgroundColor: "#5c6ac4",
                          position: "absolute",
                          top: "-3px",
                          left: "2px",
                          borderRadius: "1px",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        width: "12px",
                        height: "26px",
                        backgroundColor: "#5c6ac4",
                        borderRadius: "3px 3px 2px 2px",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          width: "6px",
                          height: "4px",
                          backgroundColor: "#000639",
                          position: "absolute",
                          top: "-4px",
                          left: "3px",
                          borderRadius: "1px",
                        }}
                      />
                    </div>
                  </div>
                </div>

                <h3 style={{ fontSize: "18px", fontWeight: "600", margin: "0 0 10px 0", color: "#202223" }}>
                  Size Upgrade
                </h3>
                <p style={{ fontSize: "14px", color: "#6d7175", margin: 0, lineHeight: "1.5" }}>
                  Swap a single item for a larger size the highest-converting upsell type for consumable products.
                </p>
              </div>

              {/* Pack Upgrade Template Card */}
              <div
                onClick={() => {
                  setStep(3); // Open page 3 for Pack Upgrade config
                }}
                style={{
                  backgroundColor: "#ffffff",
                  border: "2px solid #dfe3e8",
                  borderRadius: "12px",
                  padding: "28px",
                  cursor: "pointer",
                  position: "relative",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
                  transition: "all 0.2s ease-in-out",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.border = "2px solid #5c6ac4";
                  e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.06)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.border = "2px solid #dfe3e8";
                  e.currentTarget.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.04)";
                }}
              >
                {/* Custom Icon Box (Pack Upgrade) */}
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    backgroundColor: "#fff4e5",
                    borderRadius: "10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "20px",
                  }}
                >
                  <div style={{ position: "relative", width: "24px", height: "22px" }}>
                    <div
                      style={{
                        position: "absolute",
                        bottom: "6px",
                        left: "0",
                        width: "10px",
                        height: "10px",
                        backgroundColor: "#e09f53",
                        borderRadius: "1.5px",
                        border: "1px solid #fff",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        bottom: "6px",
                        right: "0",
                        width: "10px",
                        height: "10px",
                        backgroundColor: "#e09f53",
                        borderRadius: "1.5px",
                        border: "1px solid #fff",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        bottom: "0",
                        left: "6px",
                        width: "12px",
                        height: "12px",
                        backgroundColor: "#d57e2a",
                        borderRadius: "2px",
                        border: "1px solid #fff",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                      }}
                    />
                  </div>
                </div>

                <h3 style={{ fontSize: "18px", fontWeight: "600", margin: "0 0 10px 0", color: "#202223" }}>
                  Pack Upgrade
                </h3>
                <p style={{ fontSize: "14px", color: "#6d7175", margin: 0, lineHeight: "1.5" }}>
                  Swap a single item for a discounted multi-pack great for increasing purchase frequency.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Configure Size Upgrade */}
        {step === 2 && (
          <div
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #dfe3e8",
              borderRadius: "12px",
              width: "100%",
              maxWidth: "720px",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #e1e3e5",
              }}
            >
              <h2 style={{ fontSize: "20px", fontWeight: "700", margin: 0, color: "#202223" }}>
                Configure Your Size Upgrade
              </h2>
            </div>

            {actionData?.error && (
              <div
                style={{
                  margin: "16px 24px 0 24px",
                  padding: "12px 16px",
                  backgroundColor: "#fff0f0",
                  border: "1px solid #ffc1c1",
                  borderRadius: "8px",
                  color: "#d32f2f",
                  fontSize: "14px",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span>⚠️</span>
                <span>{actionData.error}</span>
              </div>
            )}

            {/* Body */}
            <div style={{ padding: "28px 24px", display: "flex", flexDirection: "column", gap: "24px" }}>
              
              {/* Trigger Product Section */}
              <div>
                <label style={{ display: "block", fontSize: "14px", fontWeight: "600", margin: "0 0 6px 0", color: "#202223" }}>
                  When a customer buys...
                </label>
                <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "12px" }}>
                  Choose the trigger product for this upsell offer.
                </div>
                
                {triggerProduct ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 16px",
                      border: "1px solid #5c6ac4",
                      borderRadius: "8px",
                      backgroundColor: "#f4f5fa",
                    }}
                  >
                    <span style={{ fontSize: "14px", fontWeight: "600" }}>{triggerProduct.title}</span>
                    <button
                      onClick={handleSelectTriggerProduct}
                      style={{
                        backgroundColor: "transparent",
                        border: "none",
                        color: "#5c6ac4",
                        fontWeight: "600",
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleSelectTriggerProduct}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      width: "100%",
                      padding: "12px",
                      backgroundColor: "#ffffff",
                      border: "1.5px dashed #b5bce8",
                      borderRadius: "8px",
                      color: "#5c6ac4",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "background-color 0.2s",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
                  >
                    <span style={{ fontSize: "16px", fontWeight: "bold" }}>+</span> Select Product
                  </button>
                )}
              </div>

              {/* Upgrade Product Section */}
              <div>
                <label style={{ display: "block", fontSize: "14px", fontWeight: "600", margin: "0 0 6px 0", color: "#202223" }}>
                  Offer to swap it with...
                </label>
                <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "12px" }}>
                  Choose the upgrade product you want to offer.
                </div>

                {upgradeProduct ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 16px",
                      border: "1px solid #5c6ac4",
                      borderRadius: "8px",
                      backgroundColor: "#f4f5fa",
                    }}
                  >
                    <span style={{ fontSize: "14px", fontWeight: "600" }}>{upgradeProduct.title}</span>
                    <button
                      onClick={handleSelectUpgradeProduct}
                      style={{
                        backgroundColor: "transparent",
                        border: "none",
                        color: "#5c6ac4",
                        fontWeight: "600",
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleSelectUpgradeProduct}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      width: "100%",
                      padding: "12px",
                      backgroundColor: "#ffffff",
                      border: "1.5px dashed #b5bce8",
                      borderRadius: "8px",
                      color: "#5c6ac4",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "background-color 0.2s",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
                  >
                    <span style={{ fontSize: "16px", fontWeight: "bold" }}>+</span> Select Product
                  </button>
                )}
              </div>

              </div>

            {/* Footer */}
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e1e3e5",
                backgroundColor: "#f9fafb",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <button
                onClick={() => setStep(1)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 18px",
                  backgroundColor: "#ffffff",
                  border: "1px solid #babfc3",
                  borderRadius: "8px",
                  color: "#202223",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "background-color 0.2s",
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f6f6f7")}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
              >
                ← Back
              </button>

              <button
                onClick={handleSaveSizeUpgrade}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 20px",
                  backgroundColor: "#3630a3", // Deep premium violet-blue
                  border: "none",
                  borderRadius: "8px",
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "background-color 0.2s",
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#241f7a")}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#3630a3")}
              >
                Save & Continue →
              </button>
            </div>

          </div>
        )}

        {/* STEP 3: Configure Pack Upgrade */}
        {step === 3 && (
          <div
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #dfe3e8",
              borderRadius: "12px",
              width: "100%",
              maxWidth: "720px",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #e1e3e5",
              }}
            >
              <h2 style={{ fontSize: "20px", fontWeight: "700", margin: 0, color: "#202223" }}>
                Configure Pack Upgrade
              </h2>
              <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "6px" }}>
                Define which products trigger this offer, the bundle SKU, and your pricing.
              </div>
            </div>

            {actionData?.error && (
              <div
                style={{
                  margin: "16px 24px 0 24px",
                  padding: "12px 16px",
                  backgroundColor: "#fff0f0",
                  border: "1px solid #ffc1c1",
                  borderRadius: "8px",
                  color: "#d32f2f",
                  fontSize: "14px",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span>⚠️</span>
                <span>{actionData.error}</span>
              </div>
            )}

            {/* Body */}
            <div style={{ padding: "28px 24px", display: "flex", flexDirection: "column", gap: "24px" }}>
              
              {/* Trigger Product Section */}
              <div>
                <label style={{ display: "block", fontSize: "14px", fontWeight: "600", margin: "0 0 6px 0", color: "#202223" }}>
                  When a customer buys 1 unit of...
                </label>
                <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "12px" }}>
                  Choose the trigger product for this upsell offer.
                </div>
                
                {triggerProductPack ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 16px",
                      border: "1px solid #5c6ac4",
                      borderRadius: "8px",
                      backgroundColor: "#f4f5fa",
                    }}
                  >
                    <span style={{ fontSize: "14px", fontWeight: "600" }}>{triggerProductPack.title}</span>
                    <button
                      onClick={handleSelectTriggerProductPack}
                      style={{
                        backgroundColor: "transparent",
                        border: "none",
                        color: "#5c6ac4",
                        fontWeight: "600",
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleSelectTriggerProductPack}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      width: "100%",
                      padding: "12px",
                      backgroundColor: "#ffffff",
                      border: "1.5px dashed #b5bce8",
                      borderRadius: "8px",
                      color: "#5c6ac4",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "background-color 0.2s",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
                  >
                    <span style={{ fontSize: "16px", fontWeight: "bold" }}>+</span> Select Product
                  </button>
                )}
              </div>

              {/* Upgrade Product Section */}
              <div>
                <label style={{ display: "block", fontSize: "14px", fontWeight: "600", margin: "0 0 6px 0", color: "#202223" }}>
                  Offer to upgrade their order to...
                </label>
                <div style={{ fontSize: "13px", color: "#6d7175", marginBottom: "12px" }}>
                  Choose the upgrade product you want to offer.
                </div>

                {bundleProduct ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 16px",
                      border: "1px solid #5c6ac4",
                      borderRadius: "8px",
                      backgroundColor: "#f4f5fa",
                    }}
                  >
                    <span style={{ fontSize: "14px", fontWeight: "600" }}>{bundleProduct.title}</span>
                    <button
                      onClick={handleSelectBundleProduct}
                      style={{
                        backgroundColor: "transparent",
                        border: "none",
                        color: "#5c6ac4",
                        fontWeight: "600",
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleSelectBundleProduct}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      width: "100%",
                      padding: "12px",
                      backgroundColor: "#ffffff",
                      border: "1.5px dashed #b5bce8",
                      borderRadius: "8px",
                      color: "#5c6ac4",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "background-color 0.2s",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
                  >
                    <span style={{ fontSize: "16px", fontWeight: "bold" }}>+</span> Select Bundle Product
                  </button>
                )}
                <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "8px", fontStyle: "italic" }}>
                  Select the 3-pack or bundle SKU from your Shopify inventory.
                </div>
              </div>

              </div>

            {/* Footer */}
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e1e3e5",
                backgroundColor: "#f9fafb",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <button
                onClick={() => setStep(1)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 18px",
                  backgroundColor: "#ffffff",
                  border: "1px solid #babfc3",
                  borderRadius: "8px",
                  color: "#202223",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "background-color 0.2s",
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#f6f6f7")}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#ffffff")}
              >
                ← Back
              </button>

              <button
                onClick={handleSavePackUpgrade}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 20px",
                  backgroundColor: "#3630a3",
                  border: "none",
                  borderRadius: "8px",
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "background-color 0.2s",
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#241f7a")}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#3630a3")}
              >
                Save & Continue →
              </button>
            </div>

          </div>
        )}

        {/* STEP 4: Thank You Page Settings */}
        {step === 4 && (
          <div
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #dfe3e8",
              borderRadius: "12px",
              width: "100%",
              maxWidth: "720px",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.03)",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #e1e3e5",
              }}
            >
              <h2 style={{ fontSize: "20px", fontWeight: "700", margin: 0, color: "#202223" }}>
                Supercharge your Thank You Page
              </h2>
              <div style={{ fontSize: "13px", color: "#6d7175", marginTop: "6px" }}>
                Turn your order confirmation page into a retention engine all with a single toggle.
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: "28px 24px", display: "flex", flexDirection: "column", gap: "24px" }}>
              
              {/* Card 1: Cross-Sell */}
              <div
                style={{
                  border: "1px solid #e3e8ee",
                  borderRadius: "12px",
                  padding: "24px",
                  boxShadow: "0 2px 5px rgba(0, 0, 0, 0.01)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  backgroundColor: "#ffffff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "18px" }}>🛍️</span>
                    <span style={{ fontWeight: "600", fontSize: "15px", color: "#1a1f36" }}>
                      Enable Cross-Sell Recommendations
                    </span>
                  </div>
                  {/* Inline Toggle Switch */}
                  <div
                    onClick={() => setThankYouWidget(!thankYouWidget)}
                    style={{
                      width: "48px",
                      height: "26px",
                      borderRadius: "13px",
                      backgroundColor: thankYouWidget ? "#3b36ac" : "#d1d5db",
                      position: "relative",
                      cursor: "pointer",
                      transition: "background-color 0.2s",
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        backgroundColor: "#ffffff",
                        position: "absolute",
                        top: "3px",
                        left: thankYouWidget ? "25px" : "3px",
                        transition: "left 0.2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                      }}
                    />
                  </div>
                </div>
                <div style={{ fontSize: "13px", color: "#697386", paddingLeft: "28px", marginBottom: thankYouWidget ? "8px" : 0 }}>
                  Automatically show 3 random products from the store's inventory.
                </div>

                {thankYouWidget && (
                  <div style={{ paddingLeft: "28px", borderTop: "1px solid #f4f6f8", paddingTop: "16px" }}>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f566b", marginBottom: "8px" }}>
                      Offer Expiration Time (in minutes)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="120"
                      value={timerDuration}
                      onChange={(e) => setTimerDuration(parseInt(e.target.value, 10) || 15)}
                      placeholder="Enter expiration time (e.g. 15)"
                      style={{
                        boxSizing: "border-box",
                        width: "100%",
                        padding: "12px 16px",
                        fontSize: "14px",
                        borderRadius: "8px",
                        border: "1px solid #d9e1ec",
                        outline: "none",
                        transition: "border-color 0.2s",
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Card 2: Next-Order Reward */}
              <div
                style={{
                  border: "1px solid #e3e8ee",
                  borderRadius: "12px",
                  padding: "24px",
                  boxShadow: "0 2px 5px rgba(0, 0, 0, 0.01)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  backgroundColor: "#ffffff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "18px" }}>🎁</span>
                    <span style={{ fontWeight: "600", fontSize: "15px", color: "#1a1f36" }}>
                      Enable Next-Order Reward
                    </span>
                  </div>
                  {/* Inline Toggle Switch */}
                  <div
                    onClick={() => setDiscountWidget(!discountWidget)}
                    style={{
                      width: "48px",
                      height: "26px",
                      borderRadius: "13px",
                      backgroundColor: discountWidget ? "#3b36ac" : "#d1d5db",
                      position: "relative",
                      cursor: "pointer",
                      transition: "background-color 0.2s",
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        backgroundColor: "#ffffff",
                        position: "absolute",
                        top: "3px",
                        left: discountWidget ? "25px" : "3px",
                        transition: "left 0.2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                      }}
                    />
                  </div>
                </div>
                <div style={{ fontSize: "13px", color: "#697386", paddingLeft: "28px", marginBottom: discountWidget ? "8px" : 0 }}>
                  Show a discount code on the confirmation page to incentivise a second purchase.
                </div>

                {discountWidget && (
                  <div style={{ paddingLeft: "28px", borderTop: "1px solid #f4f6f8", paddingTop: "16px" }}>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#4f566b", marginBottom: "8px" }}>
                      Discount Code
                    </label>
                    <input
                      type="text"
                      value={discountCode}
                      onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                      placeholder="Enter discount code (e.g. THANKYOU15)"
                      style={{
                        boxSizing: "border-box",
                        width: "100%",
                        padding: "12px 16px",
                        fontSize: "14px",
                        borderRadius: "8px",
                        border: "1px solid #d9e1ec",
                        outline: "none",
                        transition: "border-color 0.2s",
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Card 3: WhatsApp Referral */}
              <div
                style={{
                  border: "1px solid #e3e8ee",
                  borderRadius: "12px",
                  padding: "24px",
                  boxShadow: "0 2px 5px rgba(0, 0, 0, 0.01)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  backgroundColor: "#ffffff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "18px" }}>💬</span>
                    <span style={{ fontWeight: "600", fontSize: "15px", color: "#1a1f36" }}>
                      Enable WhatsApp Referral Link
                    </span>
                  </div>
                  {/* Inline Toggle Switch */}
                  <div
                    onClick={() => setReferralWidget(!referralWidget)}
                    style={{
                      width: "48px",
                      height: "26px",
                      borderRadius: "13px",
                      backgroundColor: referralWidget ? "#3b36ac" : "#d1d5db",
                      position: "relative",
                      cursor: "pointer",
                      transition: "background-color 0.2s",
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        backgroundColor: "#ffffff",
                        position: "absolute",
                        top: "3px",
                        left: referralWidget ? "25px" : "3px",
                        transition: "left 0.2s",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                      }}
                    />
                  </div>
                </div>
                <div style={{ fontSize: "13px", color: "#697386", paddingLeft: "28px" }}>
                  Allow customers to share your store with friends via a pre-filled WhatsApp message — word-of-mouth at zero cost.
                </div>
              </div>

            </div>

            {/* Footer */}
            <div
              style={{
                padding: "16px 24px",
                borderTop: "1px solid #e1e3e5",
                backgroundColor: "#f9fafb",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <button
                onClick={() => setStep(selectedTemplate === "SIZE_UPGRADE" ? 2 : 3)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 18px",
                  backgroundColor: "#ffffff",
                  border: "1px solid #babfc3",
                  borderRadius: "8px",
                  color: "#202223",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "background-color 0.2s",
                }}
              >
                ← Back
              </button>

              <button
                onClick={handleSaveThankYouSettings}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 20px",
                  backgroundColor: "#3630a3",
                  border: "none",
                  borderRadius: "8px",
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "background-color 0.2s",
                }}
              >
                Save & Continue →
              </button>
            </div>

          </div>
        )}

        {/* STEP 5: Almost Live */}
        {step === 5 && (
          <div
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #dfe3e8",
              borderRadius: "16px",
              width: "100%",
              maxWidth: "580px",
              padding: "48px 40px",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.04)",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            {/* Success Graphic Accent */}
            <div style={{ position: "relative", width: "80px", height: "80px", marginBottom: "28px" }}>
              <div style={{ position: "absolute", top: "10px", left: "12px", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#f59e0b" }} />
              <div style={{ position: "absolute", top: "4px", right: "20px", width: "5px", height: "5px", borderRadius: "50%", backgroundColor: "#3b82f6" }} />
              <div style={{ position: "absolute", bottom: "16px", left: "8px", width: "5px", height: "5px", borderRadius: "50%", backgroundColor: "#ef4444" }} />
              <div style={{ position: "absolute", bottom: "10px", right: "12px", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#10b981" }} />
              
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  backgroundColor: "#eceefb",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 10px rgba(79, 70, 229, 0.1)",
                }}
              >
                <div
                  style={{
                    width: "56px",
                    height: "56px",
                    backgroundColor: "#3630a3",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M5 12L10 17L20 7"
                      stroke="#ffffff"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
            </div>

            {/* Title */}
            <h1
              style={{
                fontSize: "26px",
                fontWeight: "700",
                margin: "0 0 16px 0",
                color: "#1a1f36",
                letterSpacing: "-0.02em",
              }}
            >
              You're Almost Live! 🚀
            </h1>

            {/* Subtitle */}
            <p
              style={{
                fontSize: "14px",
                color: "#697386",
                lineHeight: "1.5",
                margin: "0 0 24px 0",
              }}
            >
              Your configuration is saved and ready. To show it to real customers, you must add and enable the app blocks inside your Shopify settings.
            </p>

            {/* Tab Selector */}
            <div
              style={{
                display: "flex",
                backgroundColor: "#f4f6f8",
                border: "1px solid #e3e8ee",
                borderRadius: "8px",
                padding: "4px",
                width: "100%",
                boxSizing: "border-box",
                marginBottom: "24px",
              }}
            >
              <button
                onClick={() => setActiveSetupTab("pre-checkout")}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: activeSetupTab === "pre-checkout" ? "#ffffff" : "transparent",
                  color: activeSetupTab === "pre-checkout" ? "#3630a3" : "#697386",
                  fontWeight: "600",
                  fontSize: "13px",
                  cursor: "pointer",
                  boxShadow: activeSetupTab === "pre-checkout" ? "0 1px 3px rgba(0, 0, 0, 0.08)" : "none",
                  transition: "all 0.2s",
                }}
              >
                🛒 Pre-Checkout Swaps
              </button>
              <button
                onClick={() => setActiveSetupTab("thank-you")}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: activeSetupTab === "thank-you" ? "#ffffff" : "transparent",
                  color: activeSetupTab === "thank-you" ? "#3630a3" : "#697386",
                  fontWeight: "600",
                  fontSize: "13px",
                  cursor: "pointer",
                  boxShadow: activeSetupTab === "thank-you" ? "0 1px 3px rgba(0, 0, 0, 0.08)" : "none",
                  transition: "all 0.2s",
                }}
              >
                🛍️ Thank You Page Widgets
              </button>
            </div>

            {/* Pre-Checkout Swaps Guide */}
            {activeSetupTab === "pre-checkout" && (
              <div
                style={{
                  width: "100%",
                  backgroundColor: "#f9fafb",
                  border: "1px solid #e3e8ee",
                  borderRadius: "12px",
                  padding: "24px",
                  boxSizing: "border-box",
                  textAlign: "left",
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                  marginBottom: "32px",
                }}
              >
                <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      backgroundColor: "#3630a3",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: "700",
                      flexShrink: 0,
                      marginTop: "2px",
                    }}
                  >
                    1
                  </div>
                  <div>
                    <h4 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: "600", color: "#1a1f36" }}>
                      Open Online Store Theme Editor
                    </h4>
                    <p style={{ margin: 0, fontSize: "13px", color: "#697386", lineHeight: "1.4" }}>
                      Click the button below to open your Online Store Customizer. You will land on the **Home page** by default.
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      backgroundColor: "#3630a3",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: "700",
                      flexShrink: 0,
                      marginTop: "2px",
                    }}
                  >
                    2
                  </div>
                  <div>
                    <h4 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: "600", color: "#1a1f36" }}>
                      Open Product Template
                    </h4>
                    <p style={{ margin: 0, fontSize: "13px", color: "#697386", lineHeight: "1.4" }}>
                      Select the **Products** template from the dropdown menu at the top of the editor page.
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      backgroundColor: "#3630a3",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: "700",
                      flexShrink: 0,
                      marginTop: "2px",
                    }}
                  >
                    3
                  </div>
                  <div>
                    <h4 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: "600", color: "#1a1f36" }}>
                      Add "pre-checkout-upsell" Block
                    </h4>
                    <p style={{ margin: 0, fontSize: "13px", color: "#697386", lineHeight: "1.4" }}>
                      Click **"Add block"** on the product page sections list, select **"pre-checkout-upsell"** under Apps, drag it below the buy buttons, and click **"Save"**.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Thank You Page Guide */}
            {activeSetupTab === "thank-you" && (
              <div
                style={{
                  width: "100%",
                  backgroundColor: "#f9fafb",
                  border: "1px solid #e3e8ee",
                  borderRadius: "12px",
                  padding: "24px",
                  boxSizing: "border-box",
                  textAlign: "left",
                  display: "flex",
                  flexDirection: "column",
                  gap: "20px",
                  marginBottom: "32px",
                }}
              >
                <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      backgroundColor: "#3630a3",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: "700",
                      flexShrink: 0,
                      marginTop: "2px",
                    }}
                  >
                    1
                  </div>
                  <div>
                    <h4 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: "600", color: "#1a1f36" }}>
                      Open Shopify Theme Editor
                    </h4>
                    <p style={{ margin: 0, fontSize: "13px", color: "#697386", lineHeight: "1.4" }}>
                      Click the button below to open your Shopify editor. You will land on the **Home page** by default.
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      backgroundColor: "#3630a3",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: "700",
                      flexShrink: 0,
                      marginTop: "2px",
                    }}
                  >
                    2
                  </div>
                  <div>
                    <h4 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: "600", color: "#1a1f36" }}>
                      Select Checkout & Customer Accounts
                    </h4>
                    <p style={{ margin: 0, fontSize: "13px", color: "#697386", lineHeight: "1.4" }}>
                      Click the page dropdown menu at the top of the editor and select **"Checkout and customer accounts"**.
                    </p>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      backgroundColor: "#3630a3",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: "700",
                      flexShrink: 0,
                      marginTop: "2px",
                    }}
                  >
                    3
                  </div>
                  <div>
                    <h4 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: "600", color: "#1a1f36" }}>
                      Enable on Thank You & Order Status Pages
                    </h4>
                    <p style={{ margin: 0, fontSize: "13px", color: "#697386", lineHeight: "1.4" }}>
                      Switch the editor page to **"Thank you"**, click **"Add app block"** and select **"thank-you-upsell"**. Then switch the page to **"Order status"** and add the block there too. Click **"Save"**.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* CTA Button */}
            <a
              href={`https://${shop}/admin/themes/current/editor`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                boxSizing: "border-box",
                width: "100%",
                padding: "16px 24px",
                backgroundColor: "#3630a3",
                color: "#ffffff",
                borderRadius: "10px",
                fontSize: "15px",
                fontWeight: "600",
                textDecoration: "none",
                boxShadow: "0 4px 12px rgba(54, 48, 163, 0.25)",
                transition: "all 0.2s ease-in-out",
                display: "inline-block",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = "#241f7a";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = "#3630a3";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              Configure in Theme Settings
            </a>
          </div>
        )}

      </main>
    </div>
  );
}

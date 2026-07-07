import { useState } from "react";
import { useLoaderData, useSubmit, useNavigation, useNavigate, redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { syncSettingsToMetafield } from "../lib/syncMetafield";
import db from "../db.server";

// Loader to fetch current settings
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let settings = await db.upsellSettings.findUnique({
    where: { shop },
  });

  if (!settings) {
    settings = await db.upsellSettings.create({
      data: { shop },
    });
  }

  return { settings };
};

// Action to save settings
export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const thankYouWidgetEnabled = formData.get("thankYouWidgetEnabled") === "true";
  const referralWidgetEnabled = formData.get("referralWidgetEnabled") === "true";
  const discountWidgetEnabled = formData.get("discountWidgetEnabled") === "true";
  const discountCode = formData.get("discountCode") || "";
  const timerDuration = parseInt(formData.get("timerDuration") || "15", 10);

  await db.upsellSettings.upsert({
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

  // Sync to shop metafields so checkout UI extensions can read them instantly
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || new URL(request.url).host;
  let appUrl = `${proto}://${host}`;
  if (appUrl.startsWith("http://")) {
    appUrl = appUrl.replace("http://", "https://");
  }
  await syncSettingsToMetafield(admin, shop, db, appUrl);

  return redirect("/app/almost-live");
};

export default function ThankYouSettings() {
  const { settings } = useLoaderData();
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();

  // Local state matching the UI switches
  const [thankYouWidget, setThankYouWidget] = useState(settings.thankYouWidgetEnabled);
  const [discountWidget, setDiscountWidget] = useState(settings.discountWidgetEnabled);
  const [referralWidget, setReferralWidget] = useState(settings.referralWidgetEnabled);
  const [discountCode, setDiscountCode] = useState(settings.discountCode || "");
  const [timerDuration, setTimerDuration] = useState(settings.timerDuration || 15);

  const isSaving = navigation.state === "submitting";

  const handleSave = () => {
    submit(
      {
        thankYouWidgetEnabled: String(thankYouWidget),
        referralWidgetEnabled: String(referralWidget),
        discountWidgetEnabled: String(discountWidget),
        discountCode,
        timerDuration: String(timerDuration),
      },
      { method: "POST" }
    );
  };

  // Custom Toggle Switch Component
  const ToggleSwitch = ({ checked, onChange }) => (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: "48px",
        height: "26px",
        borderRadius: "13px",
        backgroundColor: checked ? "#3b36ac" : "#d1d5db",
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
          left: checked ? "25px" : "3px",
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        }}
      />
    </div>
  );

  return (
    <div
      style={{
        padding: "16px 24px",
        maxWidth: "800px",
        margin: "0 auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#202223",
        backgroundColor: "transparent",
        minHeight: "100vh",
      }}
    >
      {/* Title Header */}
      <div style={{ marginBottom: "36px" }}>
        <h1
          style={{
            margin: 0,
            fontSize: "28px",
            fontWeight: "700",
            color: "#1a1f36",
            letterSpacing: "-0.02em",
            marginBottom: "8px",
          }}
        >
          Supercharge your Thank You Page
        </h1>
        <p style={{ margin: 0, fontSize: "15px", color: "#697386", lineHeight: "1.5" }}>
          Turn your order confirmation page into a retention engine all with a single toggle.
        </p>
      </div>

      {/* Cards list container */}
      <div style={{ display: "flex", flexDirection: "column", gap: "24px", marginBottom: "40px" }}>
        
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
            <ToggleSwitch checked={thankYouWidget} onChange={setThankYouWidget} />
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
                onFocus={(e) => (e.currentTarget.style.borderColor = "#3b36ac")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#d9e1ec")}
              />
              <p style={{ margin: "6px 0 0 0", fontSize: "12px", color: "#697386" }}>
                The dynamic countdown will start from the moment the customer purchases. Recommended: 10 to 15 minutes.
              </p>
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
            <ToggleSwitch checked={discountWidget} onChange={setDiscountWidget} />
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
                onFocus={(e) => (e.currentTarget.style.borderColor = "#3b36ac")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "#d9e1ec")}
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
            <ToggleSwitch checked={referralWidget} onChange={setReferralWidget} />
          </div>
          <div style={{ fontSize: "13px", color: "#697386", paddingLeft: "28px" }}>
            Allow customers to share your store with friends via a pre-filled WhatsApp message — word-of-mouth at zero cost.
          </div>
        </div>

      </div>

      {/* Footer action buttons */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #e3e8ee", paddingTop: "24px" }}>
        <button
          onClick={() => navigate("/app")}
          style={{
            padding: "12px 24px",
            backgroundColor: "#ffffff",
            color: "#4f566b",
            border: "1px solid #d9e1ec",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: "600",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = "#f4f6f8";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = "#ffffff";
          }}
        >
          ← Back
        </button>

        <button
          onClick={handleSave}
          disabled={isSaving}
          style={{
            padding: "12px 28px",
            backgroundColor: "#3b36ac",
            color: "#ffffff",
            border: "none",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: "600",
            cursor: isSaving ? "not-allowed" : "pointer",
            boxShadow: "0 2px 4px rgba(59, 54, 172, 0.2)",
            transition: "all 0.2s",
          }}
          onMouseOver={(e) => {
            if (!isSaving) e.currentTarget.style.backgroundColor = "#241f7a";
          }}
          onMouseOut={(e) => {
            if (!isSaving) e.currentTarget.style.backgroundColor = "#3b36ac";
          }}
        >
          {isSaving ? "Saving..." : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
}

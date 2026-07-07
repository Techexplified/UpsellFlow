import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  return { shop };
};

export default function AlmostLivePage() {
  const { shop } = useLoaderData();

  // URL to Shopify Checkout editor context
  const customizeUrl = `https://${shop}/admin/themes/current/editor?context=checkout`;

  return (
    <div
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        backgroundColor: "#f4f6f8",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        boxSizing: "border-box",
      }}
    >
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
          {/* Confetti dots */}
          <div style={{ position: "absolute", top: "10px", left: "12px", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#f59e0b" }} />
          <div style={{ position: "absolute", top: "4px", right: "20px", width: "5px", height: "5px", borderRadius: "50%", backgroundColor: "#3b82f6" }} />
          <div style={{ position: "absolute", bottom: "16px", left: "8px", width: "5px", height: "5px", borderRadius: "50%", backgroundColor: "#ef4444" }} />
          <div style={{ position: "absolute", bottom: "10px", right: "12px", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#10b981" }} />
          
          {/* Main Circle */}
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
            margin: "0 0 32px 0",
          }}
        >
          Your offer is saved and ready. To show it to real customers, you{" "}
          <strong style={{ color: "#1a1f36", fontWeight: "600" }}>must enable the app block</strong> inside your Shopify Checkout settings it only takes 30 seconds.
        </p>

        {/* Steps Box */}
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
          {/* Step 1 */}
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
                Open Shopify Checkout Settings
              </h4>
              <p style={{ margin: 0, fontSize: "13px", color: "#697386", lineHeight: "1.4" }}>
                Click the button below it opens your Shopify admin in a new tab.
              </p>
            </div>
          </div>

          {/* Step 2 */}
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
                Enable "Upsell Studio" App Block
              </h4>
              <p style={{ margin: 0, fontSize: "13px", color: "#697386", lineHeight: "1.4" }}>
                Find the app block section and toggle Upsell Studio to active.
              </p>
            </div>
          </div>

          {/* Step 3 */}
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
                Save & Go Live
              </h4>
              <p style={{ margin: 0, fontSize: "13px", color: "#697386", lineHeight: "1.4" }}>
                Hit save in Shopify your upsell offer is now live for every customer.
              </p>
            </div>
          </div>
        </div>

        {/* CTA Button */}
        <a
          href={customizeUrl}
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
          Activate App in Shopify Settings
        </a>
      </div>
    </div>
  );
}

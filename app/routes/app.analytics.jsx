import { useLoaderData, useNavigate } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let dbOffers = [];
  let settings = null;
  let events = [];
  let offerImpressionCounts = [];
  try {
    dbOffers = await db.upsellOffer.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
    });
    // also pull per-offer impression counts so we can rank correctly
    offerImpressionCounts = await db.analyticsEvent.groupBy({
      by: ["offerId"],
      where: { shop, eventType: "IMPRESSION" },
      _count: { offerId: true },
    });
    settings = await db.upsellSettings.findUnique({
      where: { shop },
    });
    events = await db.analyticsEvent.findMany({
      where: { shop },
    });
  } catch (e) {
    console.error("Error loading analytics data:", e);
  }

  return {
    shop,
    dbOffers,
    settings,
    events,
    offerImpressionCounts,
  };
};

export default function AnalyticsPage() {
  const { dbOffers, settings, events = [], offerImpressionCounts = [] } = useLoaderData();
  const navigate = useNavigate();

  // Build a map of offerId → impression count from real analytics events
  const impressionByOfferId = {};
  offerImpressionCounts.forEach((row) => {
    if (row.offerId) impressionByOfferId[row.offerId] = row._count.offerId;
  });

  // Pick the offer with the most real impressions as the "top performer".
  // Fall back to the first offer (most recently created) if no impressions exist.
  const primarySwap = dbOffers && dbOffers.length > 0
    ? dbOffers.reduce((best, offer) => {
        const bestImpr = impressionByOfferId[best?.id] || 0;
        const thisImpr = impressionByOfferId[offer.id] || 0;
        return thisImpr > bestImpr ? offer : best;
      }, dbOffers[0])
    : null;

  const swapTitle = primarySwap
    ? `${primarySwap.triggerProductTitle || "Product"} → ${primarySwap.upgradeProductTitle || "Upgrade"} Swap`
    : "Pre-Checkout Product Swap";

  const discountCode = settings?.discountCode || "NEXT10";

  // Calculate 100% strict real stats for each feature directly from database events
  const getStats = (type) => {
    const featureEvents = events.filter((e) => e.featureType === type);
    const impCount = featureEvents.filter((e) => e.eventType === "IMPRESSION").length;
    const convCount = featureEvents.filter((e) => e.eventType === "CONVERSION").length;
    const totalRev = featureEvents
      .filter((e) => e.eventType === "CONVERSION")
      .reduce((sum, e) => sum + (e.revenue || 0), 0);

    const rate = impCount > 0 ? Math.round((convCount / impCount) * 100) : 0;

    return {
      impressions: impCount.toLocaleString(),
      acceptanceRate: rate,
      revenueNumber: totalRev,
      revenue: `$${totalRev.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
      convCount,
    };
  };

  const swapStats = getStats("SWAP");
  const upsellStats = getStats("THANK_YOU_UPSELL");
  const discountStats = getStats("DISCOUNT_WIDGET");
  const referralStats = getStats("REFERRAL_WIDGET");

  // Dynamic weekly growth calculation
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const thisWeekRev = events
    .filter((e) => e.eventType === "CONVERSION" && new Date(e.createdAt) >= sevenDaysAgo)
    .reduce((sum, e) => sum + (e.revenue || 0), 0);

  const lastWeekRev = events
    .filter(
      (e) =>
        e.eventType === "CONVERSION" &&
        new Date(e.createdAt) >= fourteenDaysAgo &&
        new Date(e.createdAt) < sevenDaysAgo
    )
    .reduce((sum, e) => sum + (e.revenue || 0), 0);

  let weeklyGrowthBadge = "0% this week";
  if (lastWeekRev > 0) {
    const pct = Math.round(((thisWeekRev - lastWeekRev) / lastWeekRev) * 100);
    weeklyGrowthBadge = `${pct >= 0 ? "↑ +" : "↓ "}${pct}% this week`;
  } else if (thisWeekRev > 0) {
    weeklyGrowthBadge = "↑ +100% this week";
  } else {
    weeklyGrowthBadge = "0% this week";
  }

  const totalRevenueNumber =
    swapStats.revenueNumber +
    upsellStats.revenueNumber +
    discountStats.revenueNumber +
    referralStats.revenueNumber;

  const formattedTotalRevenue = `$${totalRevenueNumber.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const totalConversions =
    swapStats.convCount +
    upsellStats.convCount +
    discountStats.convCount +
    referralStats.convCount;

  const aovLift = totalConversions > 0
    ? `+$${(totalRevenueNumber / totalConversions).toFixed(2)}`
    : "+$0.00";

  const futureRevenueNumber = (discountStats.convCount * 10) + (referralStats.convCount * 15);
  const formattedFutureRevenue = `$${futureRevenueNumber.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  // Calculate stats for the single best performing primarySwap offer to show in the summary table
  let topSwapStats = {
    impressions: "0",
    acceptanceRate: 0,
    revenue: "$0",
    convCount: 0,
    revenueNumber: 0,
  };

  if (primarySwap) {
    const offerImpr = impressionByOfferId[primarySwap.id] || 0;
    const offerEvents = events.filter((e) => e.offerId === primarySwap.id);
    const offerConv = offerEvents.filter((e) => e.eventType === "CONVERSION").length;
    const offerRev = offerEvents
      .filter((e) => e.eventType === "CONVERSION")
      .reduce((sum, e) => sum + (e.revenue || 0), 0);
    const offerRate = offerImpr > 0 ? Math.round((offerConv / offerImpr) * 100) : 0;
    topSwapStats = {
      impressions: offerImpr.toLocaleString(),
      acceptanceRate: offerRate,
      revenue: `$${offerRev.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`,
      convCount: offerConv,
      revenueNumber: offerRev,
    };
  }

  const topOffers = [
    {
      name: swapTitle,
      type: primarySwap?.offerType === "pack_upgrade" ? "Pack upgrade offer" : "Pre-checkout swap offer",
      iconType: "swap",
      iconBg: "#eceefb",
      iconColor: "#4f46e5",
      ...topSwapStats,
    },
    {
      name: "Thank You Page Product Upsell",
      type: "Thank You page add-on",
      iconType: "addon",
      iconBg: "#e2f1e5",
      iconColor: "#008060",
      ...upsellStats,
    },
    {
      name: `Discount Code Widget (${discountCode})`,
      type: "Thank You page discount claim",
      iconType: "discount",
      iconBg: "#fef3c7",
      iconColor: "#d97706",
      ...discountStats,
    },
    {
      name: "Referral & Share Link Widget",
      type: "Thank You page referral share",
      iconType: "referral",
      iconBg: "#e0f2fe",
      iconColor: "#0284c7",
      ...referralStats,
    },
  ];

  return (
    <div
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        backgroundColor: "#f4f6f8",
        minHeight: "100vh",
        color: "#1a1c1d",
        padding: "24px 0 40px 0",
      }}
    >
      <div style={{ maxWidth: "1080px", margin: "0 auto", padding: "0 24px" }}>
        
        {/* Page Title & Subtitle */}
        <div style={{ marginBottom: "24px" }}>
          <h1
            style={{
              fontSize: "26px",
              fontWeight: "700",
              margin: "0 0 6px 0",
              letterSpacing: "-0.02em",
              color: "#1a1c1d",
            }}
          >
            Hello Merchant!!
          </h1>
          <p style={{ fontSize: "14px", color: "#6d7175", margin: 0 }}>
            Track the extra revenue generated after the initial checkout.
          </p>
        </div>

        {/* 3 Metric Cards Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "20px",
            marginBottom: "24px",
          }}
        >
          {/* Card 1: Total Found Revenue */}
          <div
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #e1e3e5",
              borderRadius: "12px",
              padding: "24px",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.02)",
              borderTop: "3px solid #008060",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
          >
            <span
              style={{
                color: "#8c9196",
                fontWeight: "600",
                fontSize: "11px",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                marginBottom: "12px",
              }}
            >
              TOTAL FOUND REVENUE
            </span>
            <div
              style={{
                fontSize: "32px",
                fontWeight: "700",
                color: "#008060",
                marginBottom: "12px",
                letterSpacing: "-0.02em",
              }}
            >
              {formattedTotalRevenue}
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                backgroundColor: "#e6f4ea",
                color: "#008060",
                padding: "4px 10px",
                borderRadius: "12px",
                fontSize: "12px",
                fontWeight: "600",
              }}
            >
              {weeklyGrowthBadge}
            </span>
          </div>

          {/* Card 2: AOV Lift */}
          <div
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #e1e3e5",
              borderRadius: "12px",
              padding: "24px",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.02)",
              borderTop: "3px solid #4f46e5",
            }}
          >
            <div
              style={{
                color: "#8c9196",
                fontWeight: "600",
                fontSize: "11px",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                marginBottom: "12px",
              }}
            >
              AVERAGE ORDER VALUE (AOV) LIFT
            </div>
            <div
              style={{
                fontSize: "32px",
                fontWeight: "700",
                color: "#1a1c1d",
                marginBottom: "12px",
                letterSpacing: "-0.02em",
              }}
            >
              {aovLift}
            </div>
            <span style={{ color: "#8c9196", fontSize: "13px" }}>
              Per upgraded order
            </span>
          </div>

          {/* Card 3: Future Revenue Pending */}
          <div
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #e1e3e5",
              borderRadius: "12px",
              padding: "24px",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.02)",
              borderTop: "3px solid #008060",
            }}
          >
            <div
              style={{
                color: "#8c9196",
                fontWeight: "600",
                fontSize: "11px",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                marginBottom: "12px",
              }}
            >
              FUTURE REVENUE PENDING
            </div>
            <div
              style={{
                fontSize: "32px",
                fontWeight: "700",
                color: "#1a1c1d",
                marginBottom: "12px",
                letterSpacing: "-0.02em",
              }}
            >
              {formattedFutureRevenue}
            </div>
            <span
              style={{
                color: "#8c9196",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>🔒</span> From unredeemed Thank You rewards
            </span>
          </div>
        </div>

        {/* Table Card: Top Performing Offers */}
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #e1e3e5",
            borderRadius: "12px",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.02)",
            overflow: "hidden",
            padding: "24px",
          }}
        >
          {/* Table Card Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: "20px",
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: "16px",
                  fontWeight: "700",
                  color: "#1a1c1d",
                  margin: "0 0 4px 0",
                }}
              >
                Top Performing Offers
              </h2>
              <p style={{ fontSize: "13px", color: "#6d7175", margin: 0 }}>
                Last 7 days &middot; {topOffers.length} active features
              </p>
            </div>
            <button
              onClick={() => navigate("/app")}
              style={{
                background: "none",
                border: "none",
                color: "#4f46e5",
                fontSize: "13px",
                fontWeight: "600",
                cursor: "pointer",
                padding: 0,
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
              onMouseOver={(e) =>
                (e.currentTarget.style.textDecoration = "underline")
              }
              onMouseOut={(e) =>
                (e.currentTarget.style.textDecoration = "none")
              }
            >
              View all offers &rarr;
            </button>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
                fontSize: "14px",
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid #e1e3e5",
                    backgroundColor: "#fafbfb",
                  }}
                >
                  <th
                    style={{
                      padding: "12px 16px",
                      fontWeight: "600",
                      fontSize: "11px",
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: "#8c9196",
                    }}
                  >
                    OFFER NAME
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      fontWeight: "600",
                      fontSize: "11px",
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: "#8c9196",
                      textAlign: "center",
                    }}
                  >
                    IMPRESSIONS
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      fontWeight: "600",
                      fontSize: "11px",
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: "#8c9196",
                    }}
                  >
                    ACCEPTANCE RATE
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      fontWeight: "600",
                      fontSize: "11px",
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: "#8c9196",
                      textAlign: "right",
                    }}
                  >
                    REVENUE GENERATED
                  </th>
                </tr>
              </thead>
              <tbody>
                {topOffers.map((item, idx) => (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: "1px solid #f1f2f4",
                      transition: "background-color 0.15s",
                    }}
                  >
                    {/* OFFER NAME */}
                    <td style={{ padding: "16px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                        }}
                      >
                        <div
                          style={{
                            width: "32px",
                            height: "32px",
                            backgroundColor: item.iconBg,
                            borderRadius: "8px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {item.iconType === "swap" && (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke={item.iconColor}
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M7 16V4M7 4L3 8M7 4L11 8" />
                              <path d="M17 8V20M17 20L21 16M17 20L13 16" />
                            </svg>
                          )}
                          {item.iconType === "addon" && (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke={item.iconColor}
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                          )}
                          {item.iconType === "discount" && (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke={item.iconColor}
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                              <line x1="7" y1="7" x2="7.01" y2="7" />
                            </svg>
                          )}
                          {item.iconType === "referral" && (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke={item.iconColor}
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                              <path d="M23 21v-2a4 4 0 00-3-3.87" />
                              <path d="M16 3.13a4 4 0 010 7.75" />
                            </svg>
                          )}
                        </div>
                        <div>
                          <div
                            style={{
                              fontWeight: "600",
                              color: "#1a1c1d",
                              marginBottom: "2px",
                              fontSize: "14px",
                            }}
                          >
                            {item.name}
                          </div>
                          <span style={{ fontSize: "12px", color: "#8c9196" }}>
                            {item.type}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* IMPRESSIONS */}
                    <td
                      style={{
                        padding: "16px",
                        textAlign: "center",
                        fontWeight: "500",
                        color: "#1a1c1d",
                      }}
                    >
                      {item.impressions}
                    </td>

                    {/* ACCEPTANCE RATE */}
                    <td style={{ padding: "16px" }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: "600",
                            color: "#1a1c1d",
                            minWidth: "30px",
                            fontSize: "13px",
                          }}
                        >
                          {item.acceptanceRate}%
                        </span>
                        <div
                          style={{
                            width: "70px",
                            height: "6px",
                            backgroundColor: "#e1e3e5",
                            borderRadius: "3px",
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${item.acceptanceRate}%`,
                              height: "100%",
                              backgroundColor: "#3630a3",
                              borderRadius: "3px",
                            }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* REVENUE GENERATED */}
                    <td
                      style={{
                        padding: "16px",
                        textAlign: "right",
                        fontWeight: "700",
                        color: "#008060",
                        fontSize: "14px",
                      }}
                    >
                      {item.revenue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}

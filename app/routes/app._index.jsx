import { useState, useEffect } from "react";
import { useNavigate, useLoaderData, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncOffersToMetafield, syncSettingsToMetafield } from "../lib/syncMetafield";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const dbOffers = await prisma.upsellOffer.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  // Auto-sync active offers and settings to shop metafields so storefront is always up-to-date
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || new URL(request.url).host;
  let appUrl = `${proto}://${host}`;
  if (appUrl.startsWith("http://")) {
    appUrl = appUrl.replace("http://", "https://");
  }
  await syncOffersToMetafield(admin, shop, prisma);
  await syncSettingsToMetafield(admin, shop, prisma, appUrl);

  return { dbOffers };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const actionType = formData.get("actionType");
  const offerId = formData.get("offerId");

  if (actionType === "TOGGLE_STATUS") {
    const isActive = formData.get("isActive") === "true";
    await prisma.upsellOffer.update({
      where: { id: offerId, shop },
      data: { isActive },
    });
    // Sync active offers to shop metafield so storefront stays up-to-date
    await syncOffersToMetafield(admin, shop, prisma);
    return { success: true };
  }

  if (actionType === "DELETE") {
    await prisma.upsellOffer.delete({
      where: { id: offerId, shop },
    });
    // Sync active offers to shop metafield so storefront stays up-to-date
    await syncOffersToMetafield(admin, shop, prisma);
    return { success: true };
  }

  return null;
};

export default function DashboardPage() {
  const { dbOffers } = useLoaderData();
  const navigate = useNavigate();
  const submit = useSubmit();

  // Local overrides state to prevent disabled products from disappearing instantly on click
  const [localOverrides, setLocalOverrides] = useState({});

  // Load database upsell rules
  const offers = dbOffers.map((o) => {
    const isActive = localOverrides[o.id] !== undefined ? localOverrides[o.id] : o.isActive;
    return {
      id: o.id,
      triggerTitle: (o.triggerProductTitle || "Base Product").replace(" - Default Title", ""),
      upgradeTitle: (o.upgradeProductTitle || "Upgrade Product").replace(" - Default Title", ""),
      type: o.type === "SIZE_UPGRADE" ? "Size Swap" : "Pack Upgrade",
      typeColor: o.type === "SIZE_UPGRADE" ? "#eceefb" : "#fbf3e5",
      typeTextColor: o.type === "SIZE_UPGRADE" ? "#5c6ac4" : "#d57e2a",
      upcharge: o.priceDifference || 0.0,
      convRate: 0.0,
      earned: 0,
      isActive,
      triggerImg: o.triggerProductImage || "",
      upgradeImg: o.upgradeProductImage || "",
    };
  });

  // Search filter state
  const [searchQuery, setSearchQuery] = useState("");

  const toggleStatus = (id, currentStatus) => {
    // Record optimistic override state
    setLocalOverrides((prev) => ({
      ...prev,
      [id]: !currentStatus,
    }));

    submit(
      {
        actionType: "TOGGLE_STATUS",
        offerId: id,
        isActive: String(!currentStatus),
      },
      { method: "POST" }
    );
  };

  const handleDeleteOffer = (id) => {
    if (confirm("Are you sure you want to delete this upsell mapping?")) {
      submit(
        {
          actionType: "DELETE",
          offerId: id,
        },
        { method: "POST" }
      );
    }
  };

  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  // Reset overrides when user changes filter dropdowns or search query
  useEffect(() => {
    setLocalOverrides({});
  }, [statusFilter, typeFilter, searchQuery]);

  const filteredOffers = offers.filter((offer) => {
    const matchesSearch =
      offer.triggerTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      offer.upgradeTitle.toLowerCase().includes(searchQuery.toLowerCase());
      
    // If user recently toggled this item in this session, keep it visible in the current list but fainted
    const hasLocalOverride = localOverrides[offer.id] !== undefined;
    const matchesStatus =
      hasLocalOverride ||
      statusFilter === "ALL" ||
      (statusFilter === "ACTIVE" && offer.isActive) ||
      (statusFilter === "INACTIVE" && !offer.isActive);
      
    const matchesType =
      typeFilter === "ALL" ||
      (typeFilter === "SIZE_UPGRADE" && offer.type === "Size Swap") ||
      (typeFilter === "PACK_UPGRADE" && offer.type === "Pack Upgrade");
      
    return matchesSearch && matchesStatus && matchesType;
  });

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 3;
  const totalOffers = filteredOffers.length;
  const totalPages = Math.ceil(totalOffers / itemsPerPage);
  const activePage = Math.max(1, Math.min(currentPage, totalPages || 1));
  const startIndex = (activePage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedOffers = filteredOffers.slice(startIndex, endIndex);

  let emptyStateTitle = "No active offers yet";
  let emptyStateSubtitle = 'Click "+ Create New Offer" to configure your first upsell mapping.';

  if (offers.length === 0) {
    emptyStateTitle = "No active offers yet";
    emptyStateSubtitle = 'Click "+ Create New Offer" to configure your first upsell mapping.';
  } else if (statusFilter === "INACTIVE" && filteredOffers.length === 0) {
    emptyStateTitle = "No Inactive items here";
    emptyStateSubtitle = "Toggle your rules to inactive to see them list here.";
  } else if (statusFilter === "ACTIVE" && filteredOffers.length === 0) {
    emptyStateTitle = "No Active items here";
    emptyStateSubtitle = "Turn on your upsell mappings to see them list here.";
  } else {
    emptyStateTitle = "No results found";
    emptyStateSubtitle = "Try refining your search query or filters.";
  }

  return (
    <div
      style={{
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        backgroundColor: "#f1f1f1",
        minHeight: "100vh",
        color: "#202223",
        padding: "12px 24px",
      }}
    >
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        
        {/* Title Bar Section */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "32px",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "28px",
                fontWeight: "700",
                margin: "0 0 4px 0",
                letterSpacing: "-0.02em",
                color: "#1a1c1d",
              }}
            >
              Active Upsell Offers
            </h1>
            <p style={{ fontSize: "14px", color: "#6d7175", margin: 0 }}>
              Manage your post-purchase and checkout upgrades.
            </p>
          </div>

          {/* Header Action Buttons */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              onClick={() => navigate("/app/settings?step=4")}
              style={{
                padding: "8px 16px",
                backgroundColor: "#f0effb",
                border: "1px solid #d3d1f8",
                borderRadius: "6px",
                color: "#4f46e5",
                fontSize: "13px",
                fontWeight: "500",
                letterSpacing: "0.02em",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = "#e1dff9";
                e.currentTarget.style.borderColor = "#4f46e5";
                e.currentTarget.style.color = "#241f7a";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = "#f0effb";
                e.currentTarget.style.borderColor = "#d3d1f8";
                e.currentTarget.style.color = "#4f46e5";
              }}
            >
              Thank You Page Toggles
            </button>
            <button
              onClick={() => navigate("/app/settings")}
              style={{
                padding: "8px 16px",
                backgroundColor: "#f5f5f5",
                border: "1px solid #d9d9d9",
                borderRadius: "6px",
                color: "#434343",
                fontSize: "13px",
                fontWeight: "500",
                letterSpacing: "0.02em",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = "#e8e8e8";
                e.currentTarget.style.borderColor = "#8c8c8c";
                e.currentTarget.style.color = "#141414";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = "#f5f5f5";
                e.currentTarget.style.borderColor = "#d9d9d9";
                e.currentTarget.style.color = "#434343";
              }}
            >
              + Create New Offer
            </button>
            <button
              onClick={() => navigate("/app/analytics")}
              style={{
                padding: "8px 16px",
                backgroundColor: "#3630a3",
                border: "1px solid #3630a3",
                borderRadius: "6px",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: "500",
                letterSpacing: "0.02em",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = "#241f7a";
                e.currentTarget.style.borderColor = "#241f7a";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = "#3630a3";
                e.currentTarget.style.borderColor = "#3630a3";
              }}
            >
              See Analytics
            </button>
          </div>
        </div>

        {/* Filter & Search Bar Card */}
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #dfe3e8",
            borderRadius: "12px",
            padding: "16px 20px",
            display: "flex",
            gap: "16px",
            alignItems: "center",
            boxShadow: "0 2px 4px rgba(0, 0, 0, 0.01)",
            marginBottom: "24px",
            flexWrap: "wrap",
          }}
        >
          {/* Search Input */}
          <div
            style={{
              position: "relative",
              flex: 1,
              minWidth: "260px",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: "14px",
                top: "50%",
                transform: "translateY(-50%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8c9196" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search offers by product name..."
              style={{
                boxSizing: "border-box",
                width: "100%",
                padding: "10px 12px 10px 40px",
                fontSize: "14px",
                borderRadius: "8px",
                border: "1px solid #dfe3e8",
                outline: "none",
                backgroundColor: "#f9fafb",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#5c6ac4")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#dfe3e8")}
            />
          </div>

          {/* Status Filter Button */}
          {/* Status Filter */}
          <div style={{ position: "relative" }}>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 16px",
                backgroundColor: "#ffffff",
                border: "1px solid #dfe3e8",
                borderRadius: "8px",
                fontSize: "14px",
                color: "#202223",
                fontWeight: "500",
                cursor: "pointer",
                appearance: "none",
                WebkitAppearance: "none",
                paddingRight: "36px",
                backgroundImage: "url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23202223%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 14px top 50%",
                backgroundSize: "10px auto",
                outline: "none",
              }}
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active (On)</option>
              <option value="INACTIVE">Inactive (Off)</option>
            </select>
          </div>

          {/* Offer Type Filter */}
          <div style={{ position: "relative" }}>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 16px",
                backgroundColor: "#ffffff",
                border: "1px solid #dfe3e8",
                borderRadius: "8px",
                fontSize: "14px",
                color: "#202223",
                fontWeight: "500",
                cursor: "pointer",
                appearance: "none",
                WebkitAppearance: "none",
                paddingRight: "36px",
                backgroundImage: "url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23202223%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 14px top 50%",
                backgroundSize: "10px auto",
                outline: "none",
              }}
            >
              <option value="ALL">All Types</option>
              <option value="SIZE_UPGRADE">Size Swap</option>
              <option value="PACK_UPGRADE">Pack Upgrade</option>
            </select>
          </div>
        </div>

        {/* Offers Table Card */}
        <div
          style={{
            backgroundColor: "#ffffff",
            border: "1px solid #dfe3e8",
            borderRadius: "12px",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.02)",
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            {filteredOffers.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px 24px", color: "#6d7175" }}>
                <div style={{ fontSize: "36px", marginBottom: "12px" }}>🎁</div>
                <div style={{ fontSize: "16px", fontWeight: "600", color: "#202223", marginBottom: "4px" }}>{emptyStateTitle}</div>
                <div style={{ fontSize: "14px", color: "#6d7175", marginBottom: "20px" }}>{emptyStateSubtitle}</div>
              </div>
            ) : (
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
                      backgroundColor: "#fcfcfd",
                    }}
                  >
                    <th style={{ padding: "16px 24px", color: "#6d7175", fontWeight: "600", fontSize: "11px", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                      OFFER MAPPING
                    </th>
                    <th style={{ padding: "16px 24px", color: "#6d7175", fontWeight: "600", fontSize: "11px", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                      PERFORMANCE
                    </th>
                    <th style={{ padding: "16px 24px", color: "#6d7175", fontWeight: "600", fontSize: "11px", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                      STATUS
                    </th>
                    <th style={{ padding: "16px 24px", color: "#6d7175", fontWeight: "600", fontSize: "11px", letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "right" }}>
                      ACTIONS
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOffers.map((offer) => (
                    <tr
                      key={offer.id}
                      style={{
                        borderBottom: "1px solid #f1f2f4",
                        opacity: offer.isActive ? 1 : 0.55,
                        transition: "opacity 0.2s",
                      }}
                    >
                      {/* Offer Mapping Column */}
                      <td style={{ padding: "20px 24px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                          {/* Visual product thumbnails */}
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <div style={{ width: "36px", height: "36px", backgroundColor: "#f6f6f7", borderRadius: "6px", display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "center", overflow: "hidden", border: "1px solid #e1e3e5" }}>
                              {offer.triggerImg ? (
                                <img src={offer.triggerImg} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              ) : (
                                <span style={{ fontSize: "16px" }}>📦</span>
                              )}
                            </div>
                            <span style={{ color: "#8c9196", fontWeight: "bold" }}>→</span>
                            <div style={{ width: "36px", height: "36px", backgroundColor: "#f6f6f7", borderRadius: "6px", display: "flex", alignItems: "center", justifyItems: "center", justifyContent: "center", overflow: "hidden", border: "1px solid #e1e3e5" }}>
                              {offer.upgradeImg ? (
                                <img src={offer.upgradeImg} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              ) : (
                                <span style={{ fontSize: "16px" }}>📦</span>
                              )}
                            </div>
                          </div>
                          
                          <div>
                            <div style={{ fontWeight: "600", fontSize: "14px", color: "#202223", marginBottom: "4px" }}>
                              {offer.triggerTitle} &rarr; {offer.upgradeTitle}
                            </div>
                            <span
                              style={{
                                backgroundColor: offer.isActive ? offer.typeColor : "#f4f6f8",
                                color: offer.isActive ? offer.typeTextColor : "#6d7175",
                                fontSize: "11px",
                                fontWeight: "600",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                display: "inline-block",
                              }}
                            >
                              {offer.type}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Performance Column */}
                      <td style={{ padding: "20px 24px" }}>
                        <div style={{ fontWeight: "600", color: "#202223", marginBottom: "2px" }}>
                          {offer.convRate.toFixed(1)}% <span style={{ fontWeight: "normal", color: "#6d7175" }}>Conv. Rate</span>
                        </div>
                        {offer.earned > 0 ? (
                          <span style={{ fontSize: "12px", color: "#107c10", fontWeight: "600", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline-block", verticalAlign: "middle" }}>
                              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                              <polyline points="17 6 23 6 23 12"></polyline>
                            </svg>
                            ${offer.earned.toLocaleString()} Earned
                          </span>
                        ) : (
                          <span style={{ fontSize: "12px", color: "#6d7175" }}>— $0 Earned</span>
                        )}
                      </td>

                      {/* Status Toggle Column */}
                      <td style={{ padding: "20px 24px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          {/* Switch Toggle */}
                          <div
                            onClick={() => toggleStatus(offer.id, offer.isActive)}
                            style={{
                              width: "36px",
                              height: "20px",
                              backgroundColor: offer.isActive ? "#4f46e5" : "#e2e8f0",
                              borderRadius: "10px",
                              padding: "2px",
                              boxSizing: "border-box",
                              cursor: "pointer",
                              transition: "background-color 0.2s ease",
                              display: "flex",
                              alignItems: "center",
                            }}
                          >
                            <div
                              style={{
                                width: "16px",
                                height: "16px",
                                backgroundColor: "#ffffff",
                                borderRadius: "50%",
                                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.15), 0 2px 4px rgba(0, 0, 0, 0.1)",
                                transition: "transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                                transform: offer.isActive ? "translateX(16px)" : "none",
                              }}
                            />
                          </div>
                          <span style={{ fontSize: "12px", fontWeight: "500", color: offer.isActive ? "#4f46e5" : "#697386", width: "24px", letterSpacing: "0.02em" }}>
                            {offer.isActive ? "On" : "Off"}
                          </span>
                        </div>
                      </td>

                      {/* Actions Column */}
                      <td style={{ padding: "20px 24px", textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                            <button
                              disabled={!offer.isActive}
                              onClick={() => handleDeleteOffer(offer.id)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "6px 12px",
                                backgroundColor: offer.isActive ? "#fff1f0" : "#fafafa",
                                border: offer.isActive ? "1px solid #ffa39e" : "1px solid #e8e8e8",
                                borderRadius: "6px",
                                color: offer.isActive ? "#cf1322" : "#bfbfbf",
                                fontSize: "12px",
                                fontWeight: "500",
                                letterSpacing: "0.03em",
                                cursor: offer.isActive ? "pointer" : "not-allowed",
                                opacity: offer.isActive ? 1 : 0.6,
                                transition: "all 0.2s ease",
                              }}
                              onMouseOver={(e) => {
                                if (offer.isActive) {
                                  e.currentTarget.style.backgroundColor = "#ffccc7";
                                  e.currentTarget.style.borderColor = "#ff4d4f";
                                  e.currentTarget.style.color = "#a8071a";
                                }
                              }}
                              onMouseOut={(e) => {
                                if (offer.isActive) {
                                  e.currentTarget.style.backgroundColor = "#fff1f0";
                                  e.currentTarget.style.borderColor = "#ffa39e";
                                  e.currentTarget.style.color = "#cf1322";
                                }
                              }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline-block", verticalAlign: "middle" }}>
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                              </svg>
                              Delete
                            </button>
                            <button
                              disabled={!offer.isActive}
                              onClick={() => navigate(`/app/settings?id=${offer.id}`)}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "6px 12px",
                                backgroundColor: offer.isActive ? "#f5f5f5" : "#fafafa",
                                border: offer.isActive ? "1px solid #d9d9d9" : "1px solid #e8e8e8",
                                borderRadius: "6px",
                                color: offer.isActive ? "#434343" : "#bfbfbf",
                                fontSize: "12px",
                                fontWeight: "500",
                                letterSpacing: "0.03em",
                                cursor: offer.isActive ? "pointer" : "not-allowed",
                                opacity: offer.isActive ? 1 : 0.6,
                                transition: "all 0.2s ease",
                              }}
                              onMouseOver={(e) => {
                                if (offer.isActive) {
                                  e.currentTarget.style.backgroundColor = "#e8e8e8";
                                  e.currentTarget.style.borderColor = "#8c8c8c";
                                  e.currentTarget.style.color = "#141414";
                                }
                              }}
                              onMouseOut={(e) => {
                                if (offer.isActive) {
                                  e.currentTarget.style.backgroundColor = "#f5f5f5";
                                  e.currentTarget.style.borderColor = "#d9d9d9";
                                  e.currentTarget.style.color = "#434343";
                                }
                              }}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "inline-block", verticalAlign: "middle" }}>
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                              </svg>
                              Edit
                            </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Table Footer / Pagination */}
          <div
            style={{
              padding: "16px 24px",
              borderTop: "1px solid #e1e3e5",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
              backgroundColor: "#fcfcfd",
            }}
          >
            <div style={{ fontSize: "13px", color: "#6d7175", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#107c10", fontSize: "10px" }}>●</span> 
              {totalOffers > 0 ? (
                <span>
                  Showing <strong>{startIndex + 1}–{Math.min(endIndex, totalOffers)}</strong> of <strong>{totalOffers}</strong> offers
                </span>
              ) : (
                <span>0 offers</span>
              )}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  disabled={activePage === 1}
                  onClick={() => setCurrentPage(activePage - 1)}
                  style={{
                    padding: "6px 12px",
                    border: "1px solid #dfe3e8",
                    backgroundColor: "#ffffff",
                    borderRadius: "6px",
                    color: activePage === 1 ? "#babfc3" : "#202223",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: activePage === 1 ? "not-allowed" : "pointer",
                  }}
                  onMouseOver={(e) => {
                    if (activePage !== 1) e.currentTarget.style.backgroundColor = "#f6f6f7";
                  }}
                  onMouseOut={(e) => {
                    if (activePage !== 1) e.currentTarget.style.backgroundColor = "#ffffff";
                  }}
                >
                  &lsaquo;
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    style={{
                      padding: "6px 12px",
                      border: pageNum === activePage ? "1px solid #3630a3" : "1px solid #dfe3e8",
                      backgroundColor: pageNum === activePage ? "#3630a3" : "#ffffff",
                      borderRadius: "6px",
                      color: pageNum === activePage ? "#ffffff" : "#202223",
                      fontSize: "13px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                    onMouseOver={(e) => {
                      if (pageNum !== activePage) e.currentTarget.style.backgroundColor = "#f6f6f7";
                    }}
                    onMouseOut={(e) => {
                      if (pageNum !== activePage) e.currentTarget.style.backgroundColor = "#ffffff";
                    }}
                  >
                    {pageNum}
                  </button>
                ))}
                <button
                  disabled={activePage === totalPages}
                  onClick={() => setCurrentPage(activePage + 1)}
                  style={{
                    padding: "6px 12px",
                    border: "1px solid #dfe3e8",
                    backgroundColor: "#ffffff",
                    borderRadius: "6px",
                    color: activePage === totalPages ? "#babfc3" : "#202223",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: activePage === totalPages ? "not-allowed" : "pointer",
                  }}
                  onMouseOver={(e) => {
                    if (activePage !== totalPages) e.currentTarget.style.backgroundColor = "#f6f6f7";
                  }}
                  onMouseOut={(e) => {
                    if (activePage !== totalPages) e.currentTarget.style.backgroundColor = "#ffffff";
                  }}
                >
                  &rsaquo;
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

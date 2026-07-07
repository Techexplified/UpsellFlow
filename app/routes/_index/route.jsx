import { redirect } from "react-router";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      width: "100%",
      backgroundColor: "#f9fafb",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, Helvetica, sans-serif",
      color: "#202223",
      textAlign: "center",
      padding: "20px",
      boxSizing: "border-box"
    }}>
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}>
        <h1 style={{
          fontSize: "20px",
          fontWeight: "500",
          margin: 0,
          color: "#1f2937",
        }}>
          UpsellFlow
        </h1>
        <p style={{
          fontSize: "15px",
          color: "#4b5563",
          margin: 0,
        }}>
          Open this app from your Shopify admin to get started.
        </p>
      </div>
    </div>
  );
}

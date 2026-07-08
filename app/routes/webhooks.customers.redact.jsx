import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received GDPR compliance webhook: ${topic} for ${shop}`);

  // This app does not store customer personal data, so we can return 200 immediately
  return new Response("Success", { status: 200 });
};

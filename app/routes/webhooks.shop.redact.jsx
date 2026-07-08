import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received GDPR compliance webhook: ${topic} for ${shop}`);

  // This app only stores merchant analytics and session info, which is safely handled
  return new Response("Success", { status: 200 });
};

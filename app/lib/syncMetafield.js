/**
 * syncOffersToMetafield
 *
 * 1. Ensures the metafield definition for shop.upsellflow.offers exists with PUBLIC_READ access.
 * 2. Reads all active upsell offers from Prisma for the shop.
 * 3. Writes them as JSON into the shop metafield.
 */
export async function syncOffersToMetafield(admin, shop, prisma) {
  try {
    // ── STEP 1: Ensure metafield definition exists with storefront PUBLIC_READ ──
    await ensureMetafieldDefinition(admin, "offers", "UpsellFlow Active Offers", "Active upsell swap rules for the storefront extension");

    // ── STEP 2: Fetch shop GID ─────────────────────────────────────────────────
    const shopRes = await admin.graphql(`query { shop { id } }`);
    const shopJson = await shopRes.json();
    const shopId = shopJson?.data?.shop?.id;

    if (!shopId) {
      console.error("[UpsellFlow] Could not fetch shop GID. Aborting sync.");
      return;
    }

    // ── STEP 3: Fetch all active offers from DB ────────────────────────────────
    const offers = await prisma.upsellOffer.findMany({
      where: { shop, isActive: true },
      select: {
        id: true,
        triggerProductId: true,
        triggerProductTitle: true,
        triggerProductImage: true,
        upgradeProductId: true,
        upgradeProductTitle: true,
        upgradeProductImage: true,
        type: true,
      },
    });

    console.log("[UpsellFlow] Writing", offers.length, "active offers to metafield for", shopId);

    // ── STEP 3b: Batch-fetch variant prices from Shopify Admin API ─────────────
    const allVariantIds = [];
    for (const o of offers) {
      if (o.triggerProductId) allVariantIds.push(o.triggerProductId);
      if (o.upgradeProductId) allVariantIds.push(o.upgradeProductId);
    }

    const priceMap = {};
    if (allVariantIds.length > 0) {
      const priceQuery = `
        query getVariantPrices($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              price
            }
          }
        }
      `;
      const priceRes = await admin.graphql(priceQuery, { variables: { ids: allVariantIds } });
      const priceJson = await priceRes.json();
      const nodes = priceJson?.data?.nodes || [];
      for (const node of nodes) {
        if (node?.id && node?.price !== undefined) {
          priceMap[node.id] = parseFloat(node.price);
        }
      }
    }

    // Attach prices to each offer
    const offersWithPrices = offers.map((o) => ({
      ...o,
      triggerVariantPrice: priceMap[o.triggerProductId] ?? null,
      upgradeVariantPrice: priceMap[o.upgradeProductId] ?? null,
    }));

    // ── STEP 4: Write offers to shop metafield ─────────────────────────────────
    const mutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key value }
          userErrors { field message }
        }
      }
    `;

    const res = await admin.graphql(mutation, {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: "upsellflow",
            key: "offers",
            value: JSON.stringify(offersWithPrices),
            type: "json",
          },
        ],
      },
    });

    const json = await res.json();
    const errors = json?.data?.metafieldsSet?.userErrors;

    if (errors && errors.length > 0) {
      console.error("[UpsellFlow] Metafield write errors:", errors);
    } else {
      const written = json?.data?.metafieldsSet?.metafields?.[0];
      console.log("[UpsellFlow] ✅ Metafield synced. ID:", written?.id, "| offers:", offers.length);
    }
  } catch (err) {
    console.error("[UpsellFlow] Metafield sync exception:", err);
  }
}

/**
 * syncSettingsToMetafield
 *
 * 1. Ensures the metafield definition for shop.upsellflow.settings exists with PUBLIC_READ access.
 * 2. Fetches/creates the UpsellSettings record for the shop.
 * 3. Writes it to the settings metafield so Checkout extensions can read it.
 */
export async function syncSettingsToMetafield(admin, shop, prisma, appUrl) {
  try {
    // ── STEP 1: Ensure metafield definition exists ──
    await ensureMetafieldDefinition(admin, "settings", "UpsellFlow Settings", "Thank you page and widgets configuration");

    // ── STEP 2: Fetch shop GID ─────────────────────────────────────────────────
    const shopRes = await admin.graphql(`query { shop { id } }`);
    const shopJson = await shopRes.json();
    const shopId = shopJson?.data?.shop?.id;

    if (!shopId) {
      console.log("[UpsellFlow] Could not fetch shop GID. Aborting settings sync.");
      return;
    }

    // ── STEP 3: Fetch or create UpsellSettings from DB ─────────────────────────
    let settings = await prisma.upsellSettings.findUnique({
      where: { shop },
    });

    if (!settings) {
      settings = await prisma.upsellSettings.create({
        data: { shop },
      });
    }

    // ── STEP 4: Write settings to shop metafield ──────────────────────────────
    console.log("[UpsellFlow] Syncing settings with appUrl:", appUrl);
    const mutation = `
      mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key value }
          userErrors { field message }
        }
      }
    `;

    const res = await admin.graphql(mutation, {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: "upsellflow",
            key: "settings",
            value: JSON.stringify({
              thankYouWidgetEnabled: settings.thankYouWidgetEnabled,
              referralWidgetEnabled: settings.referralWidgetEnabled,
              discountWidgetEnabled: settings.discountWidgetEnabled,
              discountCode: settings.discountCode,
              timerDuration: settings.timerDuration,
              isActive: settings.isActive,
              appUrl: appUrl || "",
            }),
            type: "json",
          },
        ],
      },
    });

    const json = await res.json();
    const errors = json?.data?.metafieldsSet?.userErrors;

    if (errors && errors.length > 0) {
      console.error("[UpsellFlow] Settings metafield write errors:", errors);
    } else {
      const written = json?.data?.metafieldsSet?.metafields?.[0];
      console.log("[UpsellFlow] ✅ Settings metafield synced. ID:", written?.id);
    }
  } catch (err) {
    console.error("[UpsellFlow] Settings metafield sync exception:", err);
  }
}

/**
 * Ensures the metafield definition for shop → upsellflow.[key] exists
 * and has PUBLIC_READ storefront access. Updates if found with wrong access.
 */
async function ensureMetafieldDefinition(admin, key, name, description) {
  try {
    // 1. Fetch existing definitions for our namespace
    const checkRes = await admin.graphql(`
      query {
        metafieldDefinitions(first: 20, ownerType: SHOP, namespace: "upsellflow") {
          edges {
            node {
              id
              namespace
              key
              access { storefront }
            }
          }
        }
      }
    `);
    const checkJson = await checkRes.json();
    const existing = checkJson?.data?.metafieldDefinitions?.edges || [];
    const definition = existing.find(
      (e) => e.node.namespace === "upsellflow" && e.node.key === key
    );

    if (definition) {
      const currentAccess = definition.node.access?.storefront;
      console.log(`[UpsellFlow] Definition found for ${key}. Storefront access:`, currentAccess);

      if (currentAccess === "PUBLIC_READ") {
        return;
      }

      // Update the definition to PUBLIC_READ
      console.log(`[UpsellFlow] Updating definition for ${key} to PUBLIC_READ...`);
      const updateRes = await admin.graphql(`
        mutation metafieldDefinitionUpdate($definition: MetafieldDefinitionUpdateInput!, $id: ID!) {
          metafieldDefinitionUpdate(definition: $definition, id: $id) {
            updatedDefinition { id access { storefront } }
            userErrors { field message code }
          }
        }
      `, {
        variables: {
          id: definition.node.id,
          definition: {
            access: { storefront: "PUBLIC_READ" },
          },
        },
      });
      const updateJson = await updateRes.json();
      const updateErrors = updateJson?.data?.metafieldDefinitionUpdate?.userErrors;
      if (updateErrors && updateErrors.length > 0) {
        console.error(`[UpsellFlow] Failed to update definition access for ${key}:`, updateErrors);
      } else {
        console.log(`[UpsellFlow] ✅ Definition for ${key} updated to PUBLIC_READ.`);
      }
      return;
    }

    // 2. Definition doesn't exist — create it with PUBLIC_READ
    console.log(`[UpsellFlow] Creating metafield definition for ${key} with PUBLIC_READ...`);
    const createRes = await admin.graphql(`
      mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id namespace key access { storefront } }
          userErrors { field message code }
        }
      }
    `, {
      variables: {
        definition: {
          namespace: "upsellflow",
          key,
          name,
          description,
          type: "json",
          ownerType: "SHOP",
          access: { storefront: "PUBLIC_READ" },
        },
      },
    });
    const createJson = await createRes.json();
    const createErrors = createJson?.data?.metafieldDefinitionCreate?.userErrors;
    if (createErrors && createErrors.length > 0) {
      console.error(`[UpsellFlow] Failed to create definition for ${key}:`, createErrors);
    } else {
      console.log(
        `[UpsellFlow] ✅ Definition for ${key} created with PUBLIC_READ. ID:`,
        createJson?.data?.metafieldDefinitionCreate?.createdDefinition?.id
      );
    }
  } catch (err) {
    console.error(`[UpsellFlow] ensureMetafieldDefinition exception for ${key}:`, err);
  }
}

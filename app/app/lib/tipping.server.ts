import {
  CART_TRANSFORM_HANDLE,
  DISCOUNTABLE_COLLECTION_HANDLE,
  TIPPING_CONFIG_KEY,
  TIP_PRODUCT_HANDLE,
  TIP_PRODUCT_TAG,
  TIP_PRODUCT_TYPE,
  VALIDATION_HANDLE,
} from "./constants";
import { gql, userErrorMessage, type AdminClient, type UserError } from "./admin.server";
import { parseTippingConfig, type TippingConfig } from "./tipping";

const CONFIG_QUERY = `#graphql
  query TippingConfig($key: String!) {
    shop {
      id
      metafield(namespace: "$app", key: $key) { jsonValue }
    }
  }
`;

const CONFIG_SET = `#graphql
  mutation TippingConfigSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

const STATUS_QUERY = `#graphql
  query TippingStatus($productHandle: String!, $collectionHandle: String!) {
    product: productByIdentifier(identifier: { handle: $productHandle }) {
      id
      status
      tags
      variants(first: 1) { nodes { id price } }
    }
    collection: collectionByIdentifier(identifier: { handle: $collectionHandle }) {
      id
      title
    }
    cartTransforms(first: 25) { nodes { id functionId } }
    validations(first: 25) { nodes { id enabled shopifyFunction { id handle } } }
    shopifyFunctions(first: 25) { nodes { id handle apiType } }
    publications(first: 50) { nodes { id name } }
  }
`;

const PRODUCT_CREATE = `#graphql
  mutation TipProductCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product { id variants(first: 1) { nodes { id } } }
      userErrors { field message }
    }
  }
`;

const VARIANT_UPDATE = `#graphql
  mutation TipVariantUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors { field message }
    }
  }
`;

const PUBLISH = `#graphql
  mutation TipProductPublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

const COLLECTION_CREATE = `#graphql
  mutation DiscountableCollectionCreate($collection: CollectionCreateInput!) {
    collectionCreate(collection: $collection) {
      collection { id }
      userErrors { field message }
    }
  }
`;

const CART_TRANSFORM_CREATE = `#graphql
  mutation TipCartTransformCreate($functionHandle: String!) {
    cartTransformCreate(functionHandle: $functionHandle, blockOnFailure: false) {
      cartTransform { id }
      userErrors { field message }
    }
  }
`;

const VALIDATION_CREATE = `#graphql
  mutation TipValidationCreate($validation: ValidationCreateInput!) {
    validationCreate(validation: $validation) {
      validation { id }
      userErrors { field message }
    }
  }
`;

interface StatusData {
  product: {
    id: string;
    status: string;
    tags: string[];
    variants: { nodes: { id: string; price: string }[] };
  } | null;
  collection: { id: string; title: string } | null;
  cartTransforms: { nodes: { id: string; functionId: string }[] };
  validations: { nodes: { id: string; enabled: boolean; shopifyFunction: { id: string; handle: string } }[] };
  shopifyFunctions: { nodes: { id: string; handle: string; apiType: string }[] };
  publications: { nodes: { id: string; name: string }[] };
}

export interface TippingStatus {
  productId: string | null;
  variantId: string | null;
  collectionId: string | null;
  cartTransformActive: boolean;
  validationActive: boolean;
  /** Function handles that aren't deployed yet (run `shopify app deploy`). */
  missingFunctions: string[];
  ready: boolean;
}

export async function loadTippingConfig(admin: AdminClient) {
  const data = await gql<{ shop: { id: string; metafield: { jsonValue: unknown } | null } }>(
    admin,
    CONFIG_QUERY,
    { key: TIPPING_CONFIG_KEY },
  );
  return { shopId: data.shop.id, config: parseTippingConfig(data.shop.metafield?.jsonValue) };
}

export async function saveTippingConfig(admin: AdminClient, shopId: string, config: TippingConfig) {
  const data = await gql<{ metafieldsSet: { userErrors: UserError[] } }>(admin, CONFIG_SET, {
    metafields: [
      {
        ownerId: shopId,
        namespace: "$app",
        key: TIPPING_CONFIG_KEY,
        type: "json",
        value: JSON.stringify(config),
      },
    ],
  });
  return userErrorMessage(data.metafieldsSet.userErrors);
}

async function fetchStatus(admin: AdminClient) {
  return gql<StatusData>(admin, STATUS_QUERY, {
    productHandle: TIP_PRODUCT_HANDLE,
    collectionHandle: DISCOUNTABLE_COLLECTION_HANDLE,
  });
}

function summarize(data: StatusData): TippingStatus {
  const fnByHandle = new Map(data.shopifyFunctions.nodes.map((f) => [f.handle, f]));
  const transformFn = fnByHandle.get(CART_TRANSFORM_HANDLE);
  const validationFn = fnByHandle.get(VALIDATION_HANDLE);
  const product = data.product?.tags.includes(TIP_PRODUCT_TAG) ? data.product : null;
  const status: TippingStatus = {
    productId: product?.id ?? null,
    variantId: product?.variants.nodes[0]?.id ?? null,
    collectionId: data.collection?.id ?? null,
    cartTransformActive: Boolean(
      transformFn && data.cartTransforms.nodes.some((t) => t.functionId === transformFn.id),
    ),
    validationActive: data.validations.nodes.some(
      (v) => v.enabled && v.shopifyFunction.handle === VALIDATION_HANDLE,
    ),
    missingFunctions: [
      ...(transformFn ? [] : [CART_TRANSFORM_HANDLE]),
      ...(validationFn ? [] : [VALIDATION_HANDLE]),
    ],
    ready: false,
  };
  status.ready = Boolean(
    status.variantId && status.collectionId && status.cartTransformActive && status.validationActive,
  );
  return status;
}

export async function getTippingStatus(admin: AdminClient) {
  return summarize(await fetchStatus(admin));
}

async function createDiscountableCollection(admin: AdminClient): Promise<{ id: string } | { error: string }> {
  const created = await gql<{ collectionCreate: { collection: { id: string } | null; userErrors: UserError[] } }>(
    admin,
    COLLECTION_CREATE,
    {
      collection: {
        title: "Discountable products",
        handle: DISCOUNTABLE_COLLECTION_HANDLE,
        descriptionHtml:
          "<p>Managed by the Coupons &amp; Tipping app. Every product except the Tip product. Coupons for “all products” target this collection.</p>",
        sources: [
          {
            source: {
              title: "All products except Tip",
              inclusion: {
                matchType: "ALL",
                conditions: [
                  { productStatus: { relation: "NOT_EQUALS", values: ["ARCHIVED"], matchType: "ANY" } },
                ],
              },
              exclusion: {
                matchType: "ANY",
                conditions: [
                  { productTag: { relation: "TAGGED_WITH", values: [TIP_PRODUCT_TAG], matchType: "ANY" } },
                ],
              },
            },
          },
        ],
      },
    },
  );
  const err = userErrorMessage(created.collectionCreate.userErrors);
  if (err || !created.collectionCreate.collection) return { error: err ?? "not created" };
  return { id: created.collectionCreate.collection.id };
}

/**
 * IDs needed to keep coupons off the tip line: the "Discountable products"
 * collection (created on first use) and the Tip product, if it exists yet.
 */
export async function ensureDiscountScope(
  admin: AdminClient,
): Promise<{ collectionId: string; tipProductId: string | null } | { error: string }> {
  const status = summarize(await fetchStatus(admin));
  let collectionId = status.collectionId;
  if (!collectionId) {
    const result = await createDiscountableCollection(admin);
    if ("error" in result) return { error: `Couldn't create the Discountable products collection: ${result.error}` };
    collectionId = result.id;
  }
  return { collectionId, tipProductId: status.productId };
}

/**
 * Create (or reuse) everything tipping needs. Safe to run again: each step
 * checks what already exists first.
 */
export async function setUpTipping(admin: AdminClient): Promise<{ status: TippingStatus; errors: string[] }> {
  const errors: string[] = [];
  let data = await fetchStatus(admin);
  let status = summarize(data);

  // 1. Hidden, untaxed, unshipped, untracked Tip product.
  if (!status.productId) {
    const created = await gql<{
      productCreate: { product: { id: string; variants: { nodes: { id: string }[] } } | null; userErrors: UserError[] };
    }>(admin, PRODUCT_CREATE, {
      product: {
        title: "Tip",
        handle: TIP_PRODUCT_HANDLE,
        productType: TIP_PRODUCT_TYPE,
        tags: [TIP_PRODUCT_TAG],
        status: "UNLISTED",
        descriptionHtml: "<p>Optional tip added at checkout.</p>",
        // Hides the product from storefront search and the sitemap.
        metafields: [{ namespace: "seo", key: "hidden", type: "number_integer", value: "1" }],
      },
    });
    const err = userErrorMessage(created.productCreate.userErrors);
    if (err || !created.productCreate.product) {
      errors.push(`Tip product: ${err ?? "not created"}`);
    } else {
      const product = created.productCreate.product;
      const variantId = product.variants.nodes[0].id;
      const updated = await gql<{ productVariantsBulkUpdate: { userErrors: UserError[] } }>(
        admin,
        VARIANT_UPDATE,
        {
          productId: product.id,
          variants: [
            {
              id: variantId,
              price: "1.00",
              taxable: false,
              inventoryPolicy: "CONTINUE",
              inventoryItem: { tracked: false, requiresShipping: false, sku: "TIP" },
            },
          ],
        },
      );
      const vErr = userErrorMessage(updated.productVariantsBulkUpdate.userErrors);
      if (vErr) errors.push(`Tip variant: ${vErr}`);

      // Checkout can only add products published to the Online Store channel.
      const onlineStore = data.publications.nodes.find((p) => p.name === "Online Store");
      if (onlineStore) {
        const published = await gql<{ publishablePublish: { userErrors: UserError[] } }>(admin, PUBLISH, {
          id: product.id,
          input: [{ publicationId: onlineStore.id }],
        });
        const pErr = userErrorMessage(published.publishablePublish.userErrors);
        if (pErr) errors.push(`Publish Tip product: ${pErr}`);
      } else {
        errors.push("Online Store publication not found; publish the Tip product to the Online Store manually.");
      }
    }
  }

  // 2. Automated collection of every product except the Tip product.
  if (!status.collectionId) {
    const result = await createDiscountableCollection(admin);
    if ("error" in result) errors.push(`Discountable products collection: ${result.error}`);
  }

  // 3. Functions. They must be deployed first (`shopify app deploy`).
  if (!status.cartTransformActive && !status.missingFunctions.includes(CART_TRANSFORM_HANDLE)) {
    const created = await gql<{ cartTransformCreate: { userErrors: UserError[] } }>(admin, CART_TRANSFORM_CREATE, {
      functionHandle: CART_TRANSFORM_HANDLE,
    });
    const err = userErrorMessage(created.cartTransformCreate.userErrors);
    if (err) errors.push(`Tip pricing function: ${err}`);
  }
  if (!status.validationActive && !status.missingFunctions.includes(VALIDATION_HANDLE)) {
    const created = await gql<{ validationCreate: { userErrors: UserError[] } }>(admin, VALIDATION_CREATE, {
      validation: {
        functionHandle: VALIDATION_HANDLE,
        enable: true,
        blockOnFailure: true,
        title: "Tip guard",
      },
    });
    const err = userErrorMessage(created.validationCreate.userErrors);
    if (err) errors.push(`Tip guard validation: ${err}`);
  }
  for (const handle of status.missingFunctions) {
    errors.push(`Function "${handle}" isn't deployed yet. Run \`shopify app deploy\`, then set up again.`);
  }

  data = await fetchStatus(admin);
  status = summarize(data);
  return { status, errors };
}

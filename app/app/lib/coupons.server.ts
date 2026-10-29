import { APP_TAG, PICKER_TAG } from "./constants";
import { gql, userErrorMessage, type AdminClient, type UserError } from "./admin.server";
import type { CouponRecord } from "./eligibility";
import type { ExistingCouponScope } from "./coupon-form";

/* ------------------------------------------------------------------ */
/* GraphQL documents                                                   */
/* ------------------------------------------------------------------ */

const CONTEXT_FIELDS = `#graphql
  context {
    __typename
    ... on DiscountCustomerSegments { segments { id name } }
  }
`;

const MINIMUM_FIELDS = `#graphql
  minimumRequirement {
    __typename
    ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } }
    ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
  }
`;

const LIST_QUERY = `#graphql
  query CouponList($query: String!) {
    discountNodes(first: 100, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        discount {
          __typename
          ... on DiscountCodeBasic {
            title
            status
            summary
            startsAt
            endsAt
            usageLimit
            asyncUsageCount
            tags
            codes(first: 1) { nodes { code } }
            ${CONTEXT_FIELDS}
            ${MINIMUM_FIELDS}
          }
        }
      }
    }
  }
`;

const DETAIL_QUERY = `#graphql
  query CouponDetail($id: ID!) {
    discountNode(id: $id) {
      id
      discount {
        __typename
        ... on DiscountCodeBasic {
          title
          status
          startsAt
          endsAt
          usageLimit
          asyncUsageCount
          appliesOncePerCustomer
          tags
          codes(first: 1) { nodes { code } }
          combinesWith { productDiscounts orderDiscounts shippingDiscounts }
          ${CONTEXT_FIELDS}
          ${MINIMUM_FIELDS}
          customerGets {
            value {
              __typename
              ... on DiscountPercentage { percentage }
              ... on DiscountAmount { amount { amount } }
            }
            items {
              __typename
              ... on DiscountProducts { products(first: 100) { nodes { id title } } }
              ... on DiscountCollections { collections(first: 100) { nodes { id title } } }
            }
          }
        }
      }
    }
  }
`;

const CREATE_MUTATION = `#graphql
  mutation CouponCreate($input: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $input) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }
`;

const UPDATE_MUTATION = `#graphql
  mutation CouponUpdate($id: ID!, $input: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $input) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }
`;

const ACTIVATE_MUTATION = `#graphql
  mutation CouponActivate($id: ID!) {
    discountCodeActivate(id: $id) { userErrors { field message } }
  }
`;

const DEACTIVATE_MUTATION = `#graphql
  mutation CouponDeactivate($id: ID!) {
    discountCodeDeactivate(id: $id) { userErrors { field message } }
  }
`;

const DELETE_MUTATION = `#graphql
  mutation CouponDelete($id: ID!) {
    discountCodeDelete(id: $id) { userErrors { field message } }
  }
`;

const SEGMENTS_QUERY = `#graphql
  query CouponSegments {
    segments(first: 250, sortKey: CREATION_DATE, reverse: true) { nodes { id name } }
  }
`;

const COLLECTION_HAS_PRODUCT_QUERY = `#graphql
  query CollectionsHaveProduct($ids: [ID!]!, $productId: ID!) {
    nodes(ids: $ids) {
      ... on Collection { id title hasProduct(id: $productId) }
    }
  }
`;

const BY_CODE_QUERY = `#graphql
  query CouponByCode($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title status summary startsAt endsAt usageLimit asyncUsageCount
          ${CONTEXT_FIELDS}
          ${MINIMUM_FIELDS}
        }
        ... on DiscountCodeFreeShipping {
          title status summary startsAt endsAt usageLimit asyncUsageCount
          ${CONTEXT_FIELDS}
          ${MINIMUM_FIELDS}
        }
        ... on DiscountCodeBxgy {
          title status summary startsAt endsAt usageLimit asyncUsageCount
          ${CONTEXT_FIELDS}
        }
        ... on DiscountCodeApp {
          title status startsAt endsAt usageLimit asyncUsageCount
          ${CONTEXT_FIELDS}
        }
      }
    }
  }
`;

const MEMBERSHIP_QUERY = `#graphql
  query CustomerSegmentMembership($customerId: ID!, $segmentIds: [ID!]!) {
    customerSegmentMembership(customerId: $customerId, segmentIds: $segmentIds) {
      memberships { segmentId isMember }
    }
  }
`;

const SHOP_QUERY = `#graphql
  query CouponShop { shop { currencyCode timezoneOffset } }
`;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ContextNode {
  __typename: string;
  segments?: { id: string; name: string }[];
}

interface MinimumNode {
  __typename: string;
  greaterThanOrEqualToSubtotal?: { amount: string };
  greaterThanOrEqualToQuantity?: string;
}

interface BaseDiscount {
  __typename: string;
  title: string;
  status: "ACTIVE" | "EXPIRED" | "SCHEDULED";
  summary?: string;
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  asyncUsageCount: number;
  context: ContextNode;
  minimumRequirement?: MinimumNode | null;
}

interface ListDiscount extends BaseDiscount {
  tags: string[];
  codes: { nodes: { code: string }[] };
}

export interface CouponListItem {
  id: string;
  title: string;
  code: string;
  status: BaseDiscount["status"];
  summary: string;
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  usageCount: number;
  audience: "Everyone" | string;
  inPicker: boolean;
}

/* ------------------------------------------------------------------ */
/* Mapping helpers                                                     */
/* ------------------------------------------------------------------ */

function audienceOf(context: ContextNode): CouponRecord["audience"] {
  switch (context.__typename) {
    case "DiscountBuyerSelectionAll":
      return "all";
    case "DiscountCustomerSegments":
      return "segment";
    case "DiscountCustomers":
      return "customers";
    case "DiscountMarkets":
      return "markets";
    default:
      return "unknown";
  }
}

export function toCouponRecord(id: string, code: string, d: BaseDiscount): CouponRecord {
  const min = d.minimumRequirement;
  return {
    id,
    code,
    title: d.title,
    summary: d.summary ?? "",
    status: d.status,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    usageLimit: d.usageLimit,
    usageCount: d.asyncUsageCount,
    audience: audienceOf(d.context),
    segmentIds: d.context.segments?.map((s) => s.id) ?? [],
    minimumSubtotal: min?.greaterThanOrEqualToSubtotal
      ? Number(min.greaterThanOrEqualToSubtotal.amount)
      : null,
    minimumQuantity: min?.greaterThanOrEqualToQuantity
      ? Number(min.greaterThanOrEqualToQuantity)
      : null,
  };
}

const firstError = (payload: { userErrors: UserError[] }) => userErrorMessage(payload.userErrors);

/* ------------------------------------------------------------------ */
/* Admin dashboard                                                     */
/* ------------------------------------------------------------------ */

export async function listCoupons(admin: AdminClient): Promise<CouponListItem[]> {
  const data = await gql<{ discountNodes: { nodes: { id: string; discount: ListDiscount }[] } }>(
    admin,
    LIST_QUERY,
    { query: `tag:${APP_TAG}` },
  );
  return data.discountNodes.nodes
    .filter((n) => n.discount.__typename === "DiscountCodeBasic")
    .map(({ id, discount: d }) => ({
      id,
      title: d.title,
      code: d.codes.nodes[0]?.code ?? "",
      status: d.status,
      summary: d.summary ?? "",
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      usageLimit: d.usageLimit,
      usageCount: d.asyncUsageCount,
      audience:
        d.context.__typename === "DiscountCustomerSegments"
          ? (d.context.segments ?? []).map((s) => s.name).join(", ")
          : "Everyone",
      inPicker: d.tags.includes(PICKER_TAG),
    }));
}

export interface CouponDetail {
  id: string;
  title: string;
  code: string;
  status: BaseDiscount["status"];
  startsAt: string;
  endsAt: string | null;
  usageLimit: number | null;
  oncePerCustomer: boolean;
  valueType: "percentage" | "fixed";
  value: number;
  minimumType: "none" | "subtotal" | "quantity";
  minimumValue: number | null;
  scope: ExistingCouponScope;
  products: { id: string; title: string }[];
  collections: { id: string; title: string }[];
  showInPicker: boolean;
  combinesWith: { productDiscounts: boolean; orderDiscounts: boolean; shippingDiscounts: boolean };
}

export async function getCoupon(
  admin: AdminClient,
  id: string,
  discountableCollectionId: string | null,
): Promise<CouponDetail | null> {
  type Detail = ListDiscount & {
    appliesOncePerCustomer: boolean;
    combinesWith: CouponDetail["combinesWith"];
    customerGets: {
      value: { __typename: string; percentage?: number; amount?: { amount: string } };
      items: {
        __typename: string;
        products?: { nodes: { id: string; title: string }[] };
        collections?: { nodes: { id: string; title: string }[] };
      };
    };
  };
  const data = await gql<{ discountNode: { id: string; discount: Detail } | null }>(
    admin,
    DETAIL_QUERY,
    { id },
  );
  const node = data.discountNode;
  if (!node || node.discount.__typename !== "DiscountCodeBasic") return null;
  const d = node.discount;
  if (!d.tags.includes(APP_TAG)) return null;

  const products = d.customerGets.items.products?.nodes ?? [];
  const collections = d.customerGets.items.collections?.nodes ?? [];
  const isAll =
    d.customerGets.items.__typename === "AllDiscountItems" ||
    (collections.length === 1 && collections[0].id === discountableCollectionId);
  const appliesTo: ExistingCouponScope["appliesTo"] = isAll
    ? "all"
    : d.customerGets.items.__typename === "DiscountProducts"
      ? "products"
      : "collections";
  const min = d.minimumRequirement;
  const value = d.customerGets.value;

  return {
    id: node.id,
    title: d.title,
    code: d.codes.nodes[0]?.code ?? "",
    status: d.status,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    usageLimit: d.usageLimit,
    oncePerCustomer: d.appliesOncePerCustomer,
    valueType: value.__typename === "DiscountPercentage" ? "percentage" : "fixed",
    value:
      value.__typename === "DiscountPercentage"
        ? Math.round((value.percentage ?? 0) * 10000) / 100
        : Number(value.amount?.amount ?? 0),
    minimumType:
      min?.__typename === "DiscountMinimumSubtotal"
        ? "subtotal"
        : min?.__typename === "DiscountMinimumQuantity"
          ? "quantity"
          : "none",
    minimumValue: min?.greaterThanOrEqualToSubtotal
      ? Number(min.greaterThanOrEqualToSubtotal.amount)
      : min?.greaterThanOrEqualToQuantity
        ? Number(min.greaterThanOrEqualToQuantity)
        : null,
    scope: {
      appliesTo,
      productIds: products.map((p) => p.id),
      collectionIds: appliesTo === "collections" ? collections.map((c) => c.id) : [],
      visibility: d.context.__typename === "DiscountCustomerSegments" ? "segment" : "global",
      segmentIds: d.context.segments?.map((s) => s.id) ?? [],
    },
    products,
    collections: appliesTo === "collections" ? collections : [],
    showInPicker: d.tags.includes(PICKER_TAG),
    combinesWith: d.combinesWith,
  };
}

export async function createCoupon(admin: AdminClient, input: Record<string, unknown>) {
  const data = await gql<{
    discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: UserError[] };
  }>(admin, CREATE_MUTATION, { input });
  const error = firstError(data.discountCodeBasicCreate);
  return error ? { error } : { id: data.discountCodeBasicCreate.codeDiscountNode!.id };
}

export async function updateCoupon(admin: AdminClient, id: string, input: Record<string, unknown>) {
  const data = await gql<{
    discountCodeBasicUpdate: { codeDiscountNode: { id: string } | null; userErrors: UserError[] };
  }>(admin, UPDATE_MUTATION, { id, input });
  const error = firstError(data.discountCodeBasicUpdate);
  return error ? { error } : { id };
}

export async function setCouponActive(admin: AdminClient, id: string, active: boolean) {
  if (active) {
    const data = await gql<{ discountCodeActivate: { userErrors: UserError[] } }>(
      admin,
      ACTIVATE_MUTATION,
      { id },
    );
    return firstError(data.discountCodeActivate);
  }
  const data = await gql<{ discountCodeDeactivate: { userErrors: UserError[] } }>(
    admin,
    DEACTIVATE_MUTATION,
    { id },
  );
  return firstError(data.discountCodeDeactivate);
}

export async function deleteCoupon(admin: AdminClient, id: string) {
  const data = await gql<{ discountCodeDelete: { userErrors: UserError[] } }>(
    admin,
    DELETE_MUTATION,
    { id },
  );
  return firstError(data.discountCodeDelete);
}

/** Only allow deleting/toggling discounts this app created. */
export async function isAppCoupon(admin: AdminClient, id: string) {
  const data = await gql<{ discountNode: { discount: { __typename: string; tags?: string[] } } | null }>(
    admin,
    `#graphql
      query CouponOwnership($id: ID!) {
        discountNode(id: $id) {
          discount { __typename ... on DiscountCodeBasic { tags } }
        }
      }`,
    { id },
  );
  return Boolean(data.discountNode?.discount.tags?.includes(APP_TAG));
}

export async function listSegments(admin: AdminClient) {
  const data = await gql<{ segments: { nodes: { id: string; name: string }[] } }>(
    admin,
    SEGMENTS_QUERY,
  );
  return [...data.segments.nodes].sort((a, b) => a.name.localeCompare(b.name));
}

export async function getShopBasics(admin: AdminClient) {
  const data = await gql<{ shop: { currencyCode: string; timezoneOffset: string } }>(
    admin,
    SHOP_QUERY,
  );
  return data.shop;
}

/** Names of selected collections that contain the Tip product (must be empty to save). */
export async function collectionsContainingProduct(
  admin: AdminClient,
  collectionIds: string[],
  productId: string,
) {
  if (collectionIds.length === 0) return [];
  const data = await gql<{ nodes: ({ id: string; title: string; hasProduct: boolean } | null)[] }>(
    admin,
    COLLECTION_HAS_PRODUCT_QUERY,
    { ids: collectionIds, productId },
  );
  return data.nodes.filter((n): n is NonNullable<typeof n> => Boolean(n?.hasProduct)).map((n) => n.title);
}

/* ------------------------------------------------------------------ */
/* Storefront (app proxy)                                              */
/* ------------------------------------------------------------------ */

export async function listPickerCoupons(admin: AdminClient): Promise<CouponRecord[]> {
  const data = await gql<{ discountNodes: { nodes: { id: string; discount: ListDiscount }[] } }>(
    admin,
    LIST_QUERY,
    { query: `tag:${PICKER_TAG} status:active` },
  );
  return data.discountNodes.nodes
    .filter((n) => n.discount.__typename === "DiscountCodeBasic" && n.discount.tags.includes(APP_TAG))
    .map((n) => toCouponRecord(n.id, n.discount.codes.nodes[0]?.code ?? "", n.discount));
}

export async function findCouponByCode(admin: AdminClient, code: string): Promise<CouponRecord | null> {
  const data = await gql<{
    codeDiscountNodeByCode: { id: string; codeDiscount: BaseDiscount } | null;
  }>(admin, BY_CODE_QUERY, { code });
  const node = data.codeDiscountNodeByCode;
  return node ? toCouponRecord(node.id, code, node.codeDiscount) : null;
}

export async function memberSegmentIds(
  admin: AdminClient,
  customerId: string,
  segmentIds: string[],
): Promise<string[]> {
  if (segmentIds.length === 0) return [];
  const data = await gql<{
    customerSegmentMembership: { memberships: { segmentId: string; isMember: boolean }[] };
  }>(admin, MEMBERSHIP_QUERY, { customerId, segmentIds });
  return data.customerSegmentMembership.memberships
    .filter((m) => m.isMember)
    .map((m) => m.segmentId);
}

/** Tag on every discount code this app manages. */
export const APP_TAG = "coupon-app";
/** Tag on discount codes that the storefront coupon picker lists. */
export const PICKER_TAG = "coupon-picker";

/** Product type and tag of the hidden Tip product. */
export const TIP_PRODUCT_TYPE = "Tip";
export const TIP_PRODUCT_TAG = "app-tip";
export const TIP_PRODUCT_HANDLE = "tip";

/** Handle of the automated collection "every product except the Tip product". */
export const DISCOUNTABLE_COLLECTION_HANDLE = "discountable-products";

/** Cart line attribute holding the chosen tip amount (read by the cart transform). */
export const TIP_AMOUNT_ATTRIBUTE = "_tip_amount";

/** App-owned metafields (namespace `$app`). */
export const TIPPING_CONFIG_KEY = "tipping_config";
export const ALLOWED_TIPPING_KEY = "allowed_tipping";

/** Function handles (folder handles under extensions/). */
export const CART_TRANSFORM_HANDLE = "tip-price";
export const VALIDATION_HANDLE = "tip-guard";

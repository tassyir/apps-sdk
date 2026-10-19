---
'@tassyir/app': minor
---

Order money, typed: an `Order` carries `subtotal`, `discountTotal` and `discounts` (one entry per title, code, class and source), and each order line `originalPrice`, `discountAmount` and `discounts`, so `total = subtotal − discountTotal + shippingPrice` and a line's `unitPrice`/`totalPrice` are net of the offers. The `Discount` and `OrderItem` types are exported, `?fields=` accepts the three new names, and `orders/*` webhook bodies carry the same fields: `verifyWebhook` narrows them, and `changed` on `orders/updated` can now name `subtotal`, `discountTotal` and `discounts`, so keep a default branch if you switch over it. Additive inside `2026-10`; the Admin API types follow the API's OpenAPI document at backend `505f4ac4`; no new scope or error code.

---
'@tassyir/dev-mcp': patch
---

The server knows the order money: the `Order` schema (`get_api_operation`) and the `orders/*` topics (`get_event_schema`) carry `subtotal`, `discountTotal`, `discounts` and the per-line `originalPrice`, `discountAmount` and `discounts`, and the Orders guide gains an "Order money" section.

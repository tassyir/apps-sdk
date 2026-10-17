---
'tassyir': minor
---

`tassyir webhook trigger` accepts `offers/created`, `offers/updated` and `offers/deleted` (they need `read_offers`; the manifest checks know the scope). The developer API types follow the API's OpenAPI document at backend `5cfe4ee3`, which also carries the ratings operations (`listAppRatings`, `replyToAppRating`, `deleteAppRatingReply`, `reportAppRating`) the previous copy predated.

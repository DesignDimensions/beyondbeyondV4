# Review intake endpoint

`reviews-endpoint.php` is the only piece of the reviews feature that cannot live
in the theme. Writing a review means writing a product metafield, that needs an
Admin API token, and a storefront cannot hold one — so the write happens here
instead, on a server the public cannot read.

Nothing else in this folder is deployed to Shopify. The theme ignores it.

## Setting it up

1. **Put the token above the web root.** On the cPanel account, create

       /home1/a178436f/shopify-review-token

   containing the Admin API access token on one line and nothing else, then
   `chmod 600` it. Anything under `public_html` can be served as plain text if
   PHP is ever misconfigured, which is why it does not go there.

   Note the host puts accounts under `/home1`, not `/home` — a path with the
   wrong one reads as "Server not configured."

2. **Point the script at it.** `TOKEN_FILE` is already set to that path. It only
   needs changing if the account moves.

3. **Upload** `reviews-endpoint.php` to the folder the domain serves it from:

       /home1/a178436f/public_html/bb_product_ratings/reviews-endpoint.php

4. **Check the allowed origins.** `ALLOWED_ORIGINS` lists the domains whose
   storefront may post here. Add or remove as the store's domains change.

   The storefront is on Shopify at `beyondbeyond.co.in`; this cPanel account
   serves `designdimensions.in`. They are two different servers, which is why
   the endpoint is on the second and `ALLOWED_ORIGINS` names the first — the
   browser posts across origins and CORS is what permits it.

5. **Tell the theme where it is.** In the theme editor, open the Product Reviews
   section and put the full URL into **Review form endpoint**:

       https://designdimensions.in/bb_product_ratings/reviews-endpoint.php

   Until that setting is filled in, the form tells the visitor it is not
   connected rather than appearing to send.

## What it does with a submission

- Refuses anything that is not a POST from an allowed origin.
- Drops robots silently via the form's honeypot field, answering as though it
  worked so there is nothing to learn from being refused.
- Holds each IP to one review a minute.
- **Never stores the email.** It is used once, to look up whether an order for
  that address contains this product, and then discarded. The metafield is
  readable from the storefront, so a customer's address must not be in it.
- Sets `"verified": true` only when that order lookup actually found the
  product. No email, no claim.
- Prepends the review to `custom.product_reviews` and caps the list at 300, well
  under the 64KB a metafield value can hold.

## Moderation

`AUTO_APPROVE` at the top decides whether a new review appears at once. Set it
to `false` and reviews arrive with `"approved": false`; the section only renders
approved ones, so each is held until someone sets it to `true` in the product's
metafield in the Shopify admin.

Deleting a review is deleting its object from that JSON array.

**Every review needs an `approved` key.** The section filters on it, so an entry
typed by hand without one will not appear.

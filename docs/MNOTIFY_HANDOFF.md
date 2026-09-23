# MNotify order-status messages

MNotify should be called only from the deployed `updateOrderStatus` Cloud Function, never from the browser. The admin portal changes an order through `unfulfilled → processing → fulfilled` (or `cancelled`); after a successful state change, the function should send the corresponding SMS to `order.customer.phone`.

When the MNotify API details arrive, add these Firebase secrets:

- `MNOTIFY_API_KEY`
- `MNOTIFY_SENDER_ID`

The integration should use the current MNotify API endpoint and the client-approved sender ID/template. Do not log the API key or the full message payload. Persist only delivery-safe metadata on the order, such as `notification.status`, `notification.lastStatus`, `notification.sentAt`, and a provider message ID. Failed sends must not roll back the fulfilment status; flag them for admin retry instead.

Suggested message content for approval:

- `processing`: `Nakuadiary: your order {reference} is being prepared. We will update you when it is ready.`
- `fulfilled`: `Nakuadiary: your order {reference} is ready for {deliveryPreference}. Thank you for shopping with us.`
- `cancelled`: `Nakuadiary: please contact us about order {reference}.`

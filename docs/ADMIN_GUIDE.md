# Running Nakuadiary — owner's guide

A plain-language guide to the admin portal at **/admin** (or tap "Admin login" in the website footer). Everything here works on a phone.

---

## First-time setup checklist

1. **Settings → Contact:** your real WhatsApp number and email. Every WhatsApp and email button on the site uses these.
2. **Settings → Delivery:** how delivery is priced (see *Delivery fees* below), plus your pickup location and hours.
3. **Settings → Policies:** your return window (in days) and how long orders take to dispatch. These appear on the Delivery and Returns pages.
4. **Notifications:** your approved sender ID and your own phone number for new-order alerts.
5. **Read the policy pages** (links in the website footer) and change anything that doesn't match how you work. Ideally, have a lawyer look them over.

---

## Orders

**Orders** lists every order, newest first. Tap **View** to open one.

What an order shows you:
- **Customer and delivery:** name, phone (tap to call), delivery or pickup, area and address.
- **Payment confirmation:** the Paystack reference, amount received, method (Mobile Money or card) and when it was paid.
- **Items:** a photo of each item, the length, quantity and price, with subtotal, delivery and total.
- **Order timeline:** every status change, when it happened and who made it.
- **Customer texts (SMS):** which texts were sent, with a **Resend** button if one failed.

**Moving an order along:**

| Status | Meaning | What you do next |
|---|---|---|
| Awaiting payment | Customer is at the payment page | Nothing. It becomes *Paid* automatically, or is released after 60 minutes |
| Paid | Money received | **Start processing** |
| Processing | You're preparing it | **Mark dispatched** (delivery) or **Mark delivered** (pickup collected) |
| Dispatched | With the rider | **Mark delivered** |
| Delivered | Done | — |
| Payment failed / Cancelled | Closed | — |

Add an optional **note** before changing status, e.g. *"Rider: Kwame, 024…"*. It's saved in the timeline.

The customer gets an SMS automatically at **Paid**, **Processing**, **Dispatched** and **Delivered**.

**Cancelling:** **Cancel order** returns the stock to your shelves. If the order was already paid, it's marked **Refund due**. Refund the customer from your **Paystack dashboard** using the Paystack reference shown on the order.

**"Need attention" alerts** (shown in red):
- **Refund due:** a paid order was cancelled. Issue the refund in Paystack.
- **Stock issue:** a payment arrived after its 60-minute hold ran out and the stock had already sold. Restock it, or cancel and refund.
- **Amount mismatch:** Paystack reported a different amount than the order total. The order was **not** marked paid. Check it in Paystack.

---

## Stock

**Stock** is the quickest way to update quantities:
- **+1 / +5 / +10** when a delivery arrives.
- **−** to remove one (for example, a damaged piece).
- **Set to…** to type the exact count after a stock take.

Colours: **green** means in stock, **amber** means 3 or fewer left, **red** means sold out. Tick **Low stock only** to see just what needs reordering.

When a length hits 0, shoppers see it as **Sold out** and can't buy it. Stock goes down automatically when an order is paid, and comes back if the order is cancelled or never paid.

---

## Products

**Products → + Add product** (or **Edit**):
- **Photos:** upload straight from your phone. Big photos are shrunk automatically. The first photo is the one shoppers see first.
- **Retail price / Wholesale price:** the default prices.
- **Variants (lengths/options):** each length has its own stock and, optionally, its own price, for example if 26" costs more than 18". Leave a length's price empty to use the default.
- **Texture / style tags:** e.g. *Body wave*, *HD lace*. Shoppers filter the shop by these. Tap a suggestion to add it; reuse existing tags so spelling stays consistent.
- **Featured:** shows the product in *Best sellers* on the homepage.
- **Active:** untick to hide a product without deleting it.

---

## Customers and wholesale

**Customers** builds itself from paid orders.

To open a wholesale account, tap **+ Create wholesale account**. Send the customer the **temporary password** shown, by WhatsApp or SMS. It's only shown once. They sign in with **Sign in** on the website to see wholesale prices, and can change their password with **Forgot password?**.

---

## Website content

- **Homepage:** every heading, paragraph, button and photo on the homepage. Each section has a **Show** switch. Put a word in `*asterisks*` to show it in the pink script style.
- **Settings:** logo, contact details, social links, announcement bar, delivery pricing, policies, colours, and how the site appears in Google and WhatsApp previews.

Changes go live as soon as you tap **Save**. Refresh the website to see them.

### Delivery fees (Settings → Delivery)

| Option | What customers see |
|---|---|
| Arrange after the order | No fee online; you agree it with them after they order |
| Free delivery | Free |
| One flat fee | The same fee for everyone, added before they pay |
| Fee by area | They pick their area at checkout; that area's fee is added |

Areas are typed one per line, like `East Legon | 30`. **Free delivery over** makes delivery free above an order value. Pickup is always free.

---

## Notifications

- **Sending:** your **sender ID** (up to 11 characters), approved in your MNotify/BMS dashboard.
- **New-order alerts:** your phone number. You get a text for every paid order.
- **Message wording:** customise any text, or leave it empty for the default. Placeholders: `{name}`, `{reference}`, `{deliveryPreference}`, `{itemCount}`, `{total}`.

If a text shows **Not sent (SMS off)** on an order, texting wasn't switched on at the time. Open the order and tap **Resend** once it is.

---

## Passwords

Forgot your admin password? Tap **Forgot password?** on the admin login, enter your email, and follow the link sent to you. Wholesale customers can do the same from **Sign in** on the website.

---

## Getting help

The technical runbook for your developer is in `docs/OPERATIONS.md`.

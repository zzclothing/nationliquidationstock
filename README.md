# Nation Liquidation Stock

Server-rendered B2B liquidation marketplace built with Node.js, Express, EJS, and a collection-based storage layer that can run on JSON files locally or PostgreSQL in production.

## Stack

- Backend: Express
- Views: EJS
- Auth: Session-based
- Storage: JSON files in `data/` locally, PostgreSQL when `DATABASE_URL` is set
- Payments: Mock payment flow with Stripe placeholder option
- Images: Cloudinary URLs or local uploads to `public/uploads/`

## Demo Accounts

- Buyer: `buyer@nationliquidationstock.com` / `Buy12345!`
- Admin: `admin@nationliquidationstock.com` / `Admin12345!`
- Unverified buyer: `pending@nationliquidationstock.com` / `BuyerNew123!`

## Project Structure

- `server.js`: app bootstrap
- `app2.js`: main Express app, routes, auth, checkout, admin, APIs
- `data/`: JSON database files
- `public/css/styles.css`: site styling
- `public/uploads/`: local image uploads
- `views/`: EJS templates

## Key Routes

- `/`: homepage with featured pallets
- `/products`: listing, filters, sorting, keyword search
- `/products/:slug`: product detail, manifest, reviews, shipping estimate
- `/dashboard`: buyer dashboard with saved pallets and order history
- `/checkout/:id`: checkout and purchase flow
- `/admin`: catalog management, analytics, orders, inquiries

## API Routes

- `GET /api/products`
- `GET /api/products/:id`
- `GET /api/shipping-estimate`
- `POST /api/checkout/:id`
- `GET /api/admin/analytics`
- `POST /api/admin/products`
- `PUT /api/admin/products/:id`
- `DELETE /api/admin/products/:id`

## Data Collections

- `users.json`: buyers/admins, saved pallets, verification state
- `products.json`: pallet/truckload catalog, pricing, manifests, images
- `orders.json`: paid orders and shipping/payment snapshots
- `reviews.json`: platform product reviews
- `inquiries.json`: customer inquiry queue
- `email-verifications.json`: verification tokens
- `password-resets.json`: reset tokens

## Run

1. `npm install`
2. `npm start`

## Render Persistence

- Keep `CLOUDINARY_URL` configured so photos uploaded from your phone or computer are stored on Cloudinary instead of Render's temporary filesystem.
- Add a PostgreSQL database and set `DATABASE_URL` in Render so inventory, categories, users, orders, and reviews survive free-plan restarts and redeploys.
- With `DATABASE_URL` set, login sessions are also stored in PostgreSQL so admin and buyer sessions can survive Render restarts until the session cookie expires.
- On first boot with `DATABASE_URL`, the app seeds PostgreSQL from the existing local `data/*.json` files if those collections are not already present.
- If your PostgreSQL provider requires it, leave SSL enabled by default or set `DATABASE_SSL=false` only for local development.

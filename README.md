# Order Processing Monday App

A monday.com item view app built with **Next.js 15** that allows processing single orders — selecting suppliers and couriers, generating manifest PDFs and shipping label PDFs, and uploading them directly to monday.com boards.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
- [Monday Boards Required](#monday-boards-required)
- [Environment Variables](#environment-variables)
- [Local Development Setup](#local-development-setup)
- [Monday Code Deployment](#monday-code-deployment)
- [API Routes](#api-routes)
- [Key Files Explained](#key-files-explained)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| UI Components | shadcn/ui, react-select, react-hot-toast, lucide-react |
| Monday Integration | monday-sdk-js (frontend context), Monday GraphQL API (backend) |
| PDF Generation | jsPDF (pure JS, no browser needed) |
| PDF Merging | pdf-lib |
| File Upload | form-data (multipart upload to monday.com) |
| Courier API | Shiprocket API |
| Hosting | monday code (single Next.js service) |

---

## Project Structure

```
/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Main UI - item view app
│   │   ├── layout.tsx                  # Root layout
│   │   ├── globals.css                 # Global styles
│   │   └── api/                        # Next.js API routes (server-side)
│   │       ├── order/route.ts          # GET  /api/order?itemId=
│   │       ├── get-couriers/route.ts   # POST /api/get-couriers
│   │       ├── sort_couriers/route.ts  # POST /api/sort_couriers
│   │       ├── generate-manifest/route.ts  # POST /api/generate-manifest
│   │       └── generate-label/route.ts     # POST /api/generate-label
│   ├── lib/
│   │   ├── orders.ts                   # Core business logic (PDF, Monday writes)
│   │   ├── mondayUtils.ts              # Monday GraphQL helpers + sorting algorithms
│   │   └── utils.ts                    # shadcn utility
│   └── components/
│       └── ui/                         # shadcn components
│           ├── button.tsx
│           ├── card.tsx
│           ├── confirmDialog.tsx
│           ├── dialog.tsx
│           ├── select.tsx
│           ├── command.tsx
│           └── separator.tsx
├── backend-node/                       # Standalone Node.js backend (optional/reference)
│   ├── server.js                       # Express server
│   ├── orders.js                       # Business logic
│   ├── utils/mondayUtils.js            # Monday helpers
│   └── templates/                      # HTML templates (reference only)
├── public/                             # Static assets
├── .env                                # Environment variables (local only)
├── next.config.js                      # Next.js config
├── monday.yml                          # Monday code deployment config
├── package.json
└── tsconfig.json
```

---

## How It Works

### User Flow

```
User opens item view in monday.com
        ↓
monday-sdk-js reads boardId + itemId from context
        ↓
/api/order fetches order + line items + customer + suppliers from monday boards
        ↓
User selects Supplier per line item
        ↓
/api/get-couriers calls Shiprocket API for available couriers
        ↓
/api/sort_couriers ranks couriers by weighted score (rating + speed + cost)
        ↓
User selects Courier per line item
        ↓
User clicks "Generate Manifest & Label"
        ↓
/api/generate-manifest:
  1. Creates supplier manifest record on monday board
  2. Generates manifest PDF (jsPDF)
  3. Uploads PDF to manifest board file column
  4. Updates each line item status → "Manifest Generated"
        ↓
/api/generate-label:
  1. Generates label PDF per line item (jsPDF)
  2. Merges all label PDFs (pdf-lib)
  3. Uploads merged PDF to manifest board label column
```

### Supplier Sorting Algorithm

Suppliers are ranked using a weighted score:
```
score = (0.55 × normalized_price_score) + (0.45 × normalized_rating_score)
```
- Self-suppliers (marked with `Self = "v"`) are always placed first
- Weights are fetched dynamically from monday board items (`Supplier_Sorting`, `Courier_Sorting`)

### Courier Sorting Algorithm

Couriers are ranked using:
```
score = (0.35 × rating_score) + (0.25 × speed_score) + (0.40 × cost_score)
```
- All scores are min-max normalized before weighting
- Weights are fetched dynamically from monday board items

---

## Monday Boards Required

You need **5 boards** set up in monday.com:

### 1. Orders Board (`ORDERS_BOARD_ID`)
The main orders board. The item view app is attached here.

| Column Title | Type | Notes |
|---|---|---|
| Status | Status | Order status |
| Date | Date | Order date |
| OrderId | Text | Order identifier |
| Description | Text | Order description |
| TotalPrice | Number | Total order value |
| Customers | Connect Boards | Links to Customers board |
| CustomerPostalCode | Text | Customer postal code |

### 2. Order Line Items Board (`ORDER_LINE_ITEMS_BOARD_ID`)
Each row is a product line item linked to an order.

| Column Title | Type | Notes |
|---|---|---|
| Order | Connect Boards | Links to Orders board |
| Product | Connect Boards | Links to Supplier Products board |
| OrderNumber | Text | Order number |
| SKU | Text | Product SKU |
| Quantity | Number | Quantity ordered |
| UnitPrice | Number | Price per unit |
| ListPrice | Number | List price |
| Status | Status | Must support `"Manifest Generated"` label |
| Supplier | Connect Boards | Links to Suppliers board |
| courierId | Text | Courier ID (written by app) |
| courier | Text | Courier name (written by app) |
| Product Weight | Mirror | Mirrored from product |
| lookup_mks1f46y | Lookup | Product code lookup |

### 3. Supplier Products Board (`SUPPLIER_PRODUCT_BOARD_ID`)
Maps products to suppliers with pricing.

| Column Title | Type | Notes |
|---|---|---|
| Product | Connect Boards | Links to Products board |
| Supplier | Connect Boards | Links to Suppliers board |
| SupplierName | Text | Supplier display name |
| Supplier Address | Text | Supplier address |
| Supplier Phone | Text | Supplier phone |
| Postal Code | Text | Supplier postal code |
| Rate(Per Unit) | Number | Price per unit |
| Product Weight | Number | Weight in kg |
| Supplier Market Rating | Number | Rating (0-5) |
| Self | Checkbox | Check if this is a self-supplier |

### 4. Supplier Manifest Board (`SUPPLIER_MANIFEST_BOARD_ID`)
Stores generated manifests and labels.

| Column Title | Type | Notes |
|---|---|---|
| Orders | Text | Comma-separated order numbers |
| Suppliers | Connect Boards | Links to Suppliers board |
| `file_mksncam` | File | Manifest PDF column (use your column ID) |
| `file_mkv0thgs` | File | Label PDF column (use your column ID) |

### 5. Sorting Config Board (contains `SUPPLIER_SORTING_ITEM_ID` and `COURIER_SORTING_ITEM_ID`)
Two items that store the sorting weights.

**Item name: `Supplier_Sorting`**
| Column Title | Type |
|---|---|
| Price | Number (0-1) |
| Rating | Number (0-1) |

**Item name: `Courier_Sorting`**
| Column Title | Type |
|---|---|
| Price | Number (0-1) |
| Rating | Number (0-1) |
| Estimated Delivery Days | Number (0-1) |

> Weights must sum to 1.0 for accurate scoring.

---

## Environment Variables

### For monday code — set these in the monday code dashboard under your app's environment variables:

| Variable | Description | Example |
|---|---|---|
| `MONDAY_API_KEY` | monday.com API token | `eyJhbGci...` |
| `MONDAY_API_URL` | monday.com GraphQL endpoint | `https://api.monday.com/v2` |
| `ORDER_LINE_ITEMS_BOARD_ID` | Board ID of line items board | `2028904077` |
| `SUPPLIER_MANIFEST_BOARD_ID` | Board ID of manifest board | `2031231767` |
| `SUPPLIER_PRODUCT_BOARD_ID` | Board ID of supplier products board | `2026788711` |
| `ORDERS_BOARD_ID` | Board ID of orders board | `2023614902` |
| `SUPPLIER_MANIFEST_BOARD_MANIFEST_FILE_COLID` | Column ID for manifest PDF file | `file_mksncam` |
| `SUPPLIER_MANIFEST_BOARD_LABEL_FILE_COLID` | Column ID for label PDF file | `file_mkv0thgs` |
| `SUPPLIER_MANIFEST_BOARD_ORDER_LINE_ITEM_COLID` | Column ID for order line item relation | `board_relation_mksn5vvd` |
| `SUPPLIER_SORTING_ITEM_ID` | Item ID of `Supplier_Sorting` config row | `5008187177` |
| `COURIER_SORTING_ITEM_ID` | Item ID of `Courier_Sorting` config row | `5008187272` |
| `SHIPROCKET_EMAIL` | Shiprocket account email | `your@email.com` |
| `SHIPROCKET_PASSWORD` | Shiprocket account password | `yourpassword` |

### For local development only (`.env` file, never commit):

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_LOCAL_TEST` | Set to `true` to skip monday SDK context |
| `NEXT_PUBLIC_LOCAL_ITEM_ID` | The order item ID to load during local testing |

---

## Local Development Setup

### Prerequisites
- Node.js 18+
- A monday.com account with the boards set up above
- A Shiprocket account

### Steps

**1. Clone and install**
```bash
git clone <repo-url>
cd monday-single-order-processing
npm install
```

**2. Set up environment variables**

Create a `.env` file in the root:
```env
NEXT_PUBLIC_LOCAL_TEST=true
NEXT_PUBLIC_LOCAL_ITEM_ID=<your_order_item_id>

MONDAY_API_KEY=<your_monday_api_key>
MONDAY_API_URL=https://api.monday.com/v2

ORDER_LINE_ITEMS_BOARD_ID=<board_id>
SUPPLIER_MANIFEST_BOARD_ID=<board_id>
SUPPLIER_PRODUCT_BOARD_ID=<board_id>
ORDERS_BOARD_ID=<board_id>

SUPPLIER_MANIFEST_BOARD_MANIFEST_FILE_COLID=<column_id>
SUPPLIER_MANIFEST_BOARD_LABEL_FILE_COLID=<column_id>
SUPPLIER_MANIFEST_BOARD_ORDER_LINE_ITEM_COLID=<column_id>

SUPPLIER_SORTING_ITEM_ID=<item_id>
COURIER_SORTING_ITEM_ID=<item_id>

SHIPROCKET_EMAIL=<email>
SHIPROCKET_PASSWORD=<password>
```

**3. Run the dev server**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

> When `NEXT_PUBLIC_LOCAL_TEST=true`, the app uses `NEXT_PUBLIC_LOCAL_ITEM_ID` directly instead of reading from monday SDK context. Set this to a real order item ID from your monday board.

**4. Before deploying — disable local test mode**
```env
NEXT_PUBLIC_LOCAL_TEST=false
```

---

## Monday Code Deployment

### Prerequisites
- monday apps CLI installed: `npm install -g @mondaycom/apps-cli`
- Logged in: `mapps init`

### Steps

**1. Make sure `monday.yml` is at the root:**
```yaml
version: "1"

services:
  - name: frontend
    type: node
    path: .
    build:
      command: npm install && npm run build
    run:
      command: npm start
    env:
      - MONDAY_API_KEY
      - MONDAY_API_URL
      - ORDER_LINE_ITEMS_BOARD_ID
      - SUPPLIER_MANIFEST_BOARD_ID
      - SUPPLIER_PRODUCT_BOARD_ID
      - ORDERS_BOARD_ID
      - SUPPLIER_MANIFEST_BOARD_MANIFEST_FILE_COLID
      - SUPPLIER_MANIFEST_BOARD_LABEL_FILE_COLID
      - SUPPLIER_MANIFEST_BOARD_ORDER_LINE_ITEM_COLID
      - SUPPLIER_SORTING_ITEM_ID
      - COURIER_SORTING_ITEM_ID
      - SHIPROCKET_EMAIL
      - SHIPROCKET_PASSWORD
```

**2. Set environment variables in monday code dashboard**

Go to your app → monday code → Environment Variables → add all variables listed in the table above.

**3. Deploy**
```bash
mapps code:push
```

Select your app and version when prompted.

**4. Set the app URL**

After deployment, monday code gives you a URL. Set it as the item view URL in your app's feature settings.

### Important Rules for monday code

- Use `next.config.js` not `next.config.ts` — monday code does not support TypeScript config files
- Service type must be `node` not `frontend` — Next.js requires a Node.js runtime
- Do NOT include `NEXT_PUBLIC_LOCAL_TEST=true` in monday code env vars — it is for local dev only
- The `PORT` environment variable is automatically set by monday code — `npm start` (`next start`) reads it automatically

---

## API Routes

All routes are Next.js server-side API routes under `src/app/api/`. They call `src/lib/orders.ts` and `src/lib/mondayUtils.ts` directly — no separate backend process needed.

| Method | Route | Description |
|---|---|---|
| GET | `/api/order?itemId=` | Fetch order, line items, customer, and ranked suppliers |
| POST | `/api/get-couriers` | Get available couriers from Shiprocket for a supplier→customer route |
| POST | `/api/sort_couriers` | Rank couriers by weighted score |
| POST | `/api/generate-manifest` | Generate manifest PDF and upload to monday |
| POST | `/api/generate-label` | Generate label PDFs, merge, and upload to monday |

---

## Key Files Explained

### `src/app/page.tsx`
The entire frontend UI. Responsibilities:
- Reads `itemId` from monday SDK context (or local env for testing)
- Renders order info, customer info, and line items table
- Handles supplier selection → triggers courier fetch
- Handles courier selection
- Triggers manifest + label generation on confirm
- Shows loading and processing overlays

### `src/lib/mondayUtils.ts`
All read-only monday.com GraphQL helpers:
- `fetchItemWithColumns` — fetch a single item with all column values
- `getRelatedItems` — fetch items from a board filtered by a column value
- `getColumnId` — resolve a column title to its ID
- `getValue` / `getLinkedItemIds` — extract values from column_values array
- `sortSuppliersDirectAsync` — weighted supplier ranking
- `sortCouriersDirect` — weighted courier ranking
- `getWeightageValues` — fetch sorting weights from monday config items

### `src/lib/orders.ts`
All write operations and PDF generation:
- `getOrderWithLineitems` — orchestrates full data fetch for an order
- `generateManifest` — creates monday record + generates manifest PDF + uploads + updates line items
- `generateLabel` — generates label PDFs per item + merges + uploads
- `checkCourierServiceability` — calls Shiprocket API
- `uploadFileToManifestColumn` — multipart file upload to monday.com
- `createSupplierManifestRecord` — creates new item on manifest board
- `updateOrderLineItem` — updates status, supplier, courier on line item

### `next.config.js`
```js
const nextConfig = {
  serverExternalPackages: ["form-data"],
};
```
`form-data` must be excluded from webpack bundling as it is a Node.js native package used in API routes.

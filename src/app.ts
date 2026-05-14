import express from 'express';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import path from 'path';

dotenv.config();

const REQUIRED_ENV = [
  'MONDAY_API_KEY', 'MONDAY_API_URL',
  'ORDER_LINE_ITEMS_BOARD_ID', 'SUPPLIER_MANIFEST_BOARD_ID',
  'SUPPLIER_PRODUCT_BOARD_ID', 'ORDERS_BOARD_ID',
  'SUPPLIER_SORTING_ITEM_ID', 'COURIER_SORTING_ITEM_ID',
  'SHIPROCKET_EMAIL', 'SHIPROCKET_PASSWORD',
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn('⚠️ Missing environment variables:', missing.join(', '));
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getOrderWithLineitems, generateManifest, generateLabel, checkCourierServiceability } = require(path.join(__dirname, '..', 'src', 'api', 'orders'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sortCouriersDirect } = require(path.join(__dirname, '..', 'src', 'api', 'mondayUtils'));

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..', 'client', 'build')));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/order', async (req, res) => {
  const itemId = req.query.itemId as string;
  if (!itemId) return res.status(400).json({ error: 'Missing itemId' });
  try {
    const data = await getOrderWithLineitems(itemId);
    if (!data || !data.order) return res.status(404).json({ error: 'Order not found' });
    return res.json(data);
  } catch (e: any) {
    console.error('Error in /api/order:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/get-couriers', async (req, res) => {
  const { supplier_postalcode, customer_postalcode, weight, cod = 0 } = req.body;
  console.log('[get-couriers] payload:', { supplier_postalcode, customer_postalcode, weight, cod });
  try {
    const couriers = await checkCourierServiceability(supplier_postalcode, customer_postalcode, weight, cod);
    return res.json({ couriers });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/api/sort_couriers', async (req, res) => {
  const { couriers = [] } = req.body;
  if (!couriers.length) return res.status(400).json({ success: false, error: 'No couriers provided' });
  try {
    const sorted = await sortCouriersDirect(couriers);
    return res.json({ success: true, couriers: sorted });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/generate-manifest', async (req, res) => {
  try {
    const { supplierId, supplierName, supplierAddress, courierId, courierName, customer, lineitems = [], orderId } = req.body;
    if (!supplierId || !supplierName || !courierId) {
      return res.status(400).json({ error: 'Missing required supplier/courier details' });
    }
    const results = await generateManifest(lineitems, supplierId, supplierName, supplierAddress, courierId, courierName, customer, orderId);
    return res.json(results);
  } catch (e: any) {
    console.error('Error generating manifest:', e.message, e.stack);
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
});

app.post('/api/generate-label', async (req, res) => {
  try {
    const { supplierId, supplierName, supplierAddress, courierId, courierName, customer, lineitems = [] } = req.body;
    if (!supplierId || !courierId || !lineitems.length) {
      return res.status(400).json({ error: 'Missing required supplier/courier/lineitems info' });
    }
    const results = await generateLabel(lineitems, supplierId, supplierName, supplierAddress, courierId, courierName, customer);
    return res.json(results);
  } catch (e: any) {
    console.error('Error generating label:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
});

app.get('/view', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
});

app.get('/', (_req, res) => res.redirect('/view'));

app.listen(port, () => console.log(`Server running on port ${port}`));

export default app;

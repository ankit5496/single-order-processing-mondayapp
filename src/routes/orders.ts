import { Router, Request, Response } from 'express';
const router = Router();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getOrderWithLineitems, generateManifest, generateLabel, checkCourierServiceability } = require('../../backend-node/orders');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sortCouriersDirect } = require('../../backend-node/utils/mondayUtils');

router.get('/api/order', async (req: Request, res: Response) => {
  const itemId = req.query.itemId as string;
  if (!itemId) return res.status(400).json({ error: 'Missing itemId' });
  try {
    const data = await getOrderWithLineitems(itemId);
    if (!data || !data.order) return res.status(404).json({ error: 'Order not found or failed to load' });
    return res.json(data);
  } catch (e: any) {
    console.error('Error in /api/order:', e.message, e.stack);
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
});

router.post('/api/get-couriers', async (req: Request, res: Response) => {
  const { supplier_postalcode, customer_postalcode, weight, cod = 0 } = req.body;
  try {
    const couriers = await checkCourierServiceability(supplier_postalcode, customer_postalcode, weight, cod);
    return res.json({ couriers });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/api/sort_couriers', async (req: Request, res: Response) => {
  const { couriers = [] } = req.body;
  if (!couriers.length) return res.status(400).json({ success: false, error: 'No couriers provided' });
  try {
    const sorted = await sortCouriersDirect(couriers);
    return res.json({ success: true, couriers: sorted });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/api/generate-manifest', async (req: Request, res: Response) => {
  try {
    const { supplierId, supplierName, supplierAddress, courierId, courierName, customer, lineitems = [], orderId } = req.body;
    if (!supplierId || !supplierName || !courierId) {
      return res.status(400).json({ error: 'Missing required supplier/courier details' });
    }
    const results = await generateManifest(lineitems, supplierId, supplierName, supplierAddress, courierId, courierName, customer, orderId);
    return res.json(results);
  } catch (e: any) {
    console.error('Error generating manifest:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
});

router.post('/api/generate-label', async (req: Request, res: Response) => {
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

export default router;

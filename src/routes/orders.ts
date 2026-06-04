import { Router, Request, Response } from 'express';
import { mondayTokenMiddleware } from '../middlewares/authentication';
const router = Router();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getOrderWithLineitems, generateManifest, generateLabel, checkCourierServiceability } = require('../api/orders');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sortCouriersDirect } = require('../api/mondayUtils');

router.get('/api/order', mondayTokenMiddleware, async (req: Request, res: Response) => {
  const itemId = req.query.itemId as string;
  const { shortLivedToken } = req.session;
  if (!itemId) return res.status(400).json({ error: 'Missing itemId' });
  try {
    const data = await getOrderWithLineitems(itemId, shortLivedToken);
    if (!data || !data.order) return res.status(404).json({ error: 'Order not found' });
    return res.json(data);
  } catch (e: any) {
    console.error('Error in /api/order:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
});

router.post('/api/get-couriers', mondayTokenMiddleware, async (req: Request, res: Response) => {
  const { supplier_postalcode, customer_postalcode, weight, cod = 0 } = req.body;
  const { shortLivedToken } = req.session;
  try {
    const couriers = await checkCourierServiceability(supplier_postalcode, customer_postalcode, weight, cod, shortLivedToken);
    return res.json({ couriers });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/api/sort_couriers', mondayTokenMiddleware, async (req: Request, res: Response) => {
  const { couriers = [] } = req.body;
  const { shortLivedToken } = req.session;
  if (!couriers.length) return res.status(400).json({ success: false, error: 'No couriers provided' });
  try {
    const sorted = await sortCouriersDirect(couriers, shortLivedToken);
    return res.json({ success: true, couriers: sorted });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/api/generate-manifest', mondayTokenMiddleware, async (req: Request, res: Response) => {
  const { supplierId, supplierName, supplierAddress, supplierPhone, courierId, courierName, customer, lineitems = [], orderId, shiprocketShipmentId, shiprocketOrderId } = req.body;
  const { shortLivedToken } = req.session;
  if (!supplierId || !supplierName || !courierId) {
    return res.status(400).json({ error: 'Missing required supplier/courier details' });
  }
  try {
    const results = await generateManifest(lineitems, supplierId, supplierName, supplierAddress, courierId, courierName, customer, orderId, shiprocketShipmentId, shiprocketOrderId, supplierPhone, shortLivedToken);
    return res.json(results);
  } catch (e: any) {
    console.error('Error generating manifest:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
});

router.post('/api/generate-label', mondayTokenMiddleware, async (req: Request, res: Response) => {
  const { supplierId, supplierName, supplierAddress, courierId, courierName, customer, lineitems = [] } = req.body;
  const { shortLivedToken } = req.session;
  if (!supplierId || !courierId || !lineitems.length) {
    return res.status(400).json({ error: 'Missing required supplier/courier/lineitems info' });
  }
  try {
    const results = await generateLabel(lineitems, supplierId, supplierName, supplierAddress, courierId, courierName, customer, shortLivedToken);
    return res.json(results);
  } catch (e: any) {
    console.error('Error generating label:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
});

router.get('/api/track-shipment', mondayTokenMiddleware, async (req: Request, res: Response) => {
  const { orderId } = req.query as { orderId: string };
  const { shortLivedToken } = req.session;
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { trackShipment } = require('../api/orders');
    const data = await trackShipment(orderId, shortLivedToken);
    return res.json(data);
  } catch (e: any) {
    console.error('Error tracking shipment:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

export default router;

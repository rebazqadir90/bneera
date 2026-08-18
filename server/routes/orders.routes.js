import { Router } from 'express';
import { STATUSES } from '../db.js';

function toPublicOrder(order) {
  const d = new Date(order.created_at);
  return {
    id: order.id,
    status: order.status,
    createdAt: order.created_at,
    link: order.link,
    quantity: order.quantity,
    size: order.size,
    color: order.color,
    note: order.note,
    image: order.image,
    price: order.price,
    tax: order.tax,
    taxRate: order.tax_rate,
    shipping: order.shipping,
    weight: order.weight,
    shippingDetails: order.ship_first_name ? {
      firstName: order.ship_first_name,
      lastName: order.ship_last_name,
      address: order.ship_address,
      city: order.ship_city,
      phone: order.ship_phone,
      phone2: order.ship_phone2
    } : null,
    day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  };
}

export function createOrdersRoutes({ stmts, auth, upload }) {
  const router = Router();
  const { requireAuth, requireAdmin } = auth;

  router.get('/orders', requireAuth, (req, res) => {
    const orders = stmts.getOrdersByUser(req.user.id).map(toPublicOrder);
    res.status(200).json({ orders });
  });

  router.post('/orders', requireAuth, (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) return next(err);

      const body = req.body || {};
      const link = typeof body.link === 'string' ? body.link.trim() : '';
      const size = typeof body.size === 'string' ? body.size.trim() : '';
      const color = typeof body.color === 'string' ? body.color.trim() : '';
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      const quantityRaw = body.quantity;

      const fields = {};
      if (!link || link.length > 2000) {
        fields.link = 'A product link is required';
      } else {
        try { new URL(link); } catch { fields.link = 'Link must be a valid URL'; }
      }

      let quantity = 1;
      if (quantityRaw != null && quantityRaw !== '') {
        const asNumber = Number(quantityRaw);
        if (!Number.isInteger(asNumber) || asNumber <= 0) {
          fields.quantity = 'Quantity must be a positive integer';
        } else {
          quantity = asNumber;
        }
      }

      if (size.length > 100) fields.size = 'Size is too long';
      if (color.length > 100) fields.color = 'Color is too long';
      if (note.length > 1000) fields.note = 'Note is too long';

      if (Object.keys(fields).length > 0) {
        return res.status(400).json({ error: { message: 'Invalid order details', fields } });
      }

      const image = req.file ? `/uploads/${req.file.filename}` : '';
      const order = stmts.insertOrder({ userId: req.user.id, link, quantity, size, color, note, image });
      res.status(201).json({ order: toPublicOrder(order) });
    });
  });

  router.get('/orders/:id', requireAuth, (req, res) => {
    const order = stmts.getOrderById(req.params.id);
    if (!order || order.user_id !== req.user.id) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    res.status(200).json({ order: toPublicOrder(order) });
  });

  router.patch('/orders/:id/status', requireAdmin, (req, res) => {
    const status = req.body && req.body.status;
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: { message: 'Invalid status', fields: { status: `Must be one of: ${STATUSES.join(', ')}` } } });
    }
    const existing = stmts.getOrderById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    const order = stmts.updateOrderStatus(req.params.id, status);
    if (existing.status !== status) {
      stmts.insertNotification({
        userId: existing.user_id,
        orderId: order.id,
        message: `Order #${order.id} status changed from ${existing.status} to ${status}`
      });
    }
    res.status(200).json({ order: toPublicOrder(order) });
  });

  // Confirm is only available once staff have processed the order (set price/tax/shipping), not while still Pending.
  const CONFIRMABLE_FROM = ['Processed'];
  // Once an order is Confirmed (or beyond), the customer can no longer cancel it themselves.
  const CANCELABLE_FROM = ['Pending', 'Processed'];

  router.patch('/orders/:id/confirm', requireAuth, (req, res) => {
    const order = stmts.getOrderById(req.params.id);
    if (!order || order.user_id !== req.user.id) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    if (!CONFIRMABLE_FROM.includes(order.status)) {
      return res.status(409).json({ error: { message: `Order can't be confirmed from status "${order.status}"` } });
    }

    const body = req.body || {};
    function trimmed(key) { return typeof body[key] === 'string' ? body[key].trim() : ''; }
    const shipping = {
      firstName: trimmed('firstName'),
      lastName: trimmed('lastName'),
      address: trimmed('address'),
      city: trimmed('city'),
      phone: trimmed('phone'),
      phone2: trimmed('phone2')
    };

    const fields = {};
    if (!shipping.firstName || shipping.firstName.length > 100) fields.firstName = 'First name is required';
    if (!shipping.lastName || shipping.lastName.length > 100) fields.lastName = 'Last name is required';
    if (!shipping.address || shipping.address.length > 500) fields.address = 'Full address is required';
    if (!shipping.city || shipping.city.length > 100) fields.city = 'City is required';
    if (!shipping.phone || shipping.phone.length > 40) fields.phone = 'Phone number is required';
    if (shipping.phone2 && shipping.phone2.length > 40) fields.phone2 = 'Second phone number is too long';

    if (Object.keys(fields).length > 0) {
      return res.status(400).json({ error: { message: 'Shipping details are required to confirm this order', fields } });
    }

    stmts.upsertShippingProfile(req.user.id, shipping);
    const updated = stmts.confirmOrderWithShipping(req.params.id, shipping);
    stmts.insertNotification({
      userId: req.user.id,
      orderId: updated.id,
      message: `Order #${updated.id} status changed from ${order.status} to Confirmed`
    });
    res.status(200).json({ order: toPublicOrder(updated) });
  });

  router.patch('/orders/:id/cancel', requireAuth, (req, res) => {
    const order = stmts.getOrderById(req.params.id);
    if (!order || order.user_id !== req.user.id) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    if (!CANCELABLE_FROM.includes(order.status)) {
      return res.status(409).json({ error: { message: `Order can't be canceled from status "${order.status}"` } });
    }
    const updated = stmts.updateOrderStatus(req.params.id, 'Canceled');
    stmts.insertNotification({
      userId: req.user.id,
      orderId: updated.id,
      message: `Order #${updated.id} status changed from ${order.status} to Canceled`
    });
    res.status(200).json({ order: toPublicOrder(updated) });
  });

  router.patch('/orders/:id/details', requireAdmin, (req, res) => {
    const existing = stmts.getOrderById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }

    const body = req.body || {};
    const fields = {};
    function parseNonNegative(key, current, max) {
      if (body[key] == null || body[key] === '') return current;
      const num = Number(body[key]);
      if (!Number.isFinite(num) || num < 0 || (max != null && num > max)) {
        fields[key] = max != null
          ? `${key} must be a number between 0 and ${max}`
          : `${key} must be a non-negative number`;
        return current;
      }
      return num;
    }

    const weight = parseNonNegative('weight', existing.weight);
    const price = parseNonNegative('price', existing.price);
    const taxRate = parseNonNegative('taxRate', existing.tax_rate, 100);
    const shipping = parseNonNegative('shipping', existing.shipping);

    if (Object.keys(fields).length > 0) {
      return res.status(400).json({ error: { message: 'Invalid order details', fields } });
    }

    const order = stmts.updateOrderDetails(req.params.id, { weight, price, taxRate, shipping });
    res.status(200).json({ order: toPublicOrder(order) });
  });

  return router;
}

export { toPublicOrder };

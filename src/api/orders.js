const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { PDFDocument } = require('pdf-lib');
const PDFKit = require('pdfkit');

const {
  fetchItemWithColumns,
  getRelatedItems,
  getColumnId,
  getValue,
  getDisplayValue,
  getLinkedItemIds,
  sortSuppliersDirectAsync,
  getEnv,
} = require('./mondayUtils');

const MONDAY_API_KEY = () => getEnv('MONDAY_API_KEY');
const ORDER_LINE_ITEMS_BOARD_ID = () => getEnv('ORDER_LINE_ITEMS_BOARD_ID');
const SUPPLIER_MANIFEST_BOARD_ID = () => getEnv('SUPPLIER_MANIFEST_BOARD_ID');
const SUPPLIER_PRODUCT_BOARD_ID = () => getEnv('SUPPLIER_PRODUCT_BOARD_ID');
const SHIPROCKET_EMAIL = () => getEnv('SHIPROCKET_EMAIL');
const SHIPROCKET_PASSWORD = () => getEnv('SHIPROCKET_PASSWORD');

let supplierManifestMondayRecordId = 0;

function sanitizeFilename(name) {
  return name.replace(/[\\/*?"<>|]/g, '');
}

function getISTDatetime() {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const date = ist.toLocaleString('en-US', { month: 'long', day: '2-digit' });
  const datetime = ist.toLocaleString('en-US', {
    month: 'long', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
  return { current_date: date, current_datetime: datetime };
}

// ─────────────────────────────────────────────────────────────────────────────
// MANIFEST PDF  (matches manifest-pdf.html exactly)
// ─────────────────────────────────────────────────────────────────────────────
function generateManifestPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ margin: 20, size: 'A4' });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const L = 20;                          // left margin  (matches body margin:20px)
    const pageW = doc.page.width - 40;    // usable width (A4 595 - 40 = 555)

    // ── Logo row (header) ──────────────────────────────────────────────────
    // HTML uses an <img> – we draw a placeholder rectangle with "LOGO" text
    doc.rect(L, 20, 100, 40).stroke('#cccccc');
    doc.fontSize(10).font('Helvetica').fillColor('#888888')
      .text('LOGO', L + 30, 33, { width: 40, align: 'center' });

    // ── Title ──────────────────────────────────────────────────────────────
    let y = 75;
    doc.fontSize(20).font('Helvetica-Bold').fillColor('black')
      .text('Manifest', L, y, { align: 'center', width: pageW });

    // ── Generated on ──────────────────────────────────────────────────────
    y += 28;
    doc.fontSize(12).font('Helvetica').fillColor('black')
      .text(`Generated on: ${data.current_datetime}`, L, y);

    // ── Seller / Courier (left) + Manifest info (right, margin-top:-59px) ─
    y += 18;
    const sellerY = y;
    doc.fontSize(12).font('Helvetica-Bold').text('Seller: ', L, sellerY, { continued: true });
    doc.font('Helvetica').text(data.supplierName || '');
    doc.fontSize(12).font('Helvetica-Bold').text('Courier: ', L, sellerY + 18, { continued: true });
    doc.font('Helvetica').text(data.courierName || '');

    // Manifest info – right-aligned block (mirrors .manifest-info { text-align:right })
    doc.fontSize(12).font('Helvetica')
      .text('Manifest ID : MANIFEST-0265', L, sellerY, { align: 'right', width: pageW });
    doc.text(`Total shipments to dispatch : ${data.orders.length}`, L, sellerY + 18, { align: 'right', width: pageW });

    // ── Orders Table ──────────────────────────────────────────────────────
    y = sellerY + 50;

    // Column widths matching HTML proportions: '', S.no, Order no, Awb no, Contents
    const colW   = [28, 45, 100, 100, pageW - 28 - 45 - 100 - 100]; // last col fills rest
    const headers = ['', 'S.no', 'Order no', 'Awb no', 'Contents'];
    const rowH   = 28;

    // Header row (th style: padding 8px, border 1px solid #333, grey fill implied)
    doc.font('Helvetica-Bold').fontSize(10);
    let x = L;
    headers.forEach((h, i) => {
      doc.rect(x, y, colW[i], rowH).fillAndStroke('#f0f0f0', '#333333');
      doc.fillColor('black').text(h, x + 5, y + 8, { width: colW[i] - 10, lineBreak: false });
      x += colW[i];
    });
    y += rowH;

    // Data rows
    doc.font('Helvetica').fontSize(10);
    data.orders.forEach((order, idx) => {
      x = L;
      // Checkbox column: draw a small square (HTML uses <input type="checkbox">)
      doc.rect(x + 6, y + 7, 12, 12).stroke('#333333');   // checkbox square
      doc.rect(x, y, colW[0], rowH).stroke('#333333');
      x += colW[0];

      const vals = [
        String(idx + 1),           // S.no  (HTML uses {{@index}} which is 0-based; +1 to be human-friendly)
        order.order_no || 'N/A',
        order.awb_no   || 'N/A',
        order.contents || '',
      ];
      vals.forEach((v, i) => {
        doc.rect(x, y, colW[i + 1], rowH).stroke('#333333');
        doc.fillColor('black').text(v, x + 5, y + 8, { width: colW[i + 1] - 10, lineBreak: false });
        x += colW[i + 1];
      });
      y += rowH;
    });

    y += 20;

    // ── To Be Filled section ──────────────────────────────────────────────
    // border-top / border-bottom: 1px dashed #333
    doc.moveTo(L, y).lineTo(L + pageW, y).dash(4, { space: 3 }).stroke('#333333');
    y += 8;
    doc.undash();
    doc.fontSize(13).font('Helvetica-Bold').fillColor('black')
      .text(`To Be Filled By ${data.courierName || ''} Executive`, L, y, { align: 'center', width: pageW });
    y += 22;
    doc.moveTo(L, y).lineTo(L + pageW, y).dash(4, { space: 3 }).stroke('#333333');
    y += 14;
    doc.undash();

    // Two-column filled section (matches .filled-left / .filled-right, width 48%)
    const col2W = pageW / 2 - 10;
    doc.fontSize(12).font('Helvetica').fillColor('black');

    // Left column
    doc.text('Pick up time : ____________________', L, y);
    doc.text('FE Name: ____________________',       L, y + 20);
    doc.text('FE Signature: ____________________',  L, y + 40);
    doc.text('FE Phone: ____________________',      L, y + 60);

    // Right column
    const R = L + pageW / 2 + 10;
    doc.text('Total items picked: ____________________', R, y);
    doc.text(`Seller Name: ${data.supplierName || ''}`,  R, y + 20);
    doc.text('Seller Signature: ____________________',   R, y + 40);

    y += 90;

    // ── Footer ────────────────────────────────────────────────────────────
    if (data.supplierAddress) {
      doc.fontSize(11).font('Helvetica').fillColor('black')
        .text(data.supplierAddress, L, y, { align: 'center', width: pageW });
      y += 18;
    }
    // Only render "Contact:" line when a phone number is actually present
    if (data.supplierPhone && data.supplierPhone.trim()) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('black')
        .text('Contact: ', L, y, { continued: true });
      doc.font('Helvetica').text(data.supplierPhone.trim());
      y += 18;
    }
    doc.fontSize(11).font('Helvetica').fillColor('black')
      .text('This is a system generated document', L, y, { align: 'center', width: pageW });

    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LABEL PDF  (matches label-pdf.html exactly)
// ─────────────────────────────────────────────────────────────────────────────
function generateLabelPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ margin: 20, size: 'A4' });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // HTML .label-container { width:700px } scaled to A4 usable width
    const L       = 20;
    const pageW   = doc.page.width - 40;   // ~555pt on A4
    const borderY = 20;
    let y         = borderY;

    // ── Outer border (matches border: 2px solid black on .label-container) ─
    const totalHeight = 570;
    doc.rect(L, y, pageW, totalHeight).lineWidth(2).stroke('black');
    doc.lineWidth(1); // reset

    // ── Row 1: DELIVER TO / Shipped By ───────────────────────────────────
    // .row { display:flex; justify-content:space-between; border-bottom:1px solid black; padding:5px }
    // .col { width:48% }
    const rowPad  = 8;
    const colW    = pageW / 2 - 1;   // two equal halves, -1 for divider
    const row1H   = 90;

    // Left col – DELIVER TO
    doc.fontSize(11).font('Helvetica-Bold').fillColor('black')
      .text('DELIVER TO:', L + rowPad, y + rowPad);
    doc.fontSize(10).font('Helvetica')
      .text(data.customer?.name    || '',    L + rowPad, y + 22, { width: colW - rowPad });
    doc.text(data.customer?.address || '',   L + rowPad, y + 36, { width: colW - rowPad });
    doc.text(`MOBILE NO.: ${data.customer?.phone || ''}`, L + rowPad, y + 66, { width: colW - rowPad });

    // Vertical divider
    doc.moveTo(L + colW, y + 1).lineTo(L + colW, y + row1H - 1).stroke('black');

    // Right col – Shipped By
    const rx = L + colW + rowPad;
    doc.fontSize(10).font('Helvetica-Bold')
      .text('Shipped By (If undelivered, return to):', rx, y + rowPad, { width: colW - rowPad });
    doc.font('Helvetica').fontSize(9)
      .text(data.supplierAddress || '', rx, y + 32, { width: colW - rowPad });
    doc.text(`Mobile No: ${data.supplierPhone || ''}`, rx, y + 62, { width: colW - rowPad });

    // Row 1 bottom border
    y += row1H;
    doc.moveTo(L, y).lineTo(L + pageW, y).stroke('black');

    // ── Row 2: ORDER # + barcode ──────────────────────────────────────────
    // .section { border-bottom: 1px solid black; padding: 5px }
    const row2H = 75;
    doc.fontSize(13).font('Helvetica-Bold').fillColor('black')
      .text(`ORDER #: ${data.order?.order_no || 'N/A'}`, L + rowPad, y + rowPad);

    // Barcode simulation (CSS repeating-linear-gradient stripe pattern → thin vertical lines)
    const bcX = L + rowPad;
    const bcY = y + 26;
    const bcW = 160;   // ~10rem at 16px base
    const bcH = 30;
    // Draw alternating 2px black / 2px white stripes
    for (let bx = bcX; bx < bcX + bcW; bx += 4) {
      doc.rect(bx, bcY, 2, bcH).fill('black');
    }

    y += row2H;
    doc.moveTo(L, y).lineTo(L + pageW, y).stroke('black');

    // ── Row 3: Weight / COD ──────────────────────────────────────────────
    const row3H = 70;
    doc.fontSize(11).font('Helvetica').fillColor('black')
      .text(`WEIGHT: ${data.product?.weight || 'N/A'} | DIMENSIONS: N/A`, L + rowPad, y + rowPad);
    doc.fontSize(12).font('Helvetica-Bold')
      .text('CASH ON DELIVERY', L + rowPad, y + 22);
    doc.fontSize(12).font('Helvetica-Bold')
      .text(`COLLECT COD - Rs. ${data.product?.total_price || '0'}`, L + rowPad, y + 40);

    y += row3H;
    doc.moveTo(L, y).lineTo(L + pageW, y).stroke('black');

    // ── Row 4: Courier + AWB barcode ─────────────────────────────────────
    const row4H = 70;
    doc.fontSize(13).font('Helvetica-Bold').fillColor('black')
      .text(data.courierName || '', L + rowPad, y + rowPad);
    doc.fontSize(10).font('Helvetica')
      .text(`AWB #: ${data.order?.awb_no || 'N/A'}`, L + rowPad, y + 22);

    // Second barcode
    const bc2X = L + rowPad;
    const bc2Y = y + 38;
    for (let bx = bc2X; bx < bc2X + 160; bx += 4) {
      doc.rect(bx, bc2Y, 2, 20).fill('black');
    }

    y += row4H;
    doc.moveTo(L, y).lineTo(L + pageW, y).stroke('black');

    // ── Row 5: Items Table ────────────────────────────────────────────────
    // SKU 25%, ITEM 40%, QTY 12%, PRICE 23% — wider SKU so long codes don't wrap
    const tW = [
      Math.round(pageW * 0.25),   // SKU  – widened from 15% → 25%
      Math.round(pageW * 0.40),   // ITEM – adjusted from 50% → 40%
      Math.round(pageW * 0.12),   // QTY
      pageW - Math.round(pageW * 0.25) - Math.round(pageW * 0.40) - Math.round(pageW * 0.12), // PRICE fills rest
    ];
    const tHeaders = ['SKU', 'ITEM', 'QTY', 'PRICE'];
    const tRowH    = 24;

    // Header row
    doc.font('Helvetica-Bold').fontSize(10);
    let tx = L;
    tHeaders.forEach((h, i) => {
      doc.rect(tx, y, tW[i], tRowH).fillAndStroke('#f0f0f0', '#333333');
      doc.fillColor('black').text(h, tx + 4, y + 7, { width: tW[i] - 8, align: 'center', lineBreak: false });
      tx += tW[i];
    });
    y += tRowH;

    // Data row
    tx = L;
    doc.font('Helvetica').fontSize(10);
    const dataVals = [
      data.product?.sku      || '',
      data.product?.name     || '',
      String(data.product?.quantity || ''),
      `Rs. ${data.product?.unit_price || '0'}`,
    ];
    dataVals.forEach((v, i) => {
      doc.rect(tx, y, tW[i], tRowH).stroke('#333333');
      doc.fillColor('black').text(v, tx + 4, y + 7, { width: tW[i] - 8, align: 'center', lineBreak: false });
      tx += tW[i];
    });
    y += tRowH;

    // Total row layout (matches image):
    //   Cell 1: SKU+ITEM merged → "TOTAL:" left-aligned
    //   Cell 2: QTY column      → empty (blank cell below QTY)
    //   Cell 3: PRICE column    → total amount centered (same style as PRICE data cell)
    const totalLabelW = tW[0] + tW[1];   // spans SKU + ITEM only
    const totalQtyW   = tW[2];            // blank cell under QTY
    const totalValW   = tW[3];            // centered amount under PRICE

    // TOTAL: label cell (SKU+ITEM)
    doc.rect(L, y, totalLabelW, tRowH).stroke('#333333');
    doc.fontSize(10).font('Helvetica-Bold').fillColor('black')
      .text('TOTAL:', L + 4, y + 7, { width: totalLabelW - 8, align: 'left', lineBreak: false });

    // Blank QTY cell
    doc.rect(L + totalLabelW, y, totalQtyW, tRowH).stroke('#333333');

    // Price amount cell — centered, bold, matching the PRICE column above
    doc.rect(L + totalLabelW + totalQtyW, y, totalValW, tRowH).stroke('#333333');
    doc.fontSize(10).font('Helvetica-Bold').fillColor('black')
      .text(
        `Rs. ${data.product?.total_price || '0'}`,
        L + totalLabelW + totalQtyW + 4, y + 7,
        { width: totalValW - 8, align: 'center', lineBreak: false }
      );
    y += tRowH;

    doc.moveTo(L, y).lineTo(L + pageW, y).stroke('black');

    // ── Row 6: Invoice No. + Invoice Date (matches image: "Invoice No.: Retail00144 | Invoice Date: …") ──
    const row6H = 28;
    doc.fontSize(10).font('Helvetica').fillColor('black')
      .text(
        `Invoice No.: ${data.invoiceNo || 'N/A'} | Invoice Date: ${data.current_datetime || ''}`,
        L + rowPad, y + 8,
        { width: pageW - rowPad * 2, lineBreak: false }
      );
    y += row6H;
    doc.moveTo(L, y).lineTo(L + pageW, y).stroke('black');

    // ── Footer: Terms (font-size 10, line-height ~16pt — matches image) ───
    const termsPad = 10;
    const termsLineH = 16;   // matches visible spacing in the image
    let ty = y + termsPad;

    doc.fontSize(10).font('Helvetica-Bold').fillColor('black')
      .text('TERMS AND CONDITIONS:', L + rowPad, ty);
    ty += termsLineH + 2;

    doc.fontSize(10).font('Helvetica').fillColor('black');
    const terms = [
      '1. Visit official website of DTDC Surface 2kg to view the Conditions of Carriage.',
      '2. Shipping charges are inclusive of service tax and all figures are in INR.',
      '3. All disputes will be resolved under Delhi jurisdiction.',
      "4. Sold goods are eligible for return or exchange according to the store's policy.",
    ];
    terms.forEach((line) => {
      doc.text(line, L + rowPad, ty, { width: pageW - rowPad * 2, lineBreak: false });
      ty += termsLineH;
    });

    ty += termsLineH;   // blank line gap before the auto-generated notice (matches image)
    doc.fontSize(10).font('Helvetica').fillColor('black')
      .text(
        'THIS IS AN AUTO-GENERATED LABEL AND DOES NOT NEED SIGNATURE.',
        L + rowPad, ty,
        { width: pageW - rowPad * 2, lineBreak: false }
      );

    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Merge PDFs
// ─────────────────────────────────────────────────────────────────────────────
async function mergePdfs(pdfBuffers) {
  const merged = await PDFDocument.create();
  for (const buf of pdfBuffers) {
    const doc = await PDFDocument.load(buf);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return Buffer.from(await merged.save());
}

// ─────────────────────────────────────────────────────────────────────────────
// Shiprocket helpers (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
async function generateToken(email, password) {
  try {
    const res = await axios.post(
      'https://apiv2.shiprocket.in/v1/external/auth/login',
      { email, password },
      { headers: { 'Content-Type': 'application/json' } }
    );
    return { success: true, token: res.data.token };
  } catch (e) {
    return { success: false, token: null, error: e.message };
  }
}

async function checkCourierServiceability(pickupPincode, deliveryPincode, weight, cod) {
  const tokenRes = await generateToken(SHIPROCKET_EMAIL(), SHIPROCKET_PASSWORD());
  if (!tokenRes.success) throw new Error('Shiprocket auth failed: ' + tokenRes.error);
  const url = `https://apiv2.shiprocket.in/v1/external/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&weight=${weight}&cod=${cod}`;
  const res = await axios.get(url, { headers: { Authorization: `Bearer ${tokenRes.token}` } });
  return res.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Monday.com helpers (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
async function uploadFileToSupplierManifestColumn(itemId, fileBuffer, fileName, columnId) {
  const query = `
    mutation add_file($file: File!, $itemId: ID!, $columnId: String!) {
      add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) { id }
    }
  `;
  const form = new FormData();
  form.append('query', query);
  form.append('variables', JSON.stringify({ file: null, itemId: String(itemId), columnId }));
  form.append('map', JSON.stringify({ pdf: ['variables.file'] }));
  form.append('pdf', Buffer.from(fileBuffer), { filename: fileName, contentType: 'application/pdf' });

  const res = await axios.post('https://api.monday.com/v2/file', form, {
    headers: { Authorization: MONDAY_API_KEY(), 'API-version': '2024-04', ...form.getHeaders() },
  });
  console.log('Upload response:', JSON.stringify(res.data));
  return res.data;
}

async function createSupplierManifestRecord(orders, supplierName, supplierItemId, courierName, orderLineItemIds, orderId) {
  const { current_date } = getISTDatetime();

  const [orderColId, orderLineItemColId] = await Promise.all([
    getColumnId(SUPPLIER_MANIFEST_BOARD_ID(), 'Order'),
    getColumnId(SUPPLIER_MANIFEST_BOARD_ID(), 'OrderLineItem'),
  ]);

  const itemName = supplierName
    ? `${supplierName}_${courierName}_(${current_date})`
    : `Manifest Record (${current_date})`;

  const columnValues = {};
  if (orderColId) columnValues[orderColId] = { linkedPulseIds: [{ linkedPulseId: Number(orderId) }] };
  if (orderLineItemColId && orderLineItemIds?.length) {
    columnValues[orderLineItemColId] = {
      linkedPulseIds: orderLineItemIds.map((id) => ({ linkedPulseId: Number(id) })),
    };
  }

  const columnValuesStr = JSON.stringify(JSON.stringify(columnValues));
  const mutation = `
    mutation {
      create_item(
        board_id: ${SUPPLIER_MANIFEST_BOARD_ID()},
        item_name: "${itemName}",
        column_values: ${columnValuesStr}
      ) { id }
    }
  `;

  const res = await axios.post(
    'https://api.monday.com/v2',
    { query: mutation },
    { headers: { Authorization: MONDAY_API_KEY(), 'Content-Type': 'application/json' } }
  );

  if (res.data?.errors?.length) console.error('createSupplierManifestRecord errors:', JSON.stringify(res.data.errors));
  const itemId = res.data?.data?.create_item?.id;
  return { success: !!itemId, id: itemId, errors: res.data?.errors || [] };
}

async function updateOrderLineItem(itemId, status, supplierId, supplierName, courierId, courierName, boardId) {
  const [courierIdColId, courierNameColId, statusColId, supplierColId] = await Promise.all([
    getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'CourierId'),
    getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'Courier Name'),
    getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'Status'),
    getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'Supplier'),
  ]);

  const columnValues = {};
  if (statusColId && status) columnValues[statusColId] = { label: status };
  if (supplierColId && supplierId) columnValues[supplierColId] = { item_ids: [String(supplierId)] };
  if (courierIdColId && courierId) columnValues[courierIdColId] = String(courierId);
  if (courierNameColId && courierName) columnValues[courierNameColId] = String(courierName);

  const mutation = `
    mutation ($itemId: ID!, $boardId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(item_id: $itemId, board_id: $boardId, column_values: $columnValues) { id }
    }
  `;

  const res = await axios.post(
    'https://api.monday.com/v2',
    { query: mutation, variables: { itemId: String(itemId), boardId: String(boardId), columnValues: JSON.stringify(columnValues) } },
    { headers: { Authorization: MONDAY_API_KEY(), 'Content-Type': 'application/json' } }
  );
  return res.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data fetching (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
async function getOrderWithLineitems(orderId) {
  const compareValue = [parseInt(orderId)];

  const [orderIdColId, productColId] = await Promise.all([
    getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'Order'),
    getColumnId(SUPPLIER_PRODUCT_BOARD_ID(), 'Product'),
  ]);

  if (!orderIdColId) throw new Error(`Column "Order" not found on board ${ORDER_LINE_ITEMS_BOARD_ID()}`);
  if (!productColId) throw new Error(`Column "Product" not found on board ${SUPPLIER_PRODUCT_BOARD_ID()}`);

  const customerInfo = { id: null, name: '', email: '', phone: '', address: '', postal_code: '' };
  const orderItem = await fetchItemWithColumns(orderId);
  if (!orderItem) throw new Error(`Order item ${orderId} not found in monday.com`);

  const orderData = {
    id: orderItem?.id,
    name: orderItem?.name,
    status: getValue('Status', orderItem),
    date: getValue('Date', orderItem),
    orderId: getValue('OrderId', orderItem),
    description: getValue('Description', orderItem),
    totalPrice: getValue('TotalPrice', orderItem),
    customerId: getLinkedItemIds('Customers', orderItem),
    customerPostalCode: getValue('CustomerPostalCode', orderItem),
  };

  let customerId = orderData.customerId;
  if (Array.isArray(customerId) && customerId.length > 0) customerId = customerId[0];

  try {
    const customerColumns = await fetchItemWithColumns(customerId);
    if (customerColumns) {
      customerInfo.id = customerColumns.id;
      customerInfo.name = customerColumns.name;
      customerInfo.email = getValue('Email', customerColumns);
      customerInfo.phone = getValue('Phone', customerColumns);
      customerInfo.address = getValue('Billing Street', customerColumns);
      customerInfo.postal_code = getValue('PostalCode', customerColumns);
    }
  } catch (e) {
    console.error('Error fetching customer:', e.message);
  }

  const orderLineitems = await getRelatedItems(ORDER_LINE_ITEMS_BOARD_ID(), orderIdColId, compareValue);

  const parsedItems = orderLineitems.map((item) => ({
    id: item.id,
    name: item.name,
    orderNumber: getValue('OrderNumber', item),
    product: getValue('Product', item),
    product_id: getLinkedItemIds('Product', item),
    productCode: getValue('lookup_mks1f46y', item),
    sku: getValue('SKU', item),
    quantity: getValue('Quantity', item),
    unitPrice: getValue('UnitPrice', item),
    listPrice: getValue('ListPrice', item),
    status: getValue('Status', item),
    date: getValue('Date', item),
    productWeight: getValue('Product Weight', item),
    customerId: getValue('CustomerId', item),
    supplierId: getLinkedItemIds('Supplier', item),
    supplierName: getValue('Supplier', item),
    courierId: getValue('CourierId', item),
    courierName: getValue('Courier Name', item),
  }));

  const allProductIds = parsedItems
    .flatMap((i) => i.product_id || [])
    .filter((id) => String(id).match(/^\d+$/))
    .map(Number);

  const supplierProductItems = await getRelatedItems(SUPPLIER_PRODUCT_BOARD_ID(), productColId, allProductIds);

  const productSupplierMap = {};
  for (const item of supplierProductItems) {
    const productIds = getLinkedItemIds('Product', item) || [];
    const supplierId = getLinkedItemIds('Supplier', item);
    const supplierInfo = {
      supplier_id: supplierId?.[0] || null,
      supplier_name: getValue('SupplierName', item) || getDisplayValue('SupplierName', item),
      supplier_address: getValue('Supplier Address', item) || getDisplayValue('Supplier Address', item),
      supplier_phone: getValue('Supplier Phone', item) || getDisplayValue('Supplier Phone', item),
      postal_code: getValue('Postal Code', item) || getDisplayValue('Postal Code', item),
      rate: getValue('Rate(Per Unit)', item),
      weight: getValue('Product Weight', item) || getDisplayValue('Product Weight', item),
      rating: getValue('Supplier Market Rating', item) || getDisplayValue('Supplier Market Rating', item),
      self: getValue('Self', item) || getDisplayValue('Self', item),
    };
    console.log('[supplierInfo]', supplierInfo.supplier_name, 'postal_code:', supplierInfo.postal_code);
    for (const pid of productIds) {
      if (!productSupplierMap[pid]) productSupplierMap[pid] = [];
      productSupplierMap[pid].push(supplierInfo);
    }
  }

  for (const pid of Object.keys(productSupplierMap)) {
    const suppliers = productSupplierMap[pid];
    const sorted = await sortSuppliersDirectAsync(suppliers.map((s) => ({ price: s.rate, rating: s.rating, ...s })));
    const selfSuppliers = sorted.filter((s) => s.self === 'v');
    const otherSuppliers = sorted.filter((s) => s.self !== 'v');
    productSupplierMap[pid] = [...selfSuppliers, ...otherSuppliers];
  }

  for (const item of parsedItems) {
    const suppliers = [];
    for (const pid of item.product_id || []) {
      if (productSupplierMap[pid]) suppliers.push(...productSupplierMap[pid]);
    }
    item.suppliers = suppliers;
  }

  return { order: orderData, customer: customerInfo, lineitems: parsedItems };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateManifest  (unchanged orchestration, swapped PDF generator)
// ─────────────────────────────────────────────────────────────────────────────
async function generateManifest(orderLineItems, supplierId, supplierName, supplierAddress, courierId, courierName, customer, orderId) {
  const orders = orderLineItems.map((item) => ({
    order_no:    item.orderNumber || 'N/A',
    awb_no:      'N/A',
    contents:    [item.product, item.productCode, item.sku].filter(Boolean).join(', '),
    quantity:    item.quantity || 1,
    unit_price:  Number(item.unitPrice || 0).toFixed(2),
    total_price: (Number(item.quantity || 1) * Number(item.unitPrice || 0)).toFixed(2),
  }));

  const manifestRecord = await createSupplierManifestRecord(
    orders, supplierName, supplierId, courierName,
    orderLineItems.map((i) => i.id).filter(Boolean), orderId
  );
  supplierManifestMondayRecordId = manifestRecord.id;
  console.log('[generateManifest] record created:', supplierManifestMondayRecordId);

  const { current_datetime, current_date } = getISTDatetime();
  console.log('[generateManifest] generating PDF...');

  const pdfBuffer = await generateManifestPdf({
    orders,
    supplierName,
    supplierAddress,
    supplierPhone: '',      // extend if available
    courierName,
    current_datetime,
  });

  console.log('[generateManifest] PDF generated, size:', pdfBuffer.length);
  const fileName = sanitizeFilename(`${supplierName}_${courierName}_(${current_date}).pdf`);

  const manifestFileColId = await getColumnId(SUPPLIER_MANIFEST_BOARD_ID(), 'Manifest File');
  await uploadFileToSupplierManifestColumn(supplierManifestMondayRecordId, pdfBuffer, fileName, manifestFileColId);

  for (const item of orderLineItems) {
    if (item.id) {
      try {
        const result = await updateOrderLineItem(
          parseInt(item.id), 'Manifest Generated', supplierId, supplierName,
          courierId, courierName, ORDER_LINE_ITEMS_BOARD_ID()
        );
        if (result?.errors?.length) console.error('updateOrderLineItem errors:', JSON.stringify(result.errors));
      } catch (e) {
        console.error('Failed to update line item', item.id, e.message);
      }
    }
  }

  return { supplierName, supplierId, courierName, courierId, totalOrders: orders.length, orders };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateLabel  (unchanged orchestration, swapped PDF generator)
// ─────────────────────────────────────────────────────────────────────────────
async function generateLabel(lineitems, supplierId, supplierName, supplierAddress, courierId, courierName, customer) {
  const pdfBuffers = [];
  const { current_date, current_datetime } = getISTDatetime();

  for (const item of lineitems) {
    const labelData = {
      order: { order_no: item.orderNumber || 'N/A', awb_no: 'N/A' },
      customer,
      product: {
        name:        item.product,
        sku:         item.sku,
        weight:      item.productWeight,
        unit_price:  Number(item.unitPrice || 0).toFixed(2),
        quantity:    item.quantity || 1,
        total_price: (Number(item.quantity || 1) * Number(item.unitPrice || 0)).toFixed(2),
      },
      invoiceNo:       item.orderNumber || 'N/A',   // "Invoice No.: Retail00144 | Invoice Date: …"
      supplierName,
      supplierAddress,
      supplierPhone:   '',
      courierName,
      current_datetime,
    };
    const pdfBuffer = await generateLabelPdf(labelData);
    pdfBuffers.push(pdfBuffer);
  }

  const mergedBuffer = await mergePdfs(pdfBuffers);
  const fileName = sanitizeFilename(`merged_labels_${courierName}_(${current_date}).pdf`);
  const labelFileColId = await getColumnId(SUPPLIER_MANIFEST_BOARD_ID(), 'Label File');
  await uploadFileToSupplierManifestColumn(supplierManifestMondayRecordId, mergedBuffer, fileName, labelFileColId);

  return lineitems.map((item) => ({ order_no: item.orderNumber || 'N/A' }));
}

module.exports = { getOrderWithLineitems, generateManifest, generateLabel, checkCourierServiceability };
const fs = require('fs');
const path = require('path');
// const FormData = require('form-data');
const { PDFDocument } = require('pdf-lib');
const PDFKit = require('pdfkit');

const {
  fetchItemWithColumns,
  getRelatedItems,
  getColumnId,
  getColumnInfo,
  getValue,
  getDisplayValue,
  getLinkedItemIds,
  sortSuppliersDirectAsync,
  getEnv,
  getApiKey,
  resolveMondayToken,
} = require('./mondayUtils');

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
// MANIFEST PDF
// ─────────────────────────────────────────────────────────────────────────────
function generateManifestPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ margin: 20, size: 'A4' });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const L = 20;
    const pageW = doc.page.width - 40;

    doc.rect(L, 20, 100, 40).stroke('#cccccc');
    doc.fontSize(10).font('Helvetica').fillColor('#888888')
      .text('LOGO', L + 30, 33, { width: 40, align: 'center' });

    let y = 75;
    doc.fontSize(20).font('Helvetica-Bold').fillColor('black')
      .text('Manifest', L, y, { align: 'center', width: pageW });

    y += 28;
    doc.fontSize(12).font('Helvetica').fillColor('black')
      .text(`Generated on: ${data.current_datetime}`, L, y);

    y += 18;
    const sellerY = y;
    doc.fontSize(12).font('Helvetica-Bold').text('Seller: ', L, sellerY, { continued: true });
    doc.font('Helvetica').text(data.supplierName || '');
    doc.fontSize(12).font('Helvetica-Bold').text('Courier: ', L, sellerY + 18, { continued: true });
    doc.font('Helvetica').text(data.courierName || '');

    doc.fontSize(12).font('Helvetica')
      .text('Manifest ID : MANIFEST-0265', L, sellerY, { align: 'right', width: pageW });
    doc.text(`Total shipments to dispatch : ${data.orders.length}`, L, sellerY + 18, { align: 'right', width: pageW });

    y = sellerY + 50;

    const colW = [28, 45, 100, 100, pageW - 28 - 45 - 100 - 100];
    const headers = ['', 'S.no', 'Order no', 'Awb no', 'Contents'];
    const rowH = 28;

    doc.font('Helvetica-Bold').fontSize(10);
    let x = L;
    headers.forEach((h, i) => {
      doc.rect(x, y, colW[i], rowH).fillAndStroke('#f0f0f0', '#333333');
      doc.fillColor('black').text(h, x + 5, y + 8, { width: colW[i] - 10, lineBreak: false });
      x += colW[i];
    });
    y += rowH;

    doc.font('Helvetica').fontSize(10);
    data.orders.forEach((order, idx) => {
      x = L;
      doc.rect(x + 6, y + 7, 12, 12).stroke('#333333');
      doc.rect(x, y, colW[0], rowH).stroke('#333333');
      x += colW[0];

      const vals = [
        String(idx + 1),
        order.order_no || 'N/A',
        order.awb_no || 'N/A',
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

    doc.moveTo(L, y).lineTo(L + pageW, y).dash(4, { space: 3 }).stroke('#333333');
    y += 8;
    doc.undash();
    doc.fontSize(13).font('Helvetica-Bold').fillColor('black')
      .text(`To Be Filled By ${data.courierName || ''} Executive`, L, y, { align: 'center', width: pageW });
    y += 22;
    doc.moveTo(L, y).lineTo(L + pageW, y).dash(4, { space: 3 }).stroke('#333333');
    y += 14;
    doc.undash();

    doc.fontSize(12).font('Helvetica').fillColor('black');
    doc.text('Pick up time : ____________________', L, y);
    doc.text('FE Name: ____________________', L, y + 20);
    doc.text('FE Signature: ____________________', L, y + 40);
    doc.text('FE Phone: ____________________', L, y + 60);

    const R = L + pageW / 2 + 10;
    doc.text('Total items picked: ____________________', R, y);
    doc.text(`Seller Name: ${data.supplierName || ''}`, R, y + 20);
    doc.text('Seller Signature: ____________________', R, y + 40);

    y += 90;

    if (data.supplierAddress) {
      doc.fontSize(11).font('Helvetica').fillColor('black')
        .text(data.supplierAddress, L, y, { align: 'center', width: pageW });
      y += 18;
    }
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
// LABEL PDF
// ─────────────────────────────────────────────────────────────────────────────
function generateLabelPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ margin: 20, size: 'A4' });
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const L = 20;
    const pageW = doc.page.width - 40;
    const borderY = 20;
    let y = borderY;

    const totalHeight = 570;
    doc.rect(L, y, pageW, totalHeight).lineWidth(2).stroke('black');
    doc.lineWidth(1);

    const rowPad = 8;
    const colW = pageW / 2 - 1;
    const row1H = 90;

    doc.fontSize(11).font('Helvetica-Bold').fillColor('black')
      .text('DELIVER TO:', L + rowPad, y + rowPad);
    doc.fontSize(10).font('Helvetica')
      .text(data.customer?.name || '', L + rowPad, y + 22, { width: colW - rowPad });
    doc.text(data.customer?.address || '', L + rowPad, y + 36, { width: colW - rowPad });
    doc.text(`MOBILE NO.: ${data.customer?.phone || ''}`, L + rowPad, y + 66, { width: colW - rowPad });

    doc.moveTo(L + colW, y + 1).lineTo(L + colW, y + row1H - 1).stroke('black');

    const rx = L + colW + rowPad;
    doc.fontSize(10).font('Helvetica-Bold')
      .text('Shipped By (If undelivered, return to):', rx, y + rowPad, { width: colW - rowPad });
    doc.font('Helvetica').fontSize(9)
      .text(data.supplierAddress || '', rx, y + 32, { width: colW - rowPad });
    doc.text(`Mobile No: ${data.supplierPhone || ''}`, rx, y + 62, { width: colW - rowPad });

    y += row1H;
    doc.moveTo(L, y).lineTo(L + pageW, y).stroke('black');

    const row2H = 75;
    doc.fontSize(13).font('Helvetica-Bold').fillColor('black')
      .text(`ORDER #: ${data.order?.order_no || 'N/A'}`, L + rowPad, y + rowPad);

    const bcX = L + rowPad;
    const bcY = y + 26;
    const bcW = 160;
    const bcH = 30;
    for (let bx = bcX; bx < bcX + bcW; bx += 4) {
      doc.rect(bx, bcY, 2, bcH).fill('black');
    }

    y += row2H;
    doc.moveTo(L, y).lineTo(L + pageW, y).stroke('black');

    const row3H = 70;
    doc.fontSize(11).font('Helvetica').fillColor('black')
      .text(`WEIGHT: ${data.product?.weight || 'N/A'} | DIMENSIONS: N/A`, L + rowPad, y + rowPad);
    doc.fontSize(12).font('Helvetica-Bold')
      .text('CASH ON DELIVERY', L + rowPad, y + 22);
    doc.fontSize(12).font('Helvetica-Bold')
      .text(`COLLECT COD - Rs. ${data.product?.total_price || '0'}`, L + rowPad, y + 40);

    y += row3H;
    doc.moveTo(L, y).lineTo(L + pageW, y).stroke('black');

    const row4H = 70;
    doc.fontSize(13).font('Helvetica-Bold').fillColor('black')
      .text(data.courierName || '', L + rowPad, y + rowPad);
    doc.fontSize(10).font('Helvetica')
      .text(`AWB #: ${data.order?.awb_no || 'N/A'}`, L + rowPad, y + 22);

    const bc2X = L + rowPad;
    const bc2Y = y + 38;
    for (let bx = bc2X; bx < bc2X + 160; bx += 4) {
      doc.rect(bx, bc2Y, 2, 20).fill('black');
    }

    y += row4H;
    doc.moveTo(L, y).lineTo(L + pageW, y).stroke('black');

    const tW = [
      Math.round(pageW * 0.25),
      Math.round(pageW * 0.40),
      Math.round(pageW * 0.12),
      pageW - Math.round(pageW * 0.25) - Math.round(pageW * 0.40) - Math.round(pageW * 0.12),
    ];
    const tHeaders = ['SKU', 'ITEM', 'QTY', 'PRICE'];
    const tRowH = 24;

    doc.font('Helvetica-Bold').fontSize(10);
    let tx = L;
    tHeaders.forEach((h, i) => {
      doc.rect(tx, y, tW[i], tRowH).fillAndStroke('#f0f0f0', '#333333');
      doc.fillColor('black').text(h, tx + 4, y + 7, { width: tW[i] - 8, align: 'center', lineBreak: false });
      tx += tW[i];
    });
    y += tRowH;

    tx = L;
    doc.font('Helvetica').fontSize(10);
    const dataVals = [
      data.product?.sku || '',
      data.product?.name || '',
      String(data.product?.quantity || ''),
      `Rs. ${data.product?.total_price || '0'}`,
    ];
    dataVals.forEach((v, i) => {
      doc.rect(tx, y, tW[i], tRowH).stroke('#333333');
      doc.fillColor('black').text(v, tx + 4, y + 7, { width: tW[i] - 8, align: 'center', lineBreak: false });
      tx += tW[i];
    });
    y += tRowH;

    const totalLabelW = tW[0] + tW[1];
    const totalQtyW = tW[2];
    const totalValW = tW[3];

    doc.rect(L, y, totalLabelW, tRowH).stroke('#333333');
    doc.fontSize(10).font('Helvetica-Bold').fillColor('black')
      .text('TOTAL:', L + 4, y + 7, { width: totalLabelW - 8, align: 'left', lineBreak: false });

    doc.rect(L + totalLabelW, y, totalQtyW, tRowH).stroke('#333333');

    doc.rect(L + totalLabelW + totalQtyW, y, totalValW, tRowH).stroke('#333333');
    doc.fontSize(10).font('Helvetica-Bold').fillColor('black')
      .text(
        `Rs. ${data.product?.total_price || '0'}`,
        L + totalLabelW + totalQtyW + 4, y + 7,
        { width: totalValW - 8, align: 'center', lineBreak: false }
      );
    y += tRowH;

    doc.moveTo(L, y).lineTo(L + pageW, y).stroke('black');

    const row6H = 28;
    doc.fontSize(10).font('Helvetica').fillColor('black')
      .text(
        `Invoice No.: ${data.invoiceNo || 'N/A'} | Invoice Date: ${data.current_datetime || ''}`,
        L + rowPad, y + 8,
        { width: pageW - rowPad * 2, lineBreak: false }
      );
    y += row6H;
    doc.moveTo(L, y).lineTo(L + pageW, y).stroke('black');

    const termsPad = 10;
    const termsLineH = 16;
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

    ty += termsLineH;
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
// Shiprocket helpers
// ─────────────────────────────────────────────────────────────────────────────
async function generateToken(email, password) {
  try {
    const response = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    return { success: response.ok, token: data.token, error: data.message };
  } catch (e) {
    return { success: false, token: null, error: e.message };
  }
}

async function checkCourierServiceability(pickupPincode, deliveryPincode, weight, cod) {
  const tokenRes = await generateToken(SHIPROCKET_EMAIL(), SHIPROCKET_PASSWORD());
  if (!tokenRes.success) throw new Error('Shiprocket auth failed: ' + tokenRes.error);
  const url = `https://apiv2.shiprocket.in/v1/external/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&weight=${weight}&cod=${cod}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokenRes.token}` }
  });
  return await response.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Monday.com helpers — all accept token parameter explicitly
// ─────────────────────────────────────────────────────────────────────────────
async function uploadFileToSupplierManifestColumn(itemId, fileBuffer, fileName, columnId, token) {
  const query = `
    mutation add_file($file: File!, $itemId: ID!, $columnId: String!) {
      add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) { id }
    }
  `;

  // 1. Use the native Web FormData built into Node.js instead of the npm library
  const form = new globalThis.FormData();
  form.append('query', query);
  form.append('variables', JSON.stringify({ file: null, itemId: String(itemId), columnId }));
  form.append('map', JSON.stringify({ pdf: ['variables.file'] }));
  
  // 2. Convert your file Buffer into a native Blob type compatible with Web FormData
  const fileBlob = new globalThis.Blob([fileBuffer], { type: 'application/pdf' });
  form.append('pdf', fileBlob, fileName);

  const response = await fetch('https://api.monday.com/v2/file', {
    method: 'POST',
    headers: {
      Authorization: resolveMondayToken(token),
      'API-version': '2024-04'
      // CRITICAL: Do NOT spread form.getHeaders() here. 
      // Native fetch automatically injects the exact multipart content-type boundary.
    },
    body: form
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`File upload failed with status ${response.status}: ${errorText}`);
  }

  const resData = await response.json();
  console.log('Upload response:', JSON.stringify(resData));
  return resData;
}

async function createSupplierManifestRecord(orders, supplierName, supplierItemId, courierName, orderLineItemIds, orderId, token) {
  const { current_date } = getISTDatetime();

  const [orderColId, orderLineItemColId] = await Promise.all([
    getColumnId(SUPPLIER_MANIFEST_BOARD_ID(), 'Order', token),
    getColumnId(SUPPLIER_MANIFEST_BOARD_ID(), 'OrderLineItem', token),
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

  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      Authorization: resolveMondayToken(token),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: mutation })
  });

  if (!response.ok) {
    throw new Error(`Monday API error: ${response.status}`);
  }

  const resData = await response.json();
  if (resData?.errors?.length) console.error('createSupplierManifestRecord errors:', JSON.stringify(resData.errors));
  const itemId = resData?.data?.create_item?.id;
  return { success: !!itemId, id: itemId, errors: resData?.errors || [] };
}

async function updateOrderLineItem(itemId, status, supplierId, supplierName, courierId, courierName, boardId, manifestRecordId, token) {
  const [courierIdColId, courierNameColId, statusColId, supplierColId, supplierManifestColId] = await Promise.all([
    getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'CourierId', token),
    getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'Courier Name', token),
    getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'Status', token),
    getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'Supplier', token),
    getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'SupplierManifest', token),
  ]);

  const columnValues = {};
  if (statusColId && status) columnValues[statusColId] = { label: status };
  if (supplierColId && supplierId) columnValues[supplierColId] = { linkedPulseIds: [{ linkedPulseId: Number(supplierId) }] };
  if (courierIdColId && courierId) columnValues[courierIdColId] = String(courierId);
  if (courierNameColId && courierName) columnValues[courierNameColId] = String(courierName);
  if (supplierManifestColId && manifestRecordId) {
    columnValues[supplierManifestColId] = { linkedPulseIds: [{ linkedPulseId: Number(manifestRecordId) }] };
  }

  const mutation = `
    mutation ($itemId: ID!, $boardId: ID!, $columnValues: JSON!) {
      change_multiple_column_values(item_id: $itemId, board_id: $boardId, column_values: $columnValues) { id }
    }
  `;

  const response = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      Authorization: resolveMondayToken(token),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: mutation,
      variables: { itemId: String(itemId), boardId: String(boardId), columnValues: JSON.stringify(columnValues) }
    })
  });

  if (!response.ok) {
    throw new Error(`Monday API error: ${response.status}`);
  }

  return await response.json();
}

async function updateOrderStatus(orderId, status, token) {
  try {
    const statusColId = await getColumnId(getEnv('ORDERS_BOARD_ID'), 'Status', token);
    if (!statusColId) { console.warn('[updateOrderStatus] Status column not found'); return; }
    const columnValues = JSON.stringify({ [statusColId]: { label: status } });
    const mutation = 'mutation ($itemId: ID!, $boardId: ID!, $columnValues: JSON!) { change_multiple_column_values(item_id: $itemId, board_id: $boardId, column_values: $columnValues) { id } }';
    
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        Authorization: resolveMondayToken(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: mutation, variables: { itemId: String(orderId), boardId: String(getEnv('ORDERS_BOARD_ID')), columnValues } })
    });

    if (!response.ok) throw new Error(`Monday API error: ${response.status}`);
    const resData = await response.json();
    if (resData?.errors?.length) console.error('[updateOrderStatus] errors:', JSON.stringify(resData.errors));
    else console.log('[updateOrderStatus] order', orderId, 'updated to', status);
  } catch (e) {
    console.error('[updateOrderStatus] failed:', e.message);
  }
}

async function updateOrderAwb(orderId, awbCode, token) {
  try {
    console.log('[updateOrderAwb] START - orderId:', orderId, 'awbCode:', awbCode);
    const awbColId = await getColumnId(getEnv('ORDERS_BOARD_ID'), 'Shiprocket AWB ID', token);
    console.log('[updateOrderAwb] Column ID found:', awbColId);
    if (!awbColId) { 
      console.warn('[updateOrderAwb] Shiprocket AWB ID column not found'); 
      return; 
    }
    const columnValues = JSON.stringify({ [awbColId]: awbCode });
    console.log('[updateOrderAwb] Column values:', columnValues);
    const mutation = 'mutation ($itemId: ID!, $boardId: ID!, $columnValues: JSON!) { change_multiple_column_values(item_id: $itemId, board_id: $boardId, column_values: $columnValues) { id } }';
    const variables = { itemId: String(orderId), boardId: String(getEnv('ORDERS_BOARD_ID')), columnValues };
    console.log('[updateOrderAwb] Mutation variables:', JSON.stringify(variables));
    
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        Authorization: resolveMondayToken(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: mutation, variables })
    });

    console.log('[updateOrderAwb] Response status:', response.status, response.statusText);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[updateOrderAwb] Response error:', errorText);
      throw new Error(`Monday API error: ${response.status}`);
    }
    const resData = await response.json();
    console.log('[updateOrderAwb] Response data:', JSON.stringify(resData, null, 2));
    if (resData?.errors?.length) {
      console.error('[updateOrderAwb] GraphQL errors:', JSON.stringify(resData.errors));
    } else {
      console.log('[updateOrderAwb] SUCCESS - order', orderId, 'AWB updated to', awbCode);
    }
  } catch (e) {
    console.error('[updateOrderAwb] Exception:', e.message, e.stack);
  }
}

async function linkManifestToLineItem(lineItemId, manifestRecordId, token) {
  try {
    const colId = await getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'SupplierManifest', token);
    if (!colId) { console.warn('[linkManifestToLineItem] SupplierManifest column not found'); return; }
    const columnValues = JSON.stringify({ [colId]: { linkedPulseIds: [{ linkedPulseId: Number(manifestRecordId) }] } });
    const mutation = 'mutation ($itemId: ID!, $boardId: ID!, $columnValues: JSON!) { change_multiple_column_values(item_id: $itemId, board_id: $boardId, column_values: $columnValues) { id } }';
    
    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        Authorization: resolveMondayToken(token),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: mutation, variables: { itemId: String(lineItemId), boardId: String(ORDER_LINE_ITEMS_BOARD_ID()), columnValues } })
    });

    if (!response.ok) throw new Error(`Monday API error: ${response.status}`);
    const resData = await response.json();
    if (resData?.errors?.length) console.error('[linkManifestToLineItem] errors:', JSON.stringify(resData.errors));
  } catch (e) {
    console.error('[linkManifestToLineItem] failed:', e.message);
  }
}

async function updateOrderStatusIfAllGenerated(orderId, token) {
  try {
    const orderIdColId = await getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'Order', token);
    if (!orderIdColId) return;
    const lineItems = await getRelatedItems(ORDER_LINE_ITEMS_BOARD_ID(), orderIdColId, [parseInt(orderId)], token);
    if (!lineItems || lineItems.length === 0) return;
    const allGenerated = lineItems.every((item) => getValue('Status', item) === 'Manifest Generated');
    console.log('[updateOrderStatusIfAllGenerated] allGenerated:', allGenerated, '/', lineItems.length, 'items');
    if (allGenerated) await updateOrderStatus(orderId, 'Manifest Generated', token);
  } catch (e) {
    console.error('[updateOrderStatusIfAllGenerated] failed:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Data fetching
// ─────────────────────────────────────────────────────────────────────────────
async function getOrderWithLineitems(orderId, token) {
  const compareValue = [parseInt(orderId)];

  const [orderIdColId, productColId] = await Promise.all([
    getColumnId(ORDER_LINE_ITEMS_BOARD_ID(), 'Order', token),
    getColumnId(SUPPLIER_PRODUCT_BOARD_ID(), 'Product', token),
  ]);

  if (!orderIdColId) throw new Error(`Column "Order" not found on board ${ORDER_LINE_ITEMS_BOARD_ID()}`);
  if (!productColId) throw new Error(`Column "Product" not found on board ${SUPPLIER_PRODUCT_BOARD_ID()}`);

  const customerInfo = { id: null, name: '', email: '', phone: '', address: '', postal_code: '' };
  const orderItem = await fetchItemWithColumns(orderId, token);
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
    shiprocketShipmentId: getValue('Shiprocket Shipment ID', orderItem),
    shiprocketOrderId: getValue('Shiprocket Order ID', orderItem),
  };

  let customerId = orderData.customerId;
  if (Array.isArray(customerId) && customerId.length > 0) customerId = customerId[0];

  try {
    const customerColumns = await fetchItemWithColumns(customerId, token);
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

  const orderLineitems = await getRelatedItems(ORDER_LINE_ITEMS_BOARD_ID(), orderIdColId, compareValue, token);

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

  const supplierProductItems = await getRelatedItems(SUPPLIER_PRODUCT_BOARD_ID(), productColId, allProductIds, token);

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
    const sorted = await sortSuppliersDirectAsync(
      suppliers.map((s) => ({ price: s.rate, rating: s.rating, ...s })),
      token
    );
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
// generateManifest
// ─────────────────────────────────────────────────────────────────────────────
async function generateManifest(orderLineItems, supplierId, supplierName, supplierAddress, courierId, courierName, customer, orderId, shiprocketShipmentId, shiprocketOrderId, supplierPhone, token) {
  const orders = orderLineItems.map((item) => ({
    order_no: item.orderNumber || 'N/A',
    awb_no: 'N/A',
    contents: [item.product, item.productCode, item.sku].filter(Boolean).join(', '),
    quantity: item.quantity || 1,
    unit_price: Number(item.unitPrice || 0).toFixed(2),
    total_price: (Number(item.quantity || 1) * Number(item.unitPrice || 0)).toFixed(2),
  }));

  const manifestRecord = await createSupplierManifestRecord(
    orders, supplierName, supplierId, courierName,
    orderLineItems.map((i) => i.id).filter(Boolean), orderId, token
  );
  supplierManifestMondayRecordId = manifestRecord.id;
  console.log('[generateManifest] record created:', supplierManifestMondayRecordId);

  const { current_datetime, current_date } = getISTDatetime();
  console.log('[generateManifest] generating PDF...');

  const pdfBuffer = await generateManifestPdf({
    orders,
    supplierName,
    supplierAddress,
    supplierPhone: '',
    courierName,
    current_datetime,
  });

  console.log('[generateManifest] PDF generated, size:', pdfBuffer.length);
  const fileName = sanitizeFilename(`${supplierName}_${courierName}_(${current_date}).pdf`);

  const manifestFileColId = await getColumnId(SUPPLIER_MANIFEST_BOARD_ID(), 'Manifest File', token);
  await uploadFileToSupplierManifestColumn(supplierManifestMondayRecordId, pdfBuffer, fileName, manifestFileColId, token);

  for (const item of orderLineItems) {
    if (item.id) {
      try {
        await updateOrderLineItem(
          parseInt(item.id), 'Manifest Generated', supplierId, supplierName,
          courierId, courierName, ORDER_LINE_ITEMS_BOARD_ID(), supplierManifestMondayRecordId, token
        );
      } catch (e) {
        console.error('Failed to update line item', item.id, e.message);
      }
    }
  }

  if (orderId) await updateOrderStatusIfAllGenerated(orderId, token);

  for (const item of orderLineItems) {
    if (item.id && supplierManifestMondayRecordId) {
      await linkManifestToLineItem(item.id, supplierManifestMondayRecordId, token);
    }
  }

  // ── Shiprocket: Step 1 — Update Pickup Address ────────────────────────
  if (shiprocketOrderId) {
    console.log('[generateManifest] ===== STEP 1: ASSIGN PICKUP LOCATION =====');
    console.log('[generateManifest] shiprocketOrderId:', shiprocketOrderId);
    console.log('[generateManifest] supplierName:', supplierName);
    console.log('[generateManifest] supplierAddress:', supplierAddress);
    console.log('[generateManifest] supplierPhone:', supplierPhone);
    await assignPickupLocation(shiprocketOrderId, supplierName, supplierAddress, supplierPhone || '');
  } else {
    console.warn('[generateManifest] No shiprocketOrderId — skipping pickup location update');
  }

  // ── Shiprocket: Step 2 — Assign AWB + Generate Pickup ─────────────────
  console.log('[generateManifest] ===== STEP 2: ASSIGN AWB =====');
  console.log('[generateManifest] shiprocketShipmentId:', shiprocketShipmentId);
  console.log('[generateManifest] courierId:', courierId);
  console.log('[generateManifest] orderId:', orderId);
  
  if (shiprocketShipmentId) {
    console.log('[generateManifest] calling assignAwb...');
    const awbResult = await assignAwb(shiprocketShipmentId, courierId);
    console.log('[generateManifest] assignAwb returned:', JSON.stringify(awbResult, null, 2));

    const awbSuccess = awbResult?.awb_assign_status === 1;
    console.log('[generateManifest] awbSuccess:', awbSuccess);
    
    if (!awbSuccess) {
      const awbError = awbResult?.response?.data?.awb_assign_error || 'AWB assignment failed';
      console.warn('[generateManifest] AWB assignment failed:', awbError, '— skipping pickup schedule');
    } else {
      const awbCode = awbResult?.response?.data?.awb_code;
      console.log('[generateManifest] awbCode extracted:', awbCode);
      
      let shipmentRecordId = null;
      
      if (awbCode && orderId) {
        console.log('[generateManifest] updating order', orderId, 'with AWB:', awbCode);
        await updateOrderAwb(orderId, awbCode, token);
        
        console.log('[generateManifest] creating shipment record...');
        const shipmentRecord = await createShipmentRecord(orderId, courierId, courierName, supplierName, supplierAddress, awbCode, token);
        shipmentRecordId = shipmentRecord.id;
        console.log('[generateManifest] shipmentRecordId:', shipmentRecordId);
      } else {
        console.warn('[generateManifest] Cannot update AWB - awbCode:', awbCode, 'orderId:', orderId);
      }
      
      console.log('[generateManifest] ===== STEP 3: GENERATE PICKUP =====');
      const pickupResult = await generatePickup(shiprocketShipmentId);
      console.log('[generateManifest] generatePickup returned:', JSON.stringify(pickupResult, null, 2));
      
      if (pickupResult && shipmentRecordId) {
        const pickupScheduledDate = pickupResult?.response?.pickup_scheduled_date;
        const pickupGeneratedDate = pickupResult?.response?.pickup_generated_date?.date || new Date().toISOString();
        console.log('[generateManifest] updating shipment pickup dates...');
        console.log('[generateManifest] pickupScheduledDate:', pickupScheduledDate);
        console.log('[generateManifest] pickupGeneratedDate:', pickupGeneratedDate);
        await updateShipmentPickupDates(shipmentRecordId, pickupScheduledDate, pickupGeneratedDate, token);
      }
    }
  } else {
    console.warn('[generateManifest] No shiprocketShipmentId — skipping AWB and pickup schedule');
  }

  return { supplierName, supplierId, courierName, courierId, totalOrders: orders.length, orders };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateLabel
// ─────────────────────────────────────────────────────────────────────────────
async function generateLabel(lineitems, supplierId, supplierName, supplierAddress, courierId, courierName, customer, token) {
  const pdfBuffers = [];
  const { current_date, current_datetime } = getISTDatetime();

  for (const item of lineitems) {
    const labelData = {
      order: { order_no: item.orderNumber || 'N/A', awb_no: 'N/A' },
      customer,
      product: {
        name: item.product,
        sku: item.sku,
        weight: item.productWeight,
        unit_price: Number(item.unitPrice || 0).toFixed(2),
        quantity: item.quantity || 1,
        total_price: (Number(item.quantity || 1) * Number(item.unitPrice || 0)).toFixed(2),
      },
      invoiceNo: item.orderNumber || 'N/A',
      supplierName,
      supplierAddress,
      supplierPhone: '',
      courierName,
      current_datetime,
    };
    const pdfBuffer = await generateLabelPdf(labelData);
    pdfBuffers.push(pdfBuffer);
  }

  const mergedBuffer = await mergePdfs(pdfBuffers);
  const fileName = sanitizeFilename(`merged_labels_${courierName}_(${current_date}).pdf`);
  const labelFileColId = await getColumnId(SUPPLIER_MANIFEST_BOARD_ID(), 'Label File', token);
  await uploadFileToSupplierManifestColumn(supplierManifestMondayRecordId, mergedBuffer, fileName, labelFileColId, token);

  return lineitems.map((item) => ({ order_no: item.orderNumber || 'N/A' }));
}


async function assignAwb(shipmentId, courierId) {
  try {
    console.log('[assignAwb] START - shipmentId:', shipmentId, 'courierId:', courierId);
    const tokenRes = await generateToken(SHIPROCKET_EMAIL(), SHIPROCKET_PASSWORD());
    if (!tokenRes.success) {
      console.error('[assignAwb] Auth failed:', tokenRes.error);
      throw new Error('Shiprocket auth failed: ' + tokenRes.error);
    }
    console.log('[assignAwb] Auth successful, calling Shiprocket API...');
    const payload = { shipment_id: String(shipmentId), courier_id: String(courierId) };
    console.log('[assignAwb] Payload:', JSON.stringify(payload));
    
    const response = await fetch('https://apiv2.shiprocket.in/v1/external/courier/assign/awb', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenRes.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log('[assignAwb] Response status:', response.status, response.statusText);
    const data = await response.json();
    console.log('[assignAwb] Response data:', JSON.stringify(data, null, 2));
    console.log('[assignAwb] awb_assign_status:', data?.awb_assign_status);
    console.log('[assignAwb] awb_code:', data?.response?.data?.awb_code);
    return data;
  } catch (e) {
    console.error('[assignAwb] Exception:', e.message, e.stack);
    return null;
  }
}

async function generatePickup(shipmentId) {
  try {
    console.log('[generatePickup] START - shipmentId:', shipmentId);
    const tokenRes = await generateToken(SHIPROCKET_EMAIL(), SHIPROCKET_PASSWORD());
    if (!tokenRes.success) {
      console.error('[generatePickup] Auth failed:', tokenRes.error);
      throw new Error('Shiprocket auth failed: ' + tokenRes.error);
    }
    console.log('[generatePickup] Auth successful, calling Shiprocket API...');
    const payload = { shipment_id: [String(shipmentId)] };
    console.log('[generatePickup] Payload:', JSON.stringify(payload));
    
    const response = await fetch('https://apiv2.shiprocket.in/v1/external/courier/generate/pickup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenRes.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log('[generatePickup] Response status:', response.status, response.statusText);
    const data = await response.json();
    console.log('[generatePickup] Response data:', JSON.stringify(data, null, 2));
    return data;
  } catch (e) {
    console.error('[generatePickup] Exception:', e.message, e.stack);
    return null;
  }
}


async function trackShipment(shiprocketOrderId) {
  try {
    const tokenRes = await generateToken(SHIPROCKET_EMAIL(), SHIPROCKET_PASSWORD());
    if (!tokenRes.success) throw new Error('Shiprocket auth failed: ' + tokenRes.error);
    const response = await fetch(
      `https://apiv2.shiprocket.in/v1/external/courier/track?order_id=${shiprocketOrderId}`,
      { headers: { Authorization: `Bearer ${tokenRes.token}`, 'Content-Type': 'application/json' } }
    );
    const data = await response.json();
    console.log('[trackShipment] orderId:', shiprocketOrderId, 'status:', response.status);
    return data;
  } catch (e) {
    console.error('[trackShipment] failed:', e.message);
    throw e;
  }
}


async function getShiprocketPickupLocations() {
  try {
    const tokenRes = await generateToken(SHIPROCKET_EMAIL(), SHIPROCKET_PASSWORD());
    if (!tokenRes.success) throw new Error('Shiprocket auth failed: ' + tokenRes.error);
    const response = await fetch('https://apiv2.shiprocket.in/v1/external/settings/company/pickup', {
      headers: { Authorization: `Bearer ${tokenRes.token}`, 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    console.log('[getShiprocketPickupLocations] found:', data?.data?.shipping_address?.length || 0, 'locations');
    return data?.data?.shipping_address || [];
  } catch (e) {
    console.error('[getShiprocketPickupLocations] failed:', e.message);
    return [];
  }
}

function normalizeStr(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scoreAddressMatch(supplierAddress, supplierName, loc) {
  let score = 0;
  const sa = (supplierAddress || '').toLowerCase();

  // Extract pin code from supplier address
  const supplierPin = (sa.match(/\b(\d{6})\b/) || [])[1] || '';
  const locPin = normalizeStr(loc.pin_code);

  // Pin code match — highest weight (most reliable)
  if (supplierPin && locPin && supplierPin === locPin) score += 50;

  // City match
  const locCity = normalizeStr(loc.city);
  if (locCity && sa.includes(loc.city.toLowerCase())) score += 20;

  // State match
  const locState = normalizeStr(loc.state);
  if (locState && sa.includes(loc.state.toLowerCase())) score += 15;

  // Supplier name match against location name
  const locName = normalizeStr(loc.name);
  const supName = normalizeStr(supplierName);
  if (supName && locName && (locName.includes(supName) || supName.includes(locName))) score += 10;

  // Address words match — check if significant words from loc address appear in supplier address
  const locAddrWords = (loc.address || '').toLowerCase().split(/[\s,]+/).filter(w => w.length > 3);
  const matchedWords = locAddrWords.filter(w => sa.includes(w));
  if (locAddrWords.length > 0) score += Math.round((matchedWords.length / locAddrWords.length) * 10);

  // Pickup location name contains supplier name
  const locPickup = normalizeStr(loc.pickup_location);
  if (supName && locPickup && (locPickup.includes(supName) || supName.includes(locPickup))) score += 5;

  return score;
}

function matchSupplierToPickup(supplierAddress, supplierName, pickupLocations) {
  if (!pickupLocations || pickupLocations.length === 0) return null;

  console.log('[matchSupplierToPickup] checking', pickupLocations.length, 'locations for supplier:', supplierName);
  console.log('[matchSupplierToPickup] supplierAddress:', supplierAddress);

  let bestMatch = null;
  let bestScore = 0;

  for (const loc of pickupLocations) {
    const score = scoreAddressMatch(supplierAddress, supplierName, loc);
    console.log(`[matchSupplierToPickup] "${loc.pickup_location}" score: ${score}`);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = loc;
    }
  }

  // Require minimum score of 50 (at least pin code must match)
  if (bestScore >= 50) {
    console.log('[matchSupplierToPickup] matched:', bestMatch.pickup_location, 'with score:', bestScore);
    return bestMatch;
  }

  console.log('[matchSupplierToPickup] no confident match found (best score:', bestScore, ')');
  return null;
}

function parseSupplierAddress(supplierAddress) {
  const raw = (supplierAddress || '').trim();

  // Extract 6-digit pin code
  const pinMatch = raw.match(/\b(\d{6})\b/);
  const pinCode = pinMatch ? pinMatch[1] : '';

  // Remove pin code from string for cleaner parsing
  const withoutPin = raw.replace(/[-–]?\s*\d{6}/, '').trim().replace(/,\s*$/, '').trim();

  // Split by comma
  const parts = withoutPin.split(',').map(s => s.trim()).filter(Boolean);

  let city = '';
  let state = '';
  let address = '';

  if (parts.length === 1) {
    address = parts[0];
  } else if (parts.length === 2) {
    address = parts[0];
    city = parts[1];
  } else if (parts.length === 3) {
    address = parts[0];
    city = parts[1];
    state = parts[2];
  } else if (parts.length >= 4) {
    // Last part is state, second-to-last is city, rest is address
    state = parts[parts.length - 1];
    city = parts[parts.length - 2];
    address = parts.slice(0, parts.length - 2).join(', ');
  }

  // Clean up state — remove any leftover digits or dashes
  state = state.replace(/[\d\-–]/g, '').trim();
  // Clean up city — remove digits
  city = city.replace(/\d/g, '').trim();

  console.log('[parseSupplierAddress] raw:', raw);
  console.log('[parseSupplierAddress] parsed ->', { address, city, state, pinCode });

  return { address, city, state, pinCode };
}

async function createShiprocketPickupLocation(supplierName, supplierAddress, supplierPhone) {
  try {
    const tokenRes = await generateToken(SHIPROCKET_EMAIL(), SHIPROCKET_PASSWORD());
    if (!tokenRes.success) throw new Error('Shiprocket auth failed: ' + tokenRes.error);

    const { address, city, state, pinCode } = parseSupplierAddress(supplierAddress);
    const payload = {
      pickup_location: supplierName,
      name: supplierName,
      email: getEnv('SHIPROCKET_EMAIL'),
      phone: (supplierPhone || '').replace(/[^0-9]/g, '').slice(-10),
      address,
      address_2: '',
      city,
      state,
      country: 'India',
      pin_code: pinCode,
      lat: '',
      long: '',
      vendor_name: supplierName,
      phone_verified: true,
    };
    console.log('[createShiprocketPickupLocation] creating:', JSON.stringify(payload));

    const response = await fetch('https://apiv2.shiprocket.in/v1/external/settings/company/addpickup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenRes.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    console.log('[createShiprocketPickupLocation] response:', JSON.stringify(data));
    return data;
  } catch (e) {
    console.error('[createShiprocketPickupLocation] failed:', e.message);
    return null;
  }
}

async function updateOrderPickupLocation(shiprocketOrderId, pickupLocationName) {
  try {
    const tokenRes = await generateToken(SHIPROCKET_EMAIL(), SHIPROCKET_PASSWORD());
    if (!tokenRes.success) throw new Error('Shiprocket auth failed: ' + tokenRes.error);
    const response = await fetch('https://apiv2.shiprocket.in/v1/external/orders/address/pickup', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenRes.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: [Number(shiprocketOrderId)], pickup_location: pickupLocationName }),
    });
    const data = await response.json();
    console.log('[updateOrderPickupLocation] response:', JSON.stringify(data));
    return data;
  } catch (e) {
    console.error('[updateOrderPickupLocation] failed:', e.message);
    return null;
  }
}

async function assignPickupLocation(shiprocketOrderId, supplierName, supplierAddress, supplierPhone) {
  console.log('[assignPickupLocation] starting for order:', shiprocketOrderId, 'supplier:', supplierName);

  // Step 1: get all pickup locations
  const pickupLocations = await getShiprocketPickupLocations();

  // Step 2: try to match supplier address
  let matched = matchSupplierToPickup(supplierAddress, supplierName, pickupLocations);

  // Step 3: if no match, create new pickup location
  if (!matched) {
    console.log('[assignPickupLocation] no match — creating new pickup location for:', supplierName);
    await createShiprocketPickupLocation(supplierName, supplierAddress, supplierPhone);
    // Use supplier name as pickup_location name
    matched = { pickup_location: supplierName };
  }

  // Step 4: update order pickup location
  const pickupName = matched.pickup_location;
  console.log('[assignPickupLocation] updating order pickup to:', pickupName);
  await updateOrderPickupLocation(shiprocketOrderId, pickupName);
}

module.exports = { getOrderWithLineitems, generateManifest, generateLabel, checkCourierServiceability, trackShipment };


function formatDateTimeForMonday(dateString) {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    const day = date.getDate();
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${day} ${month} ${year} ${hours}:${minutes} ${ampm}`;
  } catch (e) {
    console.error('[formatDateTimeForMonday] failed:', e.message);
    return null;
  }
}

async function createShipmentRecord(orderId, courierCompanyId, courierName, shipperName, shipperAddress, awbCode, token) {
  try {
    console.log('[createShipmentRecord] START - orderId:', orderId);
    console.log('[createShipmentRecord] courierCompanyId:', courierCompanyId);
    console.log('[createShipmentRecord] courierName:', courierName);
    console.log('[createShipmentRecord] shipperName:', shipperName);
    console.log('[createShipmentRecord] shipperAddress:', shipperAddress);
    console.log('[createShipmentRecord] awbCode:', awbCode);
    
    const shipmentsBoardId = getEnv('SHIPMENTS_BOARD_ID');
    console.log('[createShipmentRecord] SHIPMENTS_BOARD_ID:', shipmentsBoardId);

    const [ordersColId, assignedDateColId, courierIdColId, courierNameColId, shipperNameColId, shipperAddressColId] = await Promise.all([
      getColumnId(shipmentsBoardId, 'Orders', token),
      getColumnId(shipmentsBoardId, 'Assigned Date', token),
      getColumnId(shipmentsBoardId, 'Courier Company Id', token),
      getColumnId(shipmentsBoardId, 'Courier Name', token),
      getColumnId(shipmentsBoardId, 'Shipper Company Name', token),
      getColumnId(shipmentsBoardId, 'Shipper Address', token),
    ]);

    console.log('[createShipmentRecord] Column IDs:', {
      ordersColId,
      assignedDateColId,
      courierIdColId,
      courierNameColId,
      shipperNameColId,
      shipperAddressColId
    });

    const assignedDateTime = formatDateTimeForMonday(new Date().toISOString());
    console.log('[createShipmentRecord] assignedDateTime:', assignedDateTime);
    
    const itemName = `Shipment - ${awbCode || 'N/A'}`;
    console.log('[createShipmentRecord] itemName:', itemName);
    
    const columnValues = {};
    if (ordersColId && orderId) {
      columnValues[ordersColId] = { linkedPulseIds: [{ linkedPulseId: Number(orderId) }] };
    }
    if (assignedDateColId && assignedDateTime) {
      columnValues[assignedDateColId] = String(assignedDateTime);
    }
    if (courierIdColId && courierCompanyId) {
      columnValues[courierIdColId] = String(courierCompanyId);
    }
    if (courierNameColId && courierName) {
      columnValues[courierNameColId] = String(courierName);
    }
    if (shipperNameColId && shipperName) {
      columnValues[shipperNameColId] = String(shipperName);
    }
    if (shipperAddressColId && shipperAddress) {
      columnValues[shipperAddressColId] = String(shipperAddress);
    }

    console.log('[createShipmentRecord] columnValues:', JSON.stringify(columnValues, null, 2));

    const columnValuesStr = JSON.stringify(JSON.stringify(columnValues));
    console.log('[createShipmentRecord] columnValuesStr:', columnValuesStr);
    
    const mutation = `
      mutation {
        create_item(
          board_id: ${shipmentsBoardId},
          item_name: "${itemName}",
          column_values: ${columnValuesStr}
        ) { id }
      }
    `;
    console.log('[createShipmentRecord] mutation:', mutation);

    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        Authorization: resolveMondayToken(token),
        'Content-Type': 'application/json',
        'API-Version': '2024-10'
      },
      body: JSON.stringify({ query: mutation })
    });

    console.log('[createShipmentRecord] Response status:', response.status, response.statusText);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[createShipmentRecord] Response error:', errorText);
      throw new Error(`Monday API error: ${response.status}`);
    }

    const resData = await response.json();
    console.log('[createShipmentRecord] Response data:', JSON.stringify(resData, null, 2));
    if (resData?.errors?.length) {
      console.error('[createShipmentRecord] GraphQL errors:', JSON.stringify(resData.errors, null, 2));
    }
    const shipmentId = resData?.data?.create_item?.id;
    console.log('[createShipmentRecord] SUCCESS - shipment record created:', shipmentId);
    return { success: !!shipmentId, id: shipmentId };
  } catch (e) {
    console.error('[createShipmentRecord] Exception:', e.message, e.stack);
    return { success: false, id: null };
  }
}

async function updateShipmentPickupDates(shipmentRecordId, pickupScheduledDate, pickupGeneratedDate, token) {
  try {
    console.log('[updateShipmentPickupDates] START - shipmentRecordId:', shipmentRecordId);
    const shipmentsBoardId = getEnv('SHIPMENTS_BOARD_ID');

    const [pickupScheduledColId, pickupGeneratedColId] = await Promise.all([
      getColumnId(shipmentsBoardId, 'Pickup Scheduled Date', token),
      getColumnId(shipmentsBoardId, 'Pickup Generated Date', token),
    ]);

    console.log('[updateShipmentPickupDates] Column IDs:', { pickupScheduledColId, pickupGeneratedColId });

    const columnValues = {};
    if (pickupScheduledColId && pickupScheduledDate) {
      const formatted = formatDateTimeForMonday(pickupScheduledDate);
      console.log('[updateShipmentPickupDates] pickupScheduledDate formatted:', formatted);
      if (formatted) {
        columnValues[pickupScheduledColId] = String(formatted);
      }
    }
    if (pickupGeneratedColId && pickupGeneratedDate) {
      const formatted = formatDateTimeForMonday(pickupGeneratedDate);
      console.log('[updateShipmentPickupDates] pickupGeneratedDate formatted:', formatted);
      if (formatted) {
        columnValues[pickupGeneratedColId] = String(formatted);
      }
    }

    if (Object.keys(columnValues).length === 0) {
      console.warn('[updateShipmentPickupDates] No dates to update');
      return;
    }

    console.log('[updateShipmentPickupDates] columnValues:', JSON.stringify(columnValues, null, 2));

    const mutation = 'mutation ($itemId: ID!, $boardId: ID!, $columnValues: JSON!) { change_multiple_column_values(item_id: $itemId, board_id: $boardId, column_values: $columnValues) { id } }';
    const variables = { itemId: String(shipmentRecordId), boardId: String(shipmentsBoardId), columnValues: JSON.stringify(columnValues) };

    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        Authorization: resolveMondayToken(token),
        'Content-Type': 'application/json',
        'API-Version': '2024-10'
      },
      body: JSON.stringify({ query: mutation, variables })
    });

    console.log('[updateShipmentPickupDates] Response status:', response.status, response.statusText);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[updateShipmentPickupDates] Response error:', errorText);
      throw new Error(`Monday API error: ${response.status}`);
    }

    const resData = await response.json();
    console.log('[updateShipmentPickupDates] Response data:', JSON.stringify(resData, null, 2));
    if (resData?.errors?.length) {
      console.error('[updateShipmentPickupDates] GraphQL errors:', JSON.stringify(resData.errors, null, 2));
    } else {
      console.log('[updateShipmentPickupDates] SUCCESS - pickup dates updated');
    }
  } catch (e) {
    console.error('[updateShipmentPickupDates] Exception:', e.message, e.stack);
  }
}

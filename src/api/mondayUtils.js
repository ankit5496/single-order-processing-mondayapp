const { EnvironmentVariablesManager } = require('@mondaycom/apps-sdk');
const jwt = require('jsonwebtoken');

const env = new EnvironmentVariablesManager();

const getEnv = (key) => env.get(key) || process.env[key];

// Resolves short-lived context tokens on Monday hosting vs API tokens on localhost
// Update this function inside srcc/api/mondayUtils.js

const resolveMondayToken = (headerToken) => {
  const token = headerToken ? headerToken.trim() : null;
  if (!token) {
    return getEnv('MONDAY_API_KEY');
  }

  try {
    const signingSecret = getEnv('MONDAY_SIGNING_SECRET');
    if (signingSecret) {
      // Try to decode as a Monday hosting session context token
      const decoded = jwt.verify(token, signingSecret);
      if (decoded) {
        // Verified Monday Hosting Context Token
        if (decoded.shortLivedToken) return decoded.shortLivedToken;
        if (decoded.dat && decoded.dat.shortLivedToken) return decoded.dat.shortLivedToken;
        
        // Fallback to master backend key for standard views on production hosting
        return getEnv('MONDAY_API_KEY');
      }
    }
  } catch (err) {
    // CRITICAL FIX FOR LOCALHOST:
    // If verification fails, it means this is NOT a signed context token.
    // It is your ACTUAL User Personal API Bearer Token (passed from localhost)!
    // Return it directly so native fetch executes queries with your real account access.
    return token;
  }

  return token || getEnv('MONDAY_API_KEY');
};

const setRequestToken = (token) => {
  // Maintained as no-op to support any legacy code references safely without global race conditions
};

const getApiKey = () => getEnv('MONDAY_API_KEY');

const headers = (token) => ({
  Authorization: resolveMondayToken(token),
  'Content-Type': 'application/json',
});

const apiUrl = () => 'https://api.monday.com/v2';

async function fetchItemWithColumns(itemId, token) {
  const query = `
    query {
      items(ids: ${itemId}) {
        id
        name
        column_values {
          column { title }
          id
          text
          value
          ... on MirrorValue { display_value text value }
          ... on BoardRelationValue { linked_item_ids display_value }
          ... on FormulaValue { value id display_value }
        }
      }
    }
  `;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(apiUrl(), {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ query }),
      });

      if (response.status === 503 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }

      if (!response.ok) {
        throw new Error(`Monday API error: ${response.status} ${response.statusText}`);
      }

      const resData = await response.json();
      const items = resData?.data?.items;
      if (!items || items.length === 0) return null;
      return items[0];
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
}

async function getRelatedItems(boardId, columnId, compareValues, token) {
  const query = `
    query {
      boards(ids: ${boardId}) {
        items_page(query_params: {
          rules: [{ column_id: "${columnId}", compare_value: ${JSON.stringify(compareValues)} }],
          operator: or
        }) {
          cursor
          items {
            id
            name
            column_values {
              column { title }
              id
              text
              value
              ... on MirrorValue { display_value text value }
              ... on BoardRelationValue { linked_item_ids display_value }
              ... on FormulaValue { value id display_value }
            }
          }
        }
      }
    }
  `;
  const response = await fetch(apiUrl(), {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`Monday API error: ${response.status}`);
  }

  const resData = await response.json();
  const boards = resData?.data?.boards || [];
  let items = [];
  for (const board of boards) {
    items = board?.items_page?.items || [];
  }
  return items;
}

const _columnCache = {};

async function getColumnId(boardId, columnTitle, token) {
  if (!_columnCache[boardId]) {
    const query = `
      query ($boardId: [ID!]) {
        boards(ids: $boardId) {
          columns { id title type }
        }
      }
    `;
    const response = await fetch(apiUrl(), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({ query, variables: { boardId: String(boardId) } }),
    });

    if (!response.ok) {
      throw new Error(`Monday API error: ${response.status}`);
    }

    const resData = await response.json();
    const board = resData?.data?.boards?.[0];
    if (!board) throw new Error(`Board ${boardId} not found or not accessible`);
    _columnCache[boardId] = board.columns;
    console.log(`[getColumnId] cached ${_columnCache[boardId].length} columns for board ${boardId}`);
  }

  const match = _columnCache[boardId].find(
    (col) => col.title.toLowerCase() === columnTitle.toLowerCase().trim()
  );

  if (!match) {
    console.warn(`[getColumnId] "${columnTitle}" not found on board ${boardId}`);
    return null;
  }

  return match.id;
}

function getValue(title, item) {
  for (const col of item.column_values || []) {
    if (col.column?.title === title) {
      return col.text || col.display_value || (col.value && col.value !== 'null' ? col.value : null) || null;
    }
  }
  return null;
}

function getDisplayValue(title, item) {
  for (const col of item.column_values || []) {
    if (col.column?.title === title) {
      return col.display_value || null;
    }
  }
  return null;
}

function getLinkedItemIds(title, item) {
  for (const col of item.column_values || []) {
    if (col.column?.title === title) {
      return col.linked_item_ids || null;
    }
  }
  return null;
}

async function getWeightageValues(token) {
  const defaultWeights = {
    courier_rating: 0.35,
    courier_delivery_days: 0.25,
    courier_price: 0.40,
    supplier_price: 0.55,
    supplier_rating: 0.45,
  };

  const itemIds = [getEnv('SUPPLIER_SORTING_ITEM_ID'), getEnv('COURIER_SORTING_ITEM_ID')];
  const query = `
    query {
      items(ids: [${itemIds.join(',')}]) {
        id
        name
        column_values {
          column { title }
          id text value
          ... on MirrorValue { display_value text value }
          ... on BoardRelationValue { linked_item_ids display_value }
          ... on FormulaValue { value id display_value }
        }
      }
    }
  `;

  try {
    let resData;

    // Retry loop up to 3 attempts to gracefully recover from 503 status down-times
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(apiUrl(), {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify({ query }),
      });

      // Handle 503 Service Unavailable with a short backoff delay
      if (response.status === 503 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }

      if (!response.ok) {
        throw new Error(`Monday API error: ${response.status}`);
      }

      resData = await response.json();
      break; // Request successful, safely break out of retry loop
    }

    const items = resData?.data?.items || [];
    const weights = { ...defaultWeights };

    for (const item of items) {
      if (item.name === 'Courier_Sorting') {
        weights.courier_rating = parseFloat(getValue('Rating', item)) || weights.courier_rating;
        weights.courier_delivery_days = parseFloat(getValue('Estimated Delivery Days', item)) || weights.courier_delivery_days;
        weights.courier_price = parseFloat(getValue('Price', item)) || weights.courier_price;
      } else if (item.name === 'Supplier_Sorting') {
        weights.supplier_price = parseFloat(getValue('Price', item)) || weights.supplier_price;
        weights.supplier_rating = parseFloat(getValue('Rating', item)) || weights.supplier_rating;
      }
    }
    return weights;
  } catch (e) {
    console.error('Error fetching weights:', e.message);
    return defaultWeights;
  }
}

async function sortSuppliersDirectAsync(suppliers, token) {
  if (!suppliers || suppliers.length <= 1) return suppliers;

  const prices = suppliers.filter((s) => s.price != null).map((s) => parseFloat(s.price));
  const ratings = suppliers.filter((s) => s.rating != null).map((s) => parseFloat(s.rating));

  if (!prices.length || !ratings.length) return suppliers;

  const minPrice = Math.min(...prices), maxPrice = Math.max(...prices);
  const minRating = Math.min(...ratings), maxRating = Math.max(...ratings);
  const weights = await getWeightageValues(token);

  return suppliers
    .map((s) => {
      const price = parseFloat(s.price || 0);
      const rating = parseFloat(s.rating || 0);
      const normPrice = maxPrice === minPrice ? 1 : (maxPrice - price) / (maxPrice - minPrice);
      const normRating = maxRating === minRating ? 1 : (rating - minRating) / (maxRating - minRating);
      const score = weights.supplier_price * normPrice + weights.supplier_rating * normRating;
      return { ...s, final_score: score };
    })
    .sort((a, b) => b.final_score - a.final_score);
}

async function sortCouriersDirect(couriers, token) {
  if (!couriers || couriers.length <= 1) return couriers;

  const ratings = couriers.map((c) => parseFloat(c.rating || 0));
  const days = couriers.map((c) => parseFloat(c.estimated_delivery_days || 0));
  const charges = couriers.map((c) => parseFloat(c.freight_charge || 0));

  const minRating = Math.min(...ratings), maxRating = Math.max(...ratings);
  const minDays = Math.min(...days), maxDays = Math.max(...days);
  const minCharge = Math.min(...charges), maxCharge = Math.max(...charges);
  const weights = await getWeightageValues(token);

  return couriers
    .map((c) => {
      const rating = parseFloat(c.rating || 0);
      const deliveryDays = parseFloat(c.estimated_delivery_days || 0);
      const freightCharge = parseFloat(c.freight_charge || 0);
      const ratingScore = maxRating === minRating ? 1 : (rating - minRating) / (maxRating - minRating);
      const speedScore = maxDays === minDays ? 1 : 1 - (deliveryDays - minDays) / (maxDays - minDays);
      const costScore = maxCharge === minCharge ? 1 : 1 - (freightCharge - minCharge) / (maxCharge - minCharge);
      const score = weights.courier_rating * ratingScore + weights.courier_delivery_days * speedScore + weights.courier_price * costScore;
      return { ...c, final_score: score };
    })
    .sort((a, b) => b.final_score - a.final_score);
}

module.exports = {
  fetchItemWithColumns,
  getRelatedItems,
  getColumnId,
  getValue,
  getDisplayValue,
  getLinkedItemIds,
  sortSuppliersDirectAsync,
  sortCouriersDirect,
  getEnv,
  getApiKey,
  setRequestToken,
  resolveMondayToken,
};
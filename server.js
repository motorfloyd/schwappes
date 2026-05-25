const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-AU,en;q=0.9',
  'Cache-Control': 'no-cache',
};

// --- Coles proxy ---
app.get('/api/coles', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query parameter: q' });

  // Try multiple known Coles API endpoints in order
  const endpoints = [
    `https://www.coles.com.au/api/2.0/product-list/search?q=${encodeURIComponent(query)}&pageNo=1&pageSize=10`,
    `https://www.coles.com.au/api/2.0/product-list/browse?q=${encodeURIComponent(query)}&pageNo=1&pageSize=10`,
    `https://api.coles.com.au/customer/v1/coles/products/search?q=${encodeURIComponent(query)}&pageSize=10`,
  ];

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        headers: {
          ...BROWSER_HEADERS,
          'Referer': 'https://www.coles.com.au/search?q=' + encodeURIComponent(query),
          'Origin': 'https://www.coles.com.au',
        },
        timeout: 8000,
      });

      if (response.ok) {
        const data = await response.json();
        const products = parseColes(data);
        return res.json({ store: 'coles', query, products });
      }
    } catch (err) {
      // try next endpoint
    }
  }

  // All endpoints failed — return blocked status with search URL
  return res.status(503).json({
    store: 'coles',
    query,
    blocked: true,
    products: [],
    searchUrl: `https://www.coles.com.au/search?q=${encodeURIComponent(query)}`,
    error: 'Coles is blocking automated requests from this server. Use the search link to check manually.',
  });
});

function parseColes(data) {
  const results = data?.results || data?.catalogEntryView || data?.data?.results || [];
  return results.slice(0, 5).map(p => ({
    name: p.name || p.seoName || 'Unknown',
    brand: p.brand || '',
    price: p.pricing?.now ?? p.price?.value ?? null,
    wasPrice: p.pricing?.was ?? null,
    isSpecial: p.pricing?.isSpecial ?? false,
    size: p.size || p.unitPricingMeasure || '',
    unitPrice: p.pricing?.comparable || null,
    imageUrl: p.imageUris?.[0] || p.mediumImage || null,
    url: p.seoToken ? `https://www.coles.com.au/product/${p.seoToken}` : null,
  }));
}

// --- Woolworths proxy ---
app.get('/api/woolworths', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query parameter: q' });

  const endpoints = [
    `https://www.woolworths.com.au/apis/ui/Search/products?searchTerm=${encodeURIComponent(query)}&pageNumber=1&pageSize=10&sortType=TraderRelevance&isMobile=false`,
    `https://www.woolworths.com.au/apis/ui/search/search?searchTerm=${encodeURIComponent(query)}&pageNumber=1&pageSize=10`,
  ];

  for (const url of endpoints) {
    try {
      const response = await fetch(url, {
        headers: {
          ...BROWSER_HEADERS,
          'Referer': 'https://www.woolworths.com.au/shop/search/products?searchTerm=' + encodeURIComponent(query),
          'Origin': 'https://www.woolworths.com.au',
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 8000,
      });

      if (response.ok) {
        const data = await response.json();
        const products = parseWoolworths(data);
        return res.json({ store: 'woolworths', query, products });
      }
    } catch (err) {
      // try next
    }
  }

  return res.status(503).json({
    store: 'woolworths',
    query,
    blocked: true,
    products: [],
    searchUrl: `https://www.woolworths.com.au/shop/search/products?searchTerm=${encodeURIComponent(query)}`,
    error: 'Woolworths is blocking automated requests from this server. Use the search link to check manually.',
  });
});

function parseWoolworths(data) {
  const results = data?.Products || data?.products || [];
  return results.slice(0, 5).map(p => ({
    name: p.Name || p.name || 'Unknown',
    brand: p.Brand || p.brand || '',
    price: p.Price || p.price || null,
    wasPrice: p.WasPrice || p.wasPrice || null,
    isSpecial: p.IsOnSpecial || p.isOnSpecial || false,
    size: p.PackageSize || p.size || '',
    unitPrice: p.CupString || p.cupString || null,
    imageUrl: p.Stockcode ? `https://cdn0.woolworths.media/content/wowproductimages/medium/${p.Stockcode}.jpg` : null,
    url: p.UrlFriendlyName ? `https://www.woolworths.com.au/shop/productdetails/${p.Stockcode}/${p.UrlFriendlyName}` : null,
  }));
}

// --- Combined compare endpoint ---
app.get('/api/compare', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query parameter: q' });

  const [colesRes, wooliesRes] = await Promise.allSettled([
    fetch(`http://localhost:${PORT}/api/coles?q=${encodeURIComponent(query)}`).then(r => r.json()),
    fetch(`http://localhost:${PORT}/api/woolworths?q=${encodeURIComponent(query)}`).then(r => r.json()),
  ]);

  res.json({
    query,
    coles: colesRes.status === 'fulfilled' ? colesRes.value : { error: colesRes.reason?.message },
    woolworths: wooliesRes.status === 'fulfilled' ? wooliesRes.value : { error: wooliesRes.reason?.message },
  });
});

app.get('/health', (_, res) => res.json({ status: 'ok', port: PORT }));

app.listen(PORT, () => {
  console.log(`\n🍺 Price Checker proxy running at http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET /api/coles?q=schweppes+ginger+ale`);
  console.log(`  GET /api/woolworths?q=schweppes+ginger+ale`);
  console.log(`  GET /api/compare?q=schweppes+ginger+ale`);
  console.log(`  GET /health\n`);
});

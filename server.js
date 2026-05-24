const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Shared headers that mimic a real browser request
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-AU,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

// --- Coles proxy ---
app.get('/api/coles', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query parameter: q' });

  const url = `https://www.coles.com.au/api/2.0/product-list/search?q=${encodeURIComponent(query)}&pageNo=1&pageSize=10`;

  try {
    const response = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        'Referer': 'https://www.coles.com.au/',
        'Origin': 'https://www.coles.com.au',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Coles API returned ${response.status}`,
        hint: 'Coles may have updated their API. Check https://www.coles.com.au/search for the latest endpoints.',
      });
    }

    const data = await response.json();
    const products = parseColes(data);
    res.json({ store: 'coles', query, products, raw_count: products.length });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

  const url = `https://www.woolworths.com.au/apis/ui/Search/products?searchTerm=${encodeURIComponent(query)}&pageNumber=1&pageSize=10&sortType=TraderRelevance&isMobile=false&filters=`;

  try {
    const response = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        'Referer': 'https://www.woolworths.com.au/',
        'Origin': 'https://www.woolworths.com.au',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Woolworths API returned ${response.status}`,
        hint: 'Woolworths may have updated their API. Check https://www.woolworths.com.au/shop/search for the latest endpoints.',
      });
    }

    const data = await response.json();
    const products = parseWoolworths(data);
    res.json({ store: 'woolworths', query, products, raw_count: products.length });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    imageUrl: p.MediumImageFile ? `https://cdn0.woolworths.media/content/wowproductimages/medium/${p.Stockcode}.jpg` : null,
    url: p.UrlFriendlyName ? `https://www.woolworths.com.au/shop/productdetails/${p.Stockcode}/${p.UrlFriendlyName}` : null,
  }));
}

// --- Combined search endpoint ---
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

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', port: PORT }));

app.listen(PORT, () => {
  console.log(`\n🍺 Price Checker proxy running at http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET /api/coles?q=schweppes+ginger+ale`);
  console.log(`  GET /api/woolworths?q=schweppes+ginger+ale`);
  console.log(`  GET /api/compare?q=schweppes+ginger+ale`);
  console.log(`  GET /health\n`);
});

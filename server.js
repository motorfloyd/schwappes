const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Lazy-load playwright so server starts even if chromium isn't installed yet
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    const { chromium } = require('playwright');
    browserPromise = chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }
  return browserPromise;
}

async function scrapeWoolworths(query) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-AU',
    extraHTTPHeaders: { 'Accept-Language': 'en-AU,en;q=0.9' },
  });
  const page = await context.newPage();

  try {
    // Intercept the API response as the page loads
    let apiData = null;
    page.on('response', async response => {
      if (response.url().includes('/apis/ui/Search/products') && response.status() === 200) {
        try { apiData = await response.json(); } catch {}
      }
    });

    await page.goto(`https://www.woolworths.com.au/shop/search/products?searchTerm=${encodeURIComponent(query)}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    // Give interceptor a moment to capture
    await page.waitForTimeout(1000);

    if (apiData) return parseWoolworths(apiData);

    // Fallback: parse from DOM
    const products = await page.evaluate(() => {
      const items = document.querySelectorAll('[data-testid="product-tile"]');
      return Array.from(items).slice(0, 5).map(el => ({
        name: el.querySelector('[data-testid="product-title"]')?.textContent?.trim() || '',
        price: el.querySelector('.price')?.textContent?.trim() || '',
      }));
    });
    return products;

  } finally {
    await context.close();
  }
}

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

async function scrapeColes(query) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-AU',
    extraHTTPHeaders: { 'Accept-Language': 'en-AU,en;q=0.9' },
  });
  const page = await context.newPage();

  try {
    let apiData = null;
    page.on('response', async response => {
      if (response.url().includes('/product-list/') && response.status() === 200) {
        try { apiData = await response.json(); } catch {}
      }
    });

    await page.goto(`https://www.coles.com.au/search?q=${encodeURIComponent(query)}`, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });

    await page.waitForTimeout(1000);

    if (apiData) return parseColes(apiData);

    // Fallback: DOM scrape
    const products = await page.evaluate(() => {
      const items = document.querySelectorAll('[data-testid="product-tile"], .product-tile');
      return Array.from(items).slice(0, 5).map(el => ({
        name: el.querySelector('[data-testid="product-title"], .product__title')?.textContent?.trim() || '',
        price: el.querySelector('[data-testid="product-pricing"], .product__price')?.textContent?.trim() || '',
      }));
    });
    return products;

  } finally {
    await context.close();
  }
}

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

// --- Routes ---
app.get('/api/woolworths', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query parameter: q' });
  try {
    const products = await scrapeWoolworths(query);
    res.json({ store: 'woolworths', query, products });
  } catch (err) {
    res.status(500).json({ store: 'woolworths', error: err.message, products: [] });
  }
});

app.get('/api/coles', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query parameter: q' });
  try {
    const products = await scrapeColes(query);
    res.json({ store: 'coles', query, products });
  } catch (err) {
    res.status(500).json({ store: 'coles', error: err.message, products: [] });
  }
});

app.get('/api/compare', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing query parameter: q' });
  const [c, w] = await Promise.allSettled([
    scrapeWoolworths(query),
    scrapeColes(query),
  ]);
  res.json({
    query,
    woolworths: { products: c.status === 'fulfilled' ? c.value : [], error: c.reason?.message },
    coles: { products: w.status === 'fulfilled' ? w.value : [], error: w.reason?.message },
  });
});

app.get('/health', (_, res) => res.json({ status: 'ok', port: PORT }));

app.listen(PORT, () => {
  console.log(`\n🍺 Schwappes running at http://localhost:${PORT}`);
  // Warm up browser in background
  getBrowser().then(() => console.log('✅ Browser ready')).catch(e => console.error('⚠️  Browser init failed:', e.message));
});

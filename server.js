const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function load() {
  try { return JSON.parse(fs.readFileSync(DB, 'utf8')); }
  catch { return { products: [], entries: [] }; }
}
function save(db) { fs.writeFileSync(DB, JSON.stringify(db, null, 2)); }

// Products (unique name+size combos)
app.get('/api/products', (req, res) => {
  const db = load();
  res.json(db.products);
});

app.post('/api/products', (req, res) => {
  const { name, size } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = load();
  const existing = db.products.find(p => p.name === name && p.size === (size || ''));
  if (existing) return res.json(existing);
  const product = { id: Date.now(), name, size: size || '', createdAt: new Date().toISOString() };
  db.products.push(product);
  save(db);
  res.json(product);
});

app.delete('/api/products/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = load();
  db.products = db.products.filter(p => p.id !== id);
  db.entries = db.entries.filter(e => e.productId !== id);
  save(db);
  res.json({ ok: true });
});

// Price entries
app.get('/api/entries', (req, res) => {
  const db = load();
  const { productId } = req.query;
  const entries = productId
    ? db.entries.filter(e => e.productId === Number(productId))
    : db.entries;
  res.json(entries.sort((a, b) => new Date(b.date) - new Date(a.date)));
});

app.post('/api/entries', (req, res) => {
  const { productId, store, price, date, note } = req.body;
  if (!productId || !store || price == null) return res.status(400).json({ error: 'productId, store, price required' });
  const db = load();
  if (!db.products.find(p => p.id === Number(productId))) return res.status(404).json({ error: 'Product not found' });
  const entry = {
    id: Date.now(),
    productId: Number(productId),
    store,
    price: Number(price),
    date: date || new Date().toISOString().split('T')[0],
    note: note || '',
    createdAt: new Date().toISOString(),
  };
  db.entries.push(entry);
  save(db);
  res.json(entry);
});

app.delete('/api/entries/:id', (req, res) => {
  const id = Number(req.params.id);
  const db = load();
  db.entries = db.entries.filter(e => e.id !== id);
  save(db);
  res.json({ ok: true });
});

// Summary: latest price per store per product
app.get('/api/summary', (req, res) => {
  const db = load();
  const summary = db.products.map(product => {
    const entries = db.entries.filter(e => e.productId === product.id);
    const byStore = {};
    for (const e of entries) {
      if (!byStore[e.store] || e.date > byStore[e.store].date) byStore[e.store] = e;
    }
    const prices = Object.values(byStore);
    const cheapest = prices.length ? prices.reduce((a, b) => a.price < b.price ? a : b) : null;
    return { product, byStore, cheapest, entryCount: entries.length };
  });
  res.json(summary);
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.listen(PORT, () => console.log(`🍺 Schwappes running at http://localhost:${PORT}`));

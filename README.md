# Schwappes — Ginger Ale Price Checker

Compares Schweppes Ginger Ale (or any product) prices between Coles and Woolworths in real time.

## Run locally

```bash
npm install
npm start
```

Open **http://localhost:3000**

## Deploy to Azure Web App

### 1. Create the Azure Web App

```bash
# Login
az login

# Create resource group
az group create --name schwappes-rg --location australiaeast

# Create App Service plan (free tier)
az appservice plan create \
  --name schwappes-plan \
  --resource-group schwappes-rg \
  --sku F1 \
  --is-linux

# Create Web App (Node 20 — use colon syntax)
az webapp create \
  --name schwappes \
  --resource-group schwappes-rg \
  --plan schwappes-plan \
  --runtime "NODE:22-lts"

# Set startup command
az webapp config set \
  --name schwappes \
  --resource-group schwappes-rg \
  --startup-file "node server.js"
```

> **Note:** Use `NODE:22-lts` (colon) not `NODE|20-lts` (pipe) for Linux runtimes.  
> Run `az webapp list-runtimes --os-type linux` to see all valid values.

### 2. Add GitHub Actions secrets

In your GitHub repo → Settings → Secrets → Actions, add:

| Secret | Value |
|---|---|
| `AZURE_WEBAPP_NAME` | Your app name (e.g. `schwappes`) |
| `AZURE_WEBAPP_PUBLISH_PROFILE` | Contents of the publish profile XML from Azure Portal |

To get the publish profile: Azure Portal → your Web App → **Download publish profile**.

### 3. Push to main

Every push to `main` auto-deploys via GitHub Actions.

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/coles?q=schweppes+ginger+ale` | Coles product search |
| `GET /api/woolworths?q=schweppes+ginger+ale` | Woolworths product search |
| `GET /api/compare?q=schweppes+ginger+ale` | Both stores combined |
| `GET /health` | Health check |

## Troubleshooting

**Got a 403/404 from Coles or Woolworths?**  
Their internal API paths can change. Open DevTools → Network on their site, search for a product, find the `/api/` XHR request, and update the URL in `server.js`.

**Azure deploy failing?**  
Make sure your App Service plan has `--is-linux` set, and use `NODE:22-lts` (colon syntax) as the runtime.

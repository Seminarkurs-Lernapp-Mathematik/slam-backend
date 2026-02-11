# Cloudflare Setup Guide

This guide explains how to configure Cloudflare for automatic deployment via GitHub Actions.

## Required GitHub Secrets

You need to add these secrets to your GitHub repository:

### 1. CLOUDFLARE_API_TOKEN

**How to get it:**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click on your profile icon (top right) → **My Profile**
3. Navigate to **API Tokens** (left sidebar)
4. Click **Create Token**
5. Use the **Edit Cloudflare Workers** template
6. Configure permissions:
   - **Account** → **Cloudflare Workers** → **Edit**
   - **Zone** → **Workers Routes** → **Edit** (if using custom domains)
7. Click **Continue to summary** → **Create Token**
8. **Copy the token** (you won't see it again!)

**Add to GitHub:**
```
Repository → Settings → Secrets and variables → Actions → New repository secret
Name: CLOUDFLARE_API_TOKEN
Value: [paste your token]
```

### 2. CLOUDFLARE_ACCOUNT_ID

**How to get it:**

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Select any domain/site (or go to Workers & Pages)
3. The **Account ID** is visible in the right sidebar under "Account ID"
4. Or look in the URL: `dash.cloudflare.com/<ACCOUNT_ID>/workers`

**Add to GitHub:**
```
Repository → Settings → Secrets and variables → Actions → New repository secret
Name: CLOUDFLARE_ACCOUNT_ID
Value: [paste your account ID]
```

## Deployment Flow

Once secrets are configured:

1. **Push to `main` branch** → Automatically deploys to production
2. **Manual trigger** → Actions tab → "Deploy to Cloudflare Workers" → Run workflow

## Verify Deployment

After deployment completes:

```bash
# Check backend health
curl https://api.learn-smart.app/

# Expected response:
{
  "service": "SLAM Backend API",
  "version": "1.0.0",
  "status": "healthy",
  "endpoints": [...]
}
```

## Local Development

To deploy manually from your machine:

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy to production
wrangler deploy --env production

# Deploy to staging
wrangler deploy --env staging

# Deploy to development
wrangler deploy --env development
```

## Environment Variables

Set secrets in Cloudflare (not GitHub):

```bash
# Optional: Server-side API keys (if not using user-provided keys)
wrangler secret put CLAUDE_API_KEY --env production
wrangler secret put GEMINI_API_KEY --env production

# Firebase service account (for Firestore access)
wrangler secret put FIREBASE_SERVICE_ACCOUNT --env production
```

## Troubleshooting

**Error: "Invalid API token"**
- Regenerate the token with correct permissions
- Ensure token has "Edit Cloudflare Workers" permission

**Error: "Account ID not found"**
- Double-check the Account ID from dashboard
- Ensure it matches the account where workers are deployed

**Deployment succeeds but API returns 404**
- Check custom domain routing in `wrangler.toml`
- Verify DNS settings in Cloudflare dashboard
- Ensure zone name matches your domain

## GitHub Actions Status

Check deployment status:
- Go to your repository → **Actions** tab
- Click on latest "Deploy to Cloudflare Workers" workflow
- View logs for any errors

---

**Need help?** Check [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)

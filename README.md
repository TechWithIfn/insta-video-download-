# Downloadit - Instagram Media Downloader

A production-quality Instagram media downloader web application with a clean frontend/backend separation.

## Supported Content

| Type | Status | Notes |
|------|--------|-------|
| Reels | Supported | Video preview, author, duration |
| Video Posts | Supported | Video preview, author |
| Image Posts | Supported | Image preview, dimensions |
| Carousel Posts | Supported via Photo Downloader | Multi-item navigation (no dedicated carousel route) |
| Stories | Supported | Image/video preview, 9:16 aspect ratio |
| Highlights | Supported | Multi-story navigation, mixed media |

**Note**: Actual resolution depends on the configured legitimate provider. The `mock` provider returns test data for development.

## Architecture

```
/project-root
├── frontend/          # Next.js 16 + React 19 + Tailwind CSS 4
│   ├── src/
│   │   ├── app/       # Pages, layouts, not-found
│   │   ├── components/ # UI components
│   │   └── services/  # API client
│   └── ...
├── backend/           # Express 5 + TypeScript
│   ├── src/
│   │   ├── lib/       # Core logic (types, errors, crypto, validators, providers, resolvers)
│   │   ├── routes/    # Express route handlers (resolve, download, health)
│   │   └── server.ts  # Express server entry point
│   └── tests/         # 126 tests (vitest)
├── package.json       # Root workspace scripts
├── .nvmrc             # Node version (24)
└── .gitignore
```

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript 5, Tailwind CSS 4
- **Backend**: Express 5, TypeScript 5, Node.js >=20
- **Testing**: Vitest (126 tests)
- **Tooling**: tsx (dev), tsc (build)

## Getting Started

### Prerequisites

- Node.js >= 20 (see `.nvmrc`)
- npm

### Install Dependencies

```bash
npm run install:all
```

### Environment Variables

Copy `.env.example` to `.env` in both `frontend/` and `backend/`:

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```

### Development

Run both frontend and backend simultaneously:

```bash
npm run dev
```

Or separately:

```bash
npm run dev:frontend   # http://localhost:3000
npm run dev:backend    # http://localhost:3001
```

## Environment Variables

### Frontend (`frontend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_BASE_URL` | Backend API URL | `http://localhost:3001` |

### Backend (`backend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment | `development` |
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:3000` |
| `RESOLVER_PROVIDER` | Provider mode | `placeholder` |
| `PROVIDER_API_URL` | External provider API URL | - |
| `PROVIDER_API_KEY` | External provider API key | - |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | `30` |
| `RESOLVER_TIMEOUT_MS` | Provider request timeout | `15000` |

## Provider Modes

- **`placeholder`** (default): Returns `PROVIDER_NOT_CONFIGURED` error. Safe for production without a provider.
- **`mock`**: Returns deterministic mock data for development and testing.
- **`external`**: Calls a configured external API. Requires `PROVIDER_API_URL` and `PROVIDER_API_KEY`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/resolve` | Resolve an Instagram URL to downloadable media |
| GET | `/api/download/:id/:mediaIndex` | Download a specific media item by resolved ID |
| GET | `/api/health` | Health check |

## Production Deployment

### Frontend

**Build command:**
```bash
cd frontend && npm run build
```

**Output directory:** `.next/`

**Required environment variables:**
- `NEXT_PUBLIC_API_BASE_URL` — your backend API URL (e.g., `https://api.yourdomain.com`)

The frontend is a Next.js application. Deploy to any platform that supports Next.js (Vercel, Railway, a Node.js server, etc.).

### Backend

**Build command:**
```bash
cd backend && npm run build
```

**Start command:**
```bash
cd backend && npm start
```

**Output directory:** `dist/`

**Required environment variables:**
- `PORT` — server port (set by hosting platform, e.g., Railway, Render)
- `NODE_ENV=production`
- `CORS_ORIGIN` — your frontend URL (e.g., `https://yourdomain.com`)
- `RESOLVER_PROVIDER=external`
- `PROVIDER_API_URL` — your provider API URL
- `PROVIDER_API_KEY` — your provider API key

### Architecture in Production

```
User
  ↓
HTTPS
  ↓
Frontend (https://yourdomain.com)
  ↓
HTTPS API request
  ↓
Backend API (https://api.yourdomain.com)
  ↓
Resolver
  ↓
Configured Provider
  ↓
Validated Media
  ↓
User Download
```

### CORS

Production CORS is restricted to the frontend origin via `CORS_ORIGIN`. Ensure this matches your deployed frontend URL exactly (including protocol and no trailing slash).

### Provider

Provider credentials (`PROVIDER_API_URL`, `PROVIDER_API_KEY`) are server-side only. They are never exposed to the frontend.

### Domain Setup

```
yourdomain.com        → Frontend hosting
api.yourdomain.com    → Backend hosting
```

The exact DNS record type depends on your hosting provider.

### HTTPS

Both frontend and backend must use HTTPS in production. Most hosting platforms provide this automatically.

### Health Check

```
GET https://api.yourdomain.com/api/health
```

Returns:
```json
{
  "status": "ok",
  "timestamp": "2026-09-17T...",
  "uptime": 123.456
}
```

## Testing

```bash
npm test               # Backend tests (126 tests)
npm run lint:frontend  # Lint frontend
```

## Production Build

```bash
npm run build          # Build both frontend and backend
```

## Deployment Checklist

```
[ ] Frontend deployed
[ ] Backend deployed
[ ] HTTPS enabled on both
[ ] NEXT_PUBLIC_API_BASE_URL set to backend URL
[ ] CORS_ORIGIN set to frontend URL
[ ] RESOLVER_PROVIDER=external
[ ] PROVIDER_API_URL configured
[ ] PROVIDER_API_KEY configured server-side
[ ] Health endpoint responds (GET /api/health)
[ ] Frontend can reach backend API
[ ] Reel resolve + download tested
[ ] Post resolve + download tested
[ ] Carousel resolve + download tested
[ ] Story resolve tested (if provider supports)
[ ] Highlight resolve tested (if provider supports)
[ ] Mobile layout tested
[ ] Desktop layout tested
[ ] No localhost references in production
[ ] No mock data in production
[ ] No secrets exposed to frontend
```

## Security

- URL validation with SSRF prevention
- Rate limiting (30 requests/minute per IP)
- CORS restricted to frontend origin
- API keys never exposed to frontend
- Private IP blocking on media URLs
- Domain whitelist for download proxy (cdninstagram.com, fbcdn.net)
- Sanitized filenames
- Temporary resolution storage with TTL (10 minutes)
- HTTP security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy)

## Privacy

- No user accounts or authentication
- No permanent download history
- No database required
- Only public/authorized content is supported
- Private content returns clear error messages

## License

MIT

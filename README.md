# Route Optimizer 🗺️⚡

> **Bulk-address route optimization** — paste up to 25 addresses, get the fastest driving order powered by Google OR-Tools and real-time traffic data from the Google Routes API.

---

## Table of Contents

1. [What This App Does](#1-what-this-app-does)
2. [Architecture Overview](#2-architecture-overview)
3. [Prerequisites](#3-prerequisites)
4. [Step 1 — Clone the Repository](#4-step-1--clone-the-repository)
5. [Step 2 — Create Your Google Maps API Key](#5-step-2--create-your-google-maps-api-key)
6. [Step 3 — Set Up the Firebase Project](#6-step-3--set-up-the-firebase-project)
7. [Step 4 — Set Up Google Cloud Run](#7-step-4--set-up-google-cloud-run)
8. [Step 5 — Configure GitHub Secrets](#8-step-5--configure-github-secrets)
9. [Step 6 — Local Development](#9-step-6--local-development)
10. [Step 7 — Deploy to Production](#10-step-7--deploy-to-production)
11. [How the OR-Tools Algorithm Works](#11-how-the-or-tools-algorithm-works)
12. [Running Tests](#12-running-tests)
13. [Cost Breakdown & Free Tier Guide](#13-cost-breakdown--free-tier-guide)
14. [Troubleshooting](#14-troubleshooting)
15. [Project Structure](#15-project-structure)

---

## 1. What This App Does

1. You paste a list of addresses (one per line) into the web interface.
2. The frontend **geocodes** each address and pins it on a Google Map.
3. You optionally specify a **starting point** and **destination** (or use your GPS).
4. You click **Optimize Route** — the backend fetches a real-time traffic-aware **travel time matrix** between all your stops, then runs Google OR-Tools to find the shortest total route.
5. The optimized route is drawn as a **polyline** on the map and you get a **one-click Google Maps link** for turn-by-turn phone navigation.

---

## 2. Architecture Overview

```
┌─────────────────────────────────┐     POST /optimize      ┌──────────────────────────────────────┐
│       Firebase Hosting          │ ──────────────────────▶  │         Google Cloud Run             │
│    (HTML + CSS + JS)            │                          │   FastAPI + Python 3.12               │
│                                 │ ◀──────────────────────  │   OR-Tools VRP/TSP Solver             │
│  • Geocoding via Maps JS API    │    JSON: ordered route   │   Routes API (traffic matrix)         │
│  • Interactive Google Map       │                          └──────────────────────────────────────┘
│  • GPS capture                  │
│  • Polyline + nav URL           │        ↑ Docker image built & pushed by GitHub Actions
└─────────────────────────────────┘
           ↑
    GitHub Actions auto-deploys
    on every push to main
```

**Stack at-a-glance:**

| Layer | Technology |
|---|---|
| Frontend | HTML5, Vanilla JS, CSS3 (glass-morphism dark theme) |
| Map & Geocoding | Google Maps JavaScript API v3 + Geocoding API |
| Backend | Python 3.12 · FastAPI · Uvicorn |
| Route Solver | Google OR-Tools 9.10 (VRP/TSP) |
| Traffic Data | Google Routes API — Compute Route Matrix |
| Containerization | Docker (multi-stage, non-root) |
| Hosting | Firebase Hosting (free tier — 10 GB/month) |
| Backend Hosting | Google Cloud Run (free tier — 2M requests/month) |
| CI/CD | GitHub Actions |

---

## 3. Prerequisites

Install these tools on your machine before starting.

### Node.js (v18 or newer)
Required to run Firebase CLI and Jest tests.

- Download from: https://nodejs.org/en/download
- Verify: `node --version` and `npm --version`

### Python (v3.12)
Required to run the backend locally.

- Download from: https://www.python.org/downloads/
- Verify: `python --version` (must show 3.12.x)

### Docker Desktop
Required to build and test the container locally.

- Download from: https://www.docker.com/products/docker-desktop/
- Ensure it is running before the Docker steps below.
- Verify: `docker --version`

### Git
Required for version control and connecting to GitHub.

- Download from: https://git-scm.com/downloads
- Verify: `git --version`

### Firebase CLI
Install globally via npm:
```bash
npm install -g firebase-tools
firebase --version   # should show 13.x or newer
```

### Google Cloud CLI (gcloud)
Required for Cloud Run deployment.

- Download from: https://cloud.google.com/sdk/docs/install
- After installing, run: `gcloud init`
- Verify: `gcloud --version`

### GitHub Account
- Free account at: https://github.com

---

## 4. Step 1 — Clone the Repository

```bash
git clone https://github.com/Decathlusnek/MapsAppClaude.git
cd MapsAppClaude
```

---

## 5. Step 2 — Create Your Google Maps API Key

> **You need one API key** with three APIs enabled. Using one key for everything is the simplest approach for a project this size.

### 5a. Open Google Cloud Console

1. Go to: https://console.cloud.google.com/
2. Make sure you are signed in with your Google account.
3. In the top bar, click the **project selector** dropdown → select **mapsapp-route-optimizer** (this was created automatically as part of your Firebase project).

### 5b. Enable the Required APIs

Go to **APIs & Services → Library** and enable these three APIs one by one:

| API | Why it is needed |
|---|---|
| **Maps JavaScript API** | Renders the interactive map in the browser |
| **Geocoding API** | Converts address text → lat/lng coordinates |
| **Routes API (v2)** | Computes traffic-aware travel time matrix between all stops (successor to Distance Matrix API) |

For each one:
1. Search for the API name in the library search box.
2. Click the result.
3. Click the blue **Enable** button.

### 5c. Create the API Key

1. Go to **APIs & Services → Credentials**.
2. Click **+ Create Credentials → API key**.
3. A dialog shows your new key — **copy it now**.
4. Click **Edit API key** (pencil icon).

### 5d. Restrict the Key (IMPORTANT for Security)

**Application restrictions:**
- Select **HTTP referrers (websites)**.
- Click **Add an item** and add:
  - `https://mapsapp-route-optimizer-8fe77.web.app/*`
  - `https://mapsapp-route-optimizer-8fe77.firebaseapp.com/*`
  - `http://localhost:5000/*` (for local development)
  - `http://127.0.0.1:5000/*`

**API restrictions:**
- Select **Restrict key**.
- From the dropdown, check:
  - Maps JavaScript API
  - Geocoding API
  - Routes API

Click **Save**.

> ⚠️ **Never commit your API key to GitHub.** The key is now primarily handled via the `MAPS_API_KEY` environment variable in the backend. The frontend field is an optional fallback for development.

### 5e. Add the Key to the Frontend

Open `frontend/index.html` and find this line near the bottom:

```html
src="https://maps.googleapis.com/maps/api/js?key=YOUR_MAPS_API_KEY&libraries=places&callback=initMap"
```

Replace `YOUR_MAPS_API_KEY` with your actual key.

### 5f. Set the Backend Environment Variable (Recommended)

For production (Cloud Run), it is highly recommended to set the `MAPS_API_KEY` environment variable. This ensures the key is never transmitted from the client to the server for optimization requests.

- **Local**: Create a `.env` file in the `backend/` directory or export it in your shell: `export MAPS_API_KEY=AIza...`
- **Cloud Run**: Go to the Cloud Run console → Edit & Deploy New Revision → Variables & Secrets → Add Variable `MAPS_API_KEY`.

---

---

## 6. Step 3 — Set Up the Firebase Project

The Firebase project `mapsapp-route-optimizer` was already created. Here is how to link it to your local machine.

### 6a. Log In to Firebase

```bash
firebase login
```

A browser window opens. Log in with your Google account.

### 6b. Verify the Project Link

```bash
firebase projects:list
```

You should see `mapsapp-route-optimizer` in the list. The `.firebaserc` file already points to it.

### 6c. Get the Service Account for GitHub Actions

This allows GitHub Actions to deploy to Firebase Hosting automatically.

1. Go to: https://console.firebase.google.com/project/mapsapp-route-optimizer/settings/serviceaccounts/adminsdk
2. Click **Generate new private key**.
3. A JSON file downloads — **keep this file secret**.
4. You will add this as a GitHub Secret in Step 5.

---

## 7. Step 4 — Set Up Google Cloud Run

### 7a. Enable Billing

Cloud Run's free tier still requires a billing account.

1. Go to: https://console.cloud.google.com/billing
2. Link a billing account to the **mapsapp-route-optimizer** project.
3. You will NOT be charged unless you exceed the free tier (2 million requests/month, 360,000 GB-seconds of memory, 180,000 vCPU-seconds per month).

### 7b. Enable Required GCP APIs

```bash
gcloud config set project mapsapp-route-optimizer

gcloud services enable \
  run.googleapis.com \
  containerregistry.googleapis.com \
  cloudbuild.googleapis.com
```

### 7c. Create a Service Account for GitHub Actions

This lets GitHub Actions build and deploy the Docker container.

```bash
# Create the service account
gcloud iam service-accounts create github-actions-deployer \
  --display-name="GitHub Actions Deployer"

# Grant it exactly the permissions it needs (principle of least privilege)
gcloud projects add-iam-policy-binding mapsapp-route-optimizer \
  --member="serviceAccount:github-actions-deployer@mapsapp-route-optimizer.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding mapsapp-route-optimizer \
  --member="serviceAccount:github-actions-deployer@mapsapp-route-optimizer.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding mapsapp-route-optimizer \
  --member="serviceAccount:github-actions-deployer@mapsapp-route-optimizer.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

# Download the key as JSON
gcloud iam service-accounts keys create gcp-sa-key.json \
  --iam-account=github-actions-deployer@mapsapp-route-optimizer.iam.gserviceaccount.com
```

> ⚠️ The `gcp-sa-key.json` file is in `.gitignore`. Never commit it. You will paste its contents into a GitHub Secret.

---

## 8. Step 5 — Configure GitHub Secrets

These secrets let GitHub Actions deploy to Firebase and Cloud Run without exposing credentials in your code.

1. Go to your GitHub repository: https://github.com/Decathlusnek/MapsAppClaude
2. Click **Settings → Secrets and variables → Actions**.
3. Click **New repository secret** for each of the following:

| Secret Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_MAPSAPP` | Paste the **entire contents** of the Firebase service account JSON downloaded in Step 6c |
| `GCP_SA_KEY` | Paste the **entire contents** of `gcp-sa-key.json` created in Step 7c |

That's it. The `GCP_PROJECT_ID` and other values are already hardcoded in the workflow files.

---

## 9. Step 6 — Local Development

### Frontend

```bash
# Install Firebase CLI if you haven't already
npm install -g firebase-tools

# Serve the frontend locally (with Firebase emulator)
firebase serve --only hosting --project mapsapp-route-optimizer
# → Opens on http://localhost:5000
```

Open `http://localhost:5000` in your browser.

### Backend

```bash
cd backend

# Create a Python virtual environment
python -m venv .venv

# Activate it
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the FastAPI dev server
uvicorn main:app --reload --port 8080
# → API available at http://localhost:8080
# → Interactive docs at http://localhost:8080/docs
```

The frontend's `BACKEND_URL` in `script.js` automatically detects `localhost` and routes to `http://localhost:8080`.

### Test the Backend Directly

```bash
# Health check
curl http://localhost:8080/health

# Optimize (with a real API key)
curl -X POST http://localhost:8080/optimize \
  -H "Content-Type: application/json" \
  -d '{
    "waypoints": [
      {"lat": -19.9245, "lng": -44.0082, "address": "Rua Padre Eustáquio"},
      {"lat": -19.9212, "lng": -44.0051, "address": "Av. Silva Lobo"},
      {"lat": -19.9280, "lng": -44.0120, "address": "Rua Itapecerica"}
    ],
    "api_key": "YOUR_API_KEY",
    "time_limit_seconds": 5
  }'
```

### Build & Run Docker Locally

```bash
cd backend

# Build the image
docker build -t route-optimizer-api:local .

# Run the container
docker run -p 8080:8080 route-optimizer-api:local

# Test it
curl http://localhost:8080/health
```

---

## 10. Step 7 — Deploy to Production

### Option A — Automatic (GitHub Actions, recommended)

Simply push to `main`:

```bash
git add .
git commit -m "feat: initial deploy"
git push origin main
```

GitHub Actions will:
1. Run Jest tests (frontend).
2. Deploy the frontend to Firebase Hosting.
3. Run PyTest (backend).
4. Build the Docker image.
5. Push it to Google Container Registry.
6. Deploy the new image to Cloud Run.

Watch progress at: https://github.com/Decathlusnek/MapsAppClaude/actions

### Option B — Manual Frontend Deploy

```bash
firebase deploy --only hosting --project mapsapp-route-optimizer
```

### Option C — Manual Backend Deploy

```bash
cd backend

# Build and tag
docker build -t gcr.io/mapsapp-route-optimizer/route-optimizer-api:latest .

# Push
docker push gcr.io/mapsapp-route-optimizer/route-optimizer-api:latest

# Deploy
gcloud run deploy route-optimizer-api \
  --image gcr.io/mapsapp-route-optimizer/route-optimizer-api:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 10 \
  --min-instances 0 \
  --max-instances 5
```

### After Deploying the Backend

The deploy command prints a URL like:
```
https://route-optimizer-api-xxxxxxxx-uc.a.run.app
```

**You must update one line in `frontend/script.js`:**

```javascript
// Find this section near the top of script.js:
const BACKEND_URL = window.location.hostname === 'localhost' ...
  : 'https://YOUR_CLOUD_RUN_URL';  // ← replace this

// Change it to:
  : 'https://route-optimizer-api-xxxxxxxx-uc.a.run.app';
```

Then push the change and GitHub Actions will redeploy the frontend automatically.

---

## 11. How the OR-Tools Algorithm Works

> Explained in plain English — no math required.

### The Problem

You have N addresses. You need to find the order to visit them all that minimizes total travel time. This is called the **Traveling Salesman Problem (TSP)**. With just 10 addresses there are 3,628,800 possible orders. With 20 addresses there are more possible orders than atoms in the observable universe. Checking every option is impossible.

### Phase 1 — Getting a Good Starting Point (PATH_CHEAPEST_ARC)

Think of it like this: you're at the depot. You look around and go to the **nearest unvisited stop**. From there, again pick the nearest unvisited stop. Keep going until all stops are visited.

This is the **greedy** approach. It's not perfect, but it runs in milliseconds and produces a "good enough" starting route.

### Phase 2 — Making It Better (GUIDED_LOCAL_SEARCH)

Now OR-Tools takes the greedy route and asks: *"What if I swap these two stops? Is the total time shorter?"* It tries thousands of such swaps per second.

The smart part: it uses **penalty functions** to escape dead-ends. If the solver keeps getting stuck improving the same stretch of road, it temporarily penalizes that stretch and forces exploration of other options — even if they look worse at first. This is called a **metaheuristic** — a strategy for finding good solutions in complex spaces.

After 5 seconds (configurable), the solver returns **the best order it found**.

### The Cost Matrix

These are **real-time, traffic-aware** durations provided by the **Google Routes API (v2)** — not straight-line distances. Using the modern `computeRouteMatrix` endpoint allows for higher precision and smarter routing in urban environments than the legacy Distance Matrix API.

### Why Not Just Use Google Maps Directions?

Google Maps Directions optimizes a route you give it starting from a specific order. OR-Tools finds *which order is best* for you — that's the hard part it handles.

---

## 12. Running Tests

### Backend (PyTest)

```bash
cd backend

# Activate your virtual environment first
.venv\Scripts\activate  # Windows
source .venv/bin/activate  # macOS/Linux

# Install test dependencies
pip install pytest pytest-asyncio pytest-mock

# Run all tests
pytest tests/ -v

# Run with coverage
pytest tests/ -v --cov=. --cov-report=term-missing
```

Expected output:
```
tests/test_solver.py::TestBuildMapsUrl::test_single_location_returns_url PASSED
tests/test_solver.py::TestBuildMapsUrl::test_two_locations_origin_destination PASSED
...
tests/test_solver.py::TestSolveEndToEnd::test_basic_solve_returns_response PASSED
...
============ 25 passed in 12.34s ============
```

### Frontend (Jest)

```bash
# From the project root
npm install
npm test
```

Expected output:
```
PASS frontend/__tests__/script.test.js
  formatDistance()
    ✓ returns metres for values below 1000 m
    ✓ converts to kilometres for values >= 1000 m
  formatDuration()
    ✓ returns "0 min" for zero seconds
  ...
Test Suites: 1 passed, 1 total
Tests:       22 passed, 22 total
```

---

## 13. Cost Breakdown & Free Tier Guide

All services have free tiers that cover typical personal or small-team usage.

### Firebase Hosting (Spark Plan — Always Free)
- **10 GB** storage
- **360 MB/day** data transfer
- Custom domain: yes
- **Cost: $0**

### Google Cloud Run (Free Tier — Per Month)
- **2,000,000 requests** free
- **360,000 GB-seconds** of memory (= 1 GB RAM × 100 hours)
- **180,000 vCPU-seconds** free
- **Cost: $0** for personal/small-team use

### Google Maps Platform ($200/month free credit)

| API | Free Credit Covers |
|---|---|
| Maps JavaScript API | ~28,000 map loads/month |
| Geocoding API | ~40,000 geocode requests/month |
| Routes API (Matrix) | ~2,000 matrix requests/month (varies by element count) |

> **Key tip:** The Routes Matrix API charges per **element** (origin × destination pair). A 10-stop route = 100 elements. At ~$0.005/element after free credit, 100 elements = $0.50. Your $200 credit covers ~40,000 optimization runs per month.

### Staying Within Budget

- Set a **Budget Alert** in https://console.cloud.google.com/billing — get an email when spend reaches $50, $100, $150.
- Keep waypoints under 15 per route to minimize matrix elements.
- The OR-Tools solver on Cloud Run costs essentially nothing — computation is free within Cloud Run's free tier.

---

## 14. Troubleshooting

### "Map not loading" / blank map area
- Check the browser console (F12) for errors.
- Make sure you replaced `YOUR_MAPS_API_KEY` in `index.html`.
- Verify the key has **Maps JavaScript API** enabled.
- Check the key's HTTP referrer restrictions include your domain.

### "Geocoding failed" for addresses
- Verify the key has **Geocoding API** enabled.
- Addresses should include city/state for best results (e.g. `Rua X, 100, Belo Horizonte, MG`).
- The Geocoding API has a rate limit — add a city suffix to make addresses unambiguous.

### "Optimization failed: Network error"
- Make sure the backend is running (`uvicorn main:app --reload --port 8080` locally).
- Check that `BACKEND_URL` in `script.js` points to the correct URL.
- The Cloud Run service may be cold-starting (first request after idle can take ~5s).

### "cors" error in browser console
- The Cloud Run service's CORS settings only allow the Firebase Hosting domains.
- If you have a custom domain, add it to `EXTRA_ALLOWED_ORIGINS` in the Cloud Run env vars.

### Cloud Run deploy fails in GitHub Actions
- Check that `GCP_SA_KEY` secret is the full JSON content of the service account key.
- Make sure billing is enabled on the GCP project.
- Ensure all required APIs are enabled (Run, Container Registry, Cloud Build).

### PyTest fails with "ModuleNotFoundError: ortools"
- Make sure you activated the virtual environment before running pytest.
- Run `pip install -r requirements.txt` again inside the activated venv.

### Docker build is very slow (first time)
- OR-Tools is ~200 MB. The first download is slow but subsequent builds use Docker layer cache.
- Subsequent builds only reinstall packages if `requirements.txt` changed.

---

## 15. Project Structure

```
MapsAppClaude/
│
├── .github/
│   └── workflows/
│       ├── deploy-frontend.yml   # Jest → Firebase Hosting deploy
│       └── deploy-backend.yml    # PyTest → Docker build → Cloud Run deploy
│
├── frontend/                     # Everything served by Firebase Hosting
│   ├── index.html                # SPA: sidebar + embedded Google Map
│   ├── style.css                 # Dark glass-morphism theme
│   ├── script.js                 # Map logic, geocoding, optimizer calls
│   └── __tests__/
│       └── script.test.js        # Jest unit tests
│
├── backend/                      # Python FastAPI backend (runs in Docker)
│   ├── main.py                   # FastAPI app, CORS, /optimize endpoint
│   ├── solver.py                 # OR-Tools VRP engine + Routes API client
│   ├── models.py                 # Pydantic request/response models
│   ├── requirements.txt          # Pinned Python dependencies
│   ├── Dockerfile                # Multi-stage build (builder + slim runtime)
│   ├── pytest.ini                # PyTest configuration
│   └── tests/
│       └── test_solver.py        # PyTest suite (25 tests, mocked Routes API)
│
├── firebase.json                 # Firebase Hosting config (public: frontend/)
├── .firebaserc                   # Firebase project alias (mapsapp-route-optimizer)
├── package.json                  # Jest config + npm scripts
├── .gitignore                    # Excludes secrets, venvs, node_modules
└── README.md                     # This file
```

---

## Quick-Start Cheat Sheet

```bash
# 1. Clone
git clone https://github.com/Decathlusnek/MapsAppClaude.git && cd MapsAppClaude

# 2. Put your Maps API key in frontend/index.html (replace YOUR_MAPS_API_KEY)

# 3. Run frontend locally
firebase serve --only hosting

# 4. Run backend locally (separate terminal)
cd backend && python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8080

# 5. Run tests
npm install && npm test          # Jest
cd backend && pytest tests/ -v   # PyTest

# 6. Deploy everything
git add . && git commit -m "deploy" && git push origin main
# → GitHub Actions handles the rest
```

---

*Built with ❤️ | Firebase Hosting + Google Cloud Run + OR-Tools*

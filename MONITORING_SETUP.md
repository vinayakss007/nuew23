# NuCRM Monitoring & Error Tracking

## 🚀 Quick Start

### Start with Monitoring
```bash
# Start NuCRM + monitoring stack
docker compose --profile monitoring up -d

# Access points:
# - NuCRM App:     http://localhost:3000
# - Grafana:       http://localhost:3001  (admin/admin)
# - Prometheus:    http://localhost:9090
```

### Start without Monitoring (default)
```bash
docker compose up -d
```

---

## 📊 Grafana Dashboards

### Access
- **URL**: http://localhost:3001
- **Login**: admin / admin (change in .env.local)

### Pre-configured Dashboards
1. **NuCRM - Main Dashboard**
   - Database connections
   - Redis memory usage
   - Active tenants
   - Total contacts
   - Contacts by status (pie chart)
   - Deals pipeline value
   - Won deals this month
   - Deals by stage
   - Recent activities
   - Top companies by deal value
   - Contacts created (last 7 days)

### Data Sources
- **Prometheus** - System & service metrics
- **PostgreSQL** - Direct database queries for business metrics

---

## 🔥 Sentry Error Tracking

### Setup (Optional)
1. Create account at [sentry.io](https://sentry.io)
2. Create new project → Next.js
3. Copy your DSN from Settings → Client Keys
4. Add to `.env.local`:
```env
SENTRY_DSN=https://your-key@sentry.io/123456
SENTRY_ORG=your-org-name
SENTRY_PROJECT=nucrm-app
SENTRY_AUTH_TOKEN=sntr_your-token
SENTRY_ENABLE=true
SENTRY_TRACES_SAMPLE_RATE=0.2
```

### Test Sentry
```bash
# Send a test error to Sentry
curl http://localhost:3000/api/health?test-sentry=true
```

### What Gets Tracked
- ✅ All unhandled exceptions (client & server)
- ✅ API route errors
- ✅ Database errors
- ✅ Performance transactions (20% sample rate)
- ✅ Custom error captures in code

### Ignore Noise
The following are automatically filtered:
- Browser extension errors
- Network fetch failures
- ResizeObserver loop warnings
- Health check endpoint noise

---

## 📈 Prometheus Metrics

### Scraped Targets
| Target | Port | Metrics |
|--------|------|---------|
| PostgreSQL Exporter | 9187 | DB connections, query time, table stats |
| Redis Exporter | 9121 | Memory, connections, keys count |
| NuCRM App | 3000 | Health status |

### Custom Metrics
Add application metrics by exposing them via `/api/metrics` endpoint (future enhancement).

---

## 🔧 Configuration

### Environment Variables
```env
# Sentry
SENTRY_DSN=                  # Your Sentry DSN
SENTRY_ORG=nucrm             # Sentry organization
SENTRY_AUTH_TOKEN=           # Sentry auth token for source maps
SENTRY_ENABLE=false          # Enable/disable Sentry
SENTRY_TRACES_SAMPLE_RATE=0.2 # Performance sampling rate

# Grafana
GRAFANA_ADMIN_USER=admin     # Grafana admin username
GRAFANA_ADMIN_PASSWORD=admin # Grafana admin password
```

### Docker Profiles
- **default**: Core services (app, worker, postgres, redis)
- **monitoring**: Full stack (+ prometheus, grafana, exporters)

---

## 🛠️ Troubleshooting

### Grafana can't connect to PostgreSQL
Ensure POSTGRES_PASSWORD matches in both postgres service and Grafana datasource.

### Sentry not receiving errors
1. Check `SENTRY_ENABLE=true` in .env.local
2. Verify `SENTRY_DSN` is set correctly
3. Test with: `curl http://localhost:3000/api/health?test-sentry=true`
4. Check app logs for Sentry initialization messages

### Prometheus showing no data
1. Check exporter containers are running: `docker compose ps`
2. Verify targets in Prometheus: http://localhost:9090/targets
3. Check exporter logs: `docker compose logs postgres-exporter`

---

## 📁 File Structure
```
nucrm/
├── monitoring/
│   ├── prometheus/
│   │   └── prometheus.yml          # Prometheus config
│   └── grafana/
│       ├── provisioning/
│       │   ├── datasources.yml     # Auto-provisioned datasources
│       │   └── dashboards.yml      # Dashboard provisioning config
│       └── dashboards/
│           └── nucrm-main.json     # Main dashboard
├── sentry.client.config.ts         # Sentry client config
├── sentry.server.config.ts         # Sentry server config
├── sentry.edge.config.ts           # Sentry edge/middleware config
├── instrumentation.ts              # Next.js instrumentation hook
└── next.config.mjs                 # Updated with Sentry wrapper
```

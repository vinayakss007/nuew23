# 🚀 Quick Start - One Click Install

## Prerequisites
- **Docker** installed and running ([Get Docker](https://docs.docker.com/get-docker/))

## One Click Start

### Linux/Mac
```bash
./start-docker.sh
```

### Windows
Double-click `start-docker.bat`

## That's it! 

The script will:
1. ✅ Check Docker is ready
2. ✅ Build the application
3. ✅ Start PostgreSQL, Redis, App, and Worker
4. ✅ Wait for everything to be healthy
5. ✅ Give you the URL to open

## Access NuCRM

🌐 **Open:** http://localhost:3000

### First Time Setup
1. Visit http://localhost:3000/setup
2. Create your admin account
3. Start using!

## Useful Commands

```bash
# View logs
docker-compose logs -f

# Stop everything
docker-compose down

# Restart
docker-compose restart

# Rebuild after code changes
docker-compose up -d --build
```

## What Gets Installed

| Service | Port | Description |
|---------|------|-------------|
| PostgreSQL | 5432 | Database |
| Redis | 6379 | Cache & Queues |
| NuCRM App | 3000 | Main application |
| NuCRM Worker | - | Background jobs |

All data is stored in Docker volumes and persists between restarts.

## Troubleshooting

**Docker not running?**
- Start Docker Desktop or `sudo systemctl start docker`

**Port already in use?**
- Stop other services using ports 3000, 5432, 6379
- Or edit `docker-compose.yml` to use different ports

**App won't start?**
```bash
docker-compose logs app
```

# BlazeConnector v3

> Production-ready ISP messaging and billing platform

Rebuilt from scratch with modern architecture: **Bun + Hono + TypeScript + Zod v4**

## ✨ Features

- 🚀 **Bun Runtime** - Ultra-fast JavaScript runtime
- 🌐 **Hono Web Framework** - Lightweight, performant HTTP server
- 🔒 **Strict TypeScript** - Full type safety with Zod v4 validation
- 📨 **Async Message Queue** - Non-blocking, priority-based, with retries
- 🔄 **WebSocket Support** - Real-time event broadcasting
- 🏢 **Multi-tenancy** - Full client isolation with API key auth
- 💳 **Payment Processing** - Cardnet, Azul, PayPal integrations
- 📱 **Multi-channel Messaging** - WhatsApp Cloud, Telegram, Chatwoot

## 🏗️ Architecture

```
src/
├── core/           # Config, logging, shared utilities
├── types/          # Zod schemas and TypeScript types
├── db/             # Drizzle ORM schema and connection
├── queue/          # Redis-based message queue
├── api/            # Hono routes and middleware
│   └── routes/     # Endpoint handlers
├── services/       # Business logic (integrations, billing)
├── workers/        # Background message processor
└── ws/             # WebSocket server
```

### Message Flow

```
API Request
    │
    ▼
┌─────────────────┐
│  Validate Zod   │
│  Check Auth     │
│  Rate Limit     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Message Queue  │◄── Redis (priority queue)
│  - Priority     │
│  - Idempotency  │
│  - Retries      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Worker Pool    │◄── Concurrent processing
│  (10 workers)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  WhatsApp API   │
│  (or other)     │
└─────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- **Bun** >= 1.1.0
- **PostgreSQL** >= 14
- **Redis** >= 6

### Installation

```bash
# Clone the repo
git clone git@github.com:AlvinTLC/blazeconnector-v3.git
cd blazeconnector-v3

# Install dependencies
bun install

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
```

### Database Setup

```bash
# Generate migrations
bun run drizzle-kit generate

# Run migrations
bun run drizzle-kit migrate

# Or push schema directly (dev)
bun run drizzle-kit push
```

### Running

```bash
# Development (with hot reload)
bun run dev

# Production
bun run start

# Run tests
bun run test

# Type check
bun run typecheck
```

## 📡 API Endpoints

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Basic health check |
| GET | `/health/detailed` | Health with dependencies |
| GET | `/health/ready` | Readiness probe |
| GET | `/health/live` | Liveness probe |

### Messages

| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| POST | `/api/v3/messages` | `messages:send` | Queue a message |
| POST | `/api/v3/messages/batch` | `messages:send` | Queue batch messages |
| GET | `/api/v3/messages/:id` | `messages:read` | Get message status |
| GET | `/api/v3/messages` | `messages:read` | List messages |
| POST | `/api/v3/messages/:id/cancel` | `messages:send` | Cancel pending message |
| GET | `/api/v3/messages/queue/stats` | `messages:read` | Queue statistics |

### Clients

| Method | Endpoint | Scope | Description |
|--------|----------|-------|-------------|
| GET | `/api/v3/clients` | `admin` | List all clients |
| GET | `/api/v3/clients/me` | - | Get current client |
| POST | `/api/v3/clients` | `admin` | Create client |
| PATCH | `/api/v3/clients/:id` | `admin` | Update client |

## 🔑 Authentication

All API requests require an API key via:

```
X-Api-Key: bk_live_xxxxxxxxxxxxxxxx
```

or

```
Authorization: Bearer bk_live_xxxxxxxxxxxxxxxx
```

### API Key Scopes

| Scope | Description |
|-------|-------------|
| `admin` | Full access |
| `billing:read` | Read billing data |
| `billing:write` | Write billing data |
| `messages:read` | Read messages |
| `messages:send` | Send messages |
| `payments:read` | Read payments |
| `payments:write` | Create payments |

## 📨 Message Queue

### Features

- **Priority-based**: urgent > high > normal > low
- **Idempotency**: Deduplicate with idempotency keys
- **Retries**: Exponential backoff (2s, 4s, 8s...)
- **Delayed**: Schedule messages for future delivery
- **Dead Letter Queue**: Failed messages preserved for analysis

### Example

```typescript
// Queue a message
const response = await fetch('/api/v3/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': 'bk_live_xxx',
  },
  body: JSON.stringify({
    phoneNumber: '18091234567',
    templateKey: 'PAGO_APLICADO',
    templateParams: ['Juan', '1500.00', '0.00'],
    priority: 'normal',
    idempotencyKey: 'payment-123-confirmation',
  }),
});

// Response
{
  "success": true,
  "data": {
    "messageId": "abc123",
    "jobId": "job456",
    "status": "queued"
  }
}

// Check status
const status = await fetch('/api/v3/messages/abc123', {
  headers: { 'X-Api-Key': 'bk_live_xxx' },
});
```

## 🔌 Integrations

Supported billing systems:
- **MikroWisp**
- **WispHub**
- **OfiCable**
- **SmartOLT**
- **OLTCloud**

Messaging channels:
- **WhatsApp Cloud API**
- **Telegram**
- **Chatwoot**

Payment gateways:
- **Cardnet**
- **Azul**
- **PayPal**

## 🧪 Testing

```bash
# Run all tests
bun run test

# Run with coverage
bun run test:coverage

# Run specific test file
bun test tests/queue.test.ts
```

## 📊 Monitoring

### Queue Stats

```bash
curl -H "X-Api-Key: your-key" http://localhost:3005/api/v3/messages/queue/stats
```

### Health Check

```bash
curl http://localhost:3005/health/detailed
```

### WebSocket

Connect to `ws://localhost:3005/ws` for real-time events:

```javascript
const ws = new WebSocket('ws://localhost:3005/ws');

ws.onopen = () => {
  // Authenticate
  ws.send(JSON.stringify({
    type: 'authenticate',
    payload: { clientId: 'your-client-id', token: 'your-token' }
  }));
  
  // Subscribe to channels
  ws.send(JSON.stringify({
    type: 'subscribe',
    payload: { channels: ['messages', 'payments'] }
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Event:', message);
};
```

## 🔄 Migrating from v2

v3 is a complete rewrite. Key differences:

| Feature | v2 | v3 |
|---------|----|----|
| Runtime | Node.js | Bun |
| Framework | Express | Hono |
| Validation | Joi | Zod v4 |
| Queue | None (sync) | Redis-based async |
| ORM | Sequelize | Drizzle |
| Architecture | Monolithic | Modular layers |

### Migration Steps

1. Set up new v3 instance alongside v2
2. Export data from v2 PostgreSQL
3. Import to v3 using migration scripts
4. Update API endpoints in clients
5. Switch DNS to v3

## 📝 License

Apache-2.0

---

Built with ❤️ for ISP automation

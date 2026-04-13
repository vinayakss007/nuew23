# NuCRM API Documentation

Complete API reference for NuCRM SaaS CRM.

## Base URL

- **Development**: `http://localhost:3000`
- **Production**: `https://your-domain.com`

## Authentication

All API requests (except public endpoints) require authentication via JWT token.

### Methods

**Cookie Authentication** (recommended for web app):
```http
Cookie: nucrm_session=<jwt_token>
```

**Bearer Token** (for API clients):
```http
Authorization: Bearer <jwt_token>
```

**API Key** (for external integrations):
```http
Authorization: Bearer ak_live_xxx...
```

### Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (permission denied) |
| 404 | Not Found |
| 409 | Conflict (duplicate) |
| 429 | Rate Limited |
| 500 | Server Error |

---

## Authentication Endpoints

### POST `/api/auth/signup`

Create new account and workspace.

**Request:**
```json
{
  "email": "user@company.com",
  "password": "SecurePass123!",
  "full_name": "John Doe",
  "workspace_name": "Acme Inc"
}
```

**Response:**
```json
{
  "user": { "id": "...", "email": "user@company.com" },
  "tenant": { "id": "...", "name": "Acme Inc" }
}
```

### POST `/api/auth/login`

Login with email and password.

**Request:**
```json
{
  "email": "user@company.com",
  "password": "SecurePass123!",
  "totp_code": "123456"  // Optional, if 2FA enabled
}
```

**Response:**
```json
{
  "requires_2fa": false,
  "redirect": "/tenant/dashboard"
}
```

### POST `/api/auth/logout`

Invalidate session.

**Response:** `204 No Content`

### POST `/api/auth/2fa/setup`

Enable two-factor authentication.

**Response:**
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qr_code_url": "data:image/png;base64,...",
  "backup_codes": ["12345678", "87654321", ...]
}
```

### POST `/api/auth/forgot-password`

Request password reset email.

**Request:**
```json
{ "email": "user@company.com" }
```

### POST `/api/auth/reset-password`

Reset password with token.

**Request:**
```json
{
  "token": "reset_token_from_email",
  "new_password": "NewSecurePass123!"
}
```

---

## Contacts Endpoints

### GET `/api/tenant/contacts`

List contacts with pagination and filters.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 20) |
| `q` | string | Search query (name, email, company) |
| `lead_status` | string | Filter by status |
| `assigned_to` | string | Filter by owner |
| `sort` | string | Sort field (default: created_at) |
| `order` | string | asc/desc (default: desc) |

**Response:**
```json
{
  "data": [
    {
      "id": "...",
      "first_name": "John",
      "last_name": "Doe",
      "email": "john@example.com",
      "phone": "+1234567890",
      "company_name": "Acme Inc",
      "lead_status": "qualified",
      "lead_source": "website",
      "score": 75,
      "tags": ["hot-lead", "enterprise"],
      "assigned_name": "Jane Sales",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 20
}
```

### POST `/api/tenant/contacts`

Create new contact.

**Request:**
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "company_id": "...",
  "lead_status": "new",
  "lead_source": "referral",
  "tags": ["vip"],
  "notes": "Referred by existing customer",
  "city": "San Francisco",
  "country": "USA",
  "website": "https://example.com",
  "linkedin_url": "https://linkedin.com/in/johndoe"
}
```

**Response:** `201 Created` with contact object

### GET `/api/tenant/contacts/:id`

Get contact details.

**Response:**
```json
{
  "id": "...",
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "company_id": "...",
  "company_name": "Acme Inc",
  "lead_status": "qualified",
  "lead_source": "website",
  "score": 75,
  "lifecycle_stage": "customer",
  "tags": ["hot-lead"],
  "notes": "Interested in enterprise plan",
  "city": "San Francisco",
  "country": "USA",
  "website": "https://example.com",
  "linkedin_url": "https://linkedin.com/in/johndoe",
  "twitter_url": "https://twitter.com/johndoe",
  "do_not_contact": false,
  "assigned_to": "...",
  "assigned_name": "Jane Sales",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-20T14:00:00Z",
  "activities": [...],
  "notes_list": [...],
  "tasks": [...],
  "deals": [...]
}
```

### PATCH `/api/tenant/contacts/:id`

Update contact.

**Request:** Any contact fields to update

**Response:** Updated contact object

### DELETE `/api/tenant/contacts/:id`

Soft delete contact (moves to trash).

**Response:** `204 No Content`

### PATCH `/api/tenant/contacts/:id/status`

Update lead status.

**Request:**
```json
{ "lead_status": "qualified" }
```

### POST `/api/tenant/contacts/merge`

Merge duplicate contacts.

**Request:**
```json
{
  "primary_id": "...",
  "duplicate_ids": ["...", "..."]
}
```

### POST `/api/tenant/contacts/import`

Bulk import contacts from CSV.

**Headers:** `Content-Type: multipart/form-data`

**Body:**
- `file`: CSV file
- `skip_duplicates`: boolean
- `update_existing`: boolean

**Response:**
```json
{
  "job_id": "...",
  "message": "Import queued. You will be notified when complete."
}
```

### GET `/api/tenant/contacts/export`

Export contacts to CSV.

**Query Parameters:** Same as list endpoint

**Response:** CSV file download

---

## Deals Endpoints

### GET `/api/tenant/deals`

List deals (Kanban view).

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `stage` | string | Filter by stage |
| `assigned_to` | string | Filter by owner |
| `min_value` | number | Minimum deal value |
| `max_value` | number | Maximum deal value |
| `close_date_from` | date | Filter by close date |
| `close_date_to` | date | Filter by close date |

**Response:**
```json
{
  "data": [
    {
      "id": "...",
      "title": "Enterprise Deal - Acme Inc",
      "value": 50000,
      "stage": "proposal",
      "probability": 60,
      "close_date": "2024-03-15",
      "contact_name": "John Doe",
      "company_name": "Acme Inc",
      "assigned_name": "Jane Sales",
      "created_at": "2024-01-10T09:00:00Z"
    }
  ],
  "total": 45,
  "pipeline_totals": {
    "lead": 5,
    "qualified": 10,
    "proposal": 15,
    "negotiation": 10,
    "won": 5
  }
}
```

### POST `/api/tenant/deals`

Create new deal.

**Request:**
```json
{
  "title": "Enterprise Deal - Acme Inc",
  "value": 50000,
  "stage": "lead",
  "probability": 20,
  "close_date": "2024-03-15",
  "contact_id": "...",
  "company_id": "...",
  "notes": "Large enterprise opportunity"
}
```

---

## Companies Endpoints

### GET `/api/tenant/companies`

List companies.

**Response:**
```json
{
  "data": [
    {
      "id": "...",
      "name": "Acme Inc",
      "industry": "Technology",
      "website": "https://acme.com",
      "phone": "+1234567890",
      "city": "San Francisco",
      "country": "USA",
      "annual_revenue": 10000000,
      "company_size": "50-200",
      "contact_count": 15,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 50
}
```

### POST `/api/tenant/companies`

Create company.

**Request:**
```json
{
  "name": "Acme Inc",
  "industry": "Technology",
  "website": "https://acme.com",
  "phone": "+1234567890",
  "city": "San Francisco",
  "country": "USA",
  "annual_revenue": 10000000,
  "company_size": "50-200",
  "notes": "Key enterprise customer"
}
```

---

## Tasks Endpoints

### GET `/api/tenant/tasks`

List tasks with filters.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `status` | string | `pending`, `completed`, `overdue` |
| `priority` | string | `low`, `medium`, `high` |
| `assigned_to` | string | Filter by assignee |
| `due_date_from` | date | Filter by due date |
| `due_date_to` | date | Filter by due date |

**Response:**
```json
{
  "data": [
    {
      "id": "...",
      "title": "Follow up with John Doe",
      "description": "Discuss enterprise requirements",
      "priority": "high",
      "due_date": "2024-01-20T14:00:00Z",
      "completed": false,
      "contact_name": "John Doe",
      "deal_title": "Enterprise Deal",
      "assigned_name": "Jane Sales",
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "total": 25,
  "summary": {
    "overdue": 5,
    "today": 10,
    "upcoming": 10
  }
}
```

### POST `/api/tenant/tasks`

Create task.

**Request:**
```json
{
  "title": "Follow up with John Doe",
  "description": "Discuss enterprise requirements",
  "priority": "high",
  "due_date": "2024-01-20T14:00:00Z",
  "contact_id": "...",
  "deal_id": "...",
  "assigned_to": "..."
}
```

### PATCH `/api/tenant/tasks/:id`

Update task.

**Request:** Any task fields

### PATCH `/api/tenant/tasks/:id/complete`

Mark task as complete.

**Response:** Updated task

### DELETE `/api/tenant/tasks/:id`

Delete task.

---

## Team & Roles Endpoints

### GET `/api/tenant/members`

List team members.

**Response:**
```json
{
  "data": [
    {
      "id": "...",
      "user": {
        "id": "...",
        "email": "jane@company.com",
        "full_name": "Jane Sales"
      },
      "role_slug": "sales_rep",
      "status": "active",
      "joined_at": "2024-01-01T00:00:00Z",
      "last_seen_at": "2024-01-20T10:00:00Z"
    }
  ]
}
```

### POST `/api/tenant/invite/send`

Send team invitation.

**Request:**
```json
{
  "email": "newuser@company.com",
  "role_slug": "sales_rep"
}
```

### GET `/api/tenant/roles`

List roles.

**Response:**
```json
{
  "data": [
    {
      "id": "...",
      "name": "Sales Representative",
      "slug": "sales_rep",
      "description": "Can manage own contacts and deals",
      "is_system": true,
      "permissions": {
        "contacts.create": true,
        "contacts.edit": true,
        "contacts.view_all": false,
        ...
      }
    }
  ]
}
```

### POST `/api/tenant/roles`

Create custom role.

**Request:**
```json
{
  "name": "Custom Role",
  "slug": "custom-role",
  "description": "Custom permissions",
  "permissions": {
    "contacts.create": true,
    "contacts.edit": true,
    ...
  }
}
```

---

## Automation Endpoints

### GET `/api/tenant/automations`

List automations.

**Response:**
```json
{
  "data": [
    {
      "id": "...",
      "name": "Welcome Email",
      "description": "Send welcome email to new contacts",
      "trigger_type": "contact.created",
      "is_active": true,
      "actions": [
        {
          "type": "send_email",
          "config": {
            "to": "{{email}}",
            "subject": "Welcome!",
            "body": "Hi {{first_name}}, welcome!"
          }
        }
      ],
      "run_count": 150,
      "last_run_at": "2024-01-20T10:00:00Z"
    }
  ]
}
```

### POST `/api/tenant/automations`

Create automation.

**Request:**
```json
{
  "name": "Welcome Email",
  "description": "Send welcome email",
  "trigger_type": "contact.created",
  "actions": [
    {
      "type": "send_email",
      "config": {
        "to": "{{email}}",
        "subject": "Welcome!",
        "body": "Hi {{first_name}}!"
      }
    }
  ]
}
```

---

## Modules Endpoints

### GET `/api/tenant/modules`

List available modules.

**Response:**
```json
{
  "available": [
    {
      "id": "automation-pro",
      "name": "Automation Pro",
      "description": "Advanced automation features",
      "price": 29,
      "features": ["Unlimited automations", "Conditional logic"]
    }
  ],
  "installed": [
    {
      "id": "core-crm",
      "name": "Core CRM",
      "status": "active"
    }
  ]
}
```

### POST `/api/tenant/modules`

Install module.

**Request:**
```json
{
  "module_id": "automation-pro",
  "settings": {
    "api_key": "..."
  }
}
```

---

## Webhooks

### Outgoing Webhooks

NuCRM sends webhooks for the following events:

| Event | Payload |
|-------|---------|
| `contact.created` | Contact object |
| `contact.updated` | Contact object + changes |
| `deal.won` | Deal object |
| `deal.lost` | Deal object |
| `task.completed` | Task object |

### Webhook Headers

```http
X-NuCRM-Signature: sha256=abc123...
X-NuCRM-Event: contact.created
X-NuCRM-Tenant: tenant-id
```

---

## Rate Limits

| Endpoint Category | Limit |
|-------------------|-------|
| Auth endpoints | 5 requests/minute per IP |
| CRM endpoints | 100 requests/minute per tenant |
| AI endpoints | 30 requests/hour per tenant |
| Export endpoints | 10 requests/hour per tenant |
| Webhook endpoints | 1000 requests/hour per tenant |

### Rate Limit Headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705756800
```

---

## Error Responses

### Validation Error

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "email", "message": "Invalid email format" },
    { "field": "phone", "message": "Phone is required" }
  ]
}
```

### Permission Denied

```json
{
  "error": "Permission denied: contacts.delete required"
}
```

### Not Found

```json
{
  "error": "Contact not found"
}
```

### Server Error

```json
{
  "error": "Internal server error",
  "code": "ERR_DATABASE_CONNECTION"
}
```

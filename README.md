# TimeOff -  Time Off Request Management System


## Overview

TimeOff is an enterprise-grade backend service that manages the complete lifecycle of employee time off requests. It provides intelligent balance management with conflict prevention, automatic synchronization with Human Capital Management (HCM) systems, and full audit trails for compliance. The system handles concurrent requests gracefully, validates business logic (working days calculation, balance availability), and ensures idempotent operations for reliability.

## Key Features

- **Smart Request Management**: Create, approve, reject, and cancel time off requests with state machine validation and transition rules
- **Intelligent Balance Tracking**: Real-time balance management with advisory locking to prevent over-booking, automatic balance deductions, and balance recovery on cancellations
- **Working Days Calculation**: Accurate leave duration computation excluding weekends and holidays
- **HCM System Integration**: Bi-directional synchronization with external HCM systems via REST APIs with retry mechanisms and error handling
- **Enterprise Security**: JWT-based authentication, role-based access control (RBAC), and permission-based endpoint access
- **Complete Audit Trail**: Track all request lifecycle events and balance changes for compliance and reporting
- **Webhook Support**: Process external events and notifications from integrated systems
- **Idempotency Guarantees**: Safe retry mechanisms to prevent duplicate request processing
- **Concurrent Request Handling**: Thread-safe operations with advisory locks for distributed scenarios

## Project Structure

```
src/
├── audit/              # Audit logging service
├── balance/            # Time off balance management
├── common/             # Shared utilities and guards
│   ├── decorators/     # Custom decorators (roles, etc.)
│   ├── guards/         # JWT and role-based guards
│   └── utills/         # Utility functions (HMAC, idempotency, working days)
├── config/             # Configuration management
├── database/           # Database connection and setup
├── mock-hcm/           # HCM mock server for testing
├── requests/           # Time off requests API
├── sync/               # HCM synchronization services
└── webhooks/           # Webhook handling

test/
├── integration/        # Integration tests
└── unit/              # Unit tests
```

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Database (configured in environment)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd TimeOff
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
Create a `.env` file in the root directory with required configuration (see `src/config/configuration.ts`)

## Running the Application

### Development Mode
```bash
npm run start:dev
```

### Production Build
```bash
npm run build
npm run start:prod
```

## Testing

### Run All Tests
```bash
npm run test
```

### Unit Tests
```bash
npm run test:unit
```

### Integration Tests
```bash
npm run test:integration
```

### Test Coverage
```bash
npm run test:cov
```

## API Endpoints

### Requests Management (`/api/v1/requests`)
- `POST /` - Submit a new time off request
- `GET /:id` - Retrieve request details
- `PATCH /:id/approve` - Approve a request (manager only)
- `PATCH /:id/reject` - Reject a request with reason (manager only)
- `PATCH /:id/cancel` - Cancel an approved request (employee or manager)

### Balance Management (`/api/v1/balance`)
- `GET /:employeeId/:locationId/:leaveType` - Get balance for an employee
- `PATCH /:employeeId/adjust` - Adjust balance (admin only)
- `GET /:employeeId` - Get all balances for an employee

### Webhooks (`/api/v1/webhooks`)
- `POST /` - Receive external events (HCM updates, calendar events, etc.)

All endpoints require JWT authentication except webhooks (validated with HMAC).

## Configuration

Configuration is managed through environment variables in the `src/config/configuration.ts` file:

```bash
# Server
PORT=3000

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRY=1h

# Database
DATABASE_PATH=./data/timeoff.db

# HCM Integration
HCM_BASE_URL=https://hcm.example.com
HCM_API_KEY=your-api-key
HCM_SYNC_INTERVAL=3600000 # 1 hour

# Webhook
WEBHOOK_SECRET=your-webhook-secret
```

## Technology Stack

- **Framework**: NestJS v10 - Progressive Node.js framework with built-in DI and decorators
- **Language**: TypeScript v5.2 - Type-safe development with full IDE support
- **Database**: SQLite (better-sqlite3) - Lightweight, file-based database with advisory lock support
- **Authentication**: JWT (JSON Web Tokens) - Stateless authentication mechanism
- **Validation**: Class-validator + Class-transformer - Declarative validation and transformation
- **Testing**: Jest + Supertest - Comprehensive unit and integration testing
- **HTTP Client**: Axios with retry logic - Reliable HCM API communication

## Architecture Highlights

### State Machine Pattern
Request statuses follow a strict state machine with validated transitions:
- PENDING → APPROVED → CONFIRMED → USED
- PENDING → APPROVED → CANCELLED
- PENDING → REJECTED

### Optimistic Locking
Advisory locks prevent race conditions when multiple requests modify the same employee balance simultaneously.

### Audit Trail
Every action (request submission, approval, balance changes) is logged with:
- Timestamp and actor information
- Change details and previous/new values
- System-level context for debugging

### Idempotent Operations
Requests can include an `Idempotency-Key` header to safely retry API calls without creating duplicates.

## Development

### Running Tests
```bash
npm run test              # Unit tests
npm run test:integration  # Integration tests
npm run test:all          # Full test suite with coverage
```

### Code Style
- TypeScript with strict type checking enabled
- NestJS conventions for modules, services, and controllers
- Dependency injection for testability
- Custom exceptions for error handling
- Input validation using decorators





# AGENTS.md

This file provides guidance to agents when working with code in this repository.

# Project Coding Rules (Non-Obvious Only)

- **Three-Layer Pattern**:
  1. `app/api/.../route.js`: Minimal handler. Only handles HTTP request/response and calls the controller.
  2. `lib/controllers/...`: Wrapper that defines JSDoc metadata (for docs) and formats the final response envelope.
  3. `lib/...`: Pure business logic, scrapers, or DB calls.
- **Controller JSDoc**: Required tags for documentation: `@title`, `@summary`, `@description`, `@method`, `@path`, `@param`, `@example`.
- **Dynamic Routes**: Use `export const dynamic = 'force-dynamic'` in route handlers to prevent Next.js from caching API responses.
- **DB Access**: Use the shared pool from [`lib/db.js`](lib/db.js).
- **Validation**: Controllers throw `Error` for validation failures. Route handler catches → returns `{ success: false, message }` with status 500.
- **Query Wrapping**: Route handler wraps query params into `mockReq = { query }`, then passes to controller function.

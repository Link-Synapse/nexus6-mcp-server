# Security Policy

- Secrets live only in `.env` (never commit).  
- Consider enabling bearer auth for `/api/*` before exposing beyond localhost.  
- Rotate API keys if logs or environment files are exposed.

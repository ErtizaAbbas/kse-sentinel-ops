# Sentinel Operations

Internal console for the MZE Digital team (KSE Sentinel). Private.
Spec: KSE_Sentinel_Operations_Console_Spec.md (v3).

Runs locally only until team MFA (Phase 0b) is in place; it is then deployed
to ops.kse-sentinel.com.

    npm install
    npm run dev          # http://localhost:5174

Settings (.env, never committed):

    VITE_API_BASE=http://localhost:8001
    VITE_API_KEY=<the platform API key, as in the Terminal's .env>

The backend must list http://localhost:5174 in ALLOWED_ORIGINS.

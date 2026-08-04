# Savepoint: v-stable-2025-01-clean

**Date:** 2025-01-clean  
**Status:** Verified stable

## What is confirmed working at this savepoint:
- Frontend and backend port configuration resolved (3000/8001 both accepted)
- Emergent agent access fully revoked
- `.emergent/` phone-home cron removed
- GitHub access: Myth (Promethius AI) only
- WebAuthn accepts both localhost:3000 and localhost:8001

## What was removed:
- `.emergent/` directory and all contents
- Emergent webhook cron (was phoning home every 60 seconds)
- Emergent GitHub collaborator access

## Rollback instructions:
If access is lost, restore from this commit hash.
Do NOT make changes to server.py, auth routes, port config, or WebAuthn without creating a new savepoint first.

## Next steps pending:
- Rotate all API keys (Anthropic, ElevenLabs, Tavily, FAL.ai, MongoDB, AETHERCUT_SERVICE_TOKEN)
- API key rotation must happen outside GitHub (in each provider's dashboard)

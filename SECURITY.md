# Security

OpenDots supports multi-user accounts. Sign-up creates the first account as the owner (adopting the pre-existing single-owner data); later accounts are members. Sessions are 30-day random tokens stored only as SHA-256 hashes; passwords are scrypt-hashed with per-user salts. OWNER_TOKEN remains as break-glass access to the owner account for recovery and server-to-server use. Repeated failed sign-in, signup, and token attempts are rate-limited per client, and the voice WebSocket is authorized with single-use, short-lived tickets bound to the signed-in user instead of any credential in the URL.

## Intended boundary

- Run local development on loopback. Before the first account exists the deployment stays open (bootstrap mode); creating the owner account locks every API route behind sign-in.
- Protect remote deployments with authentication and HTTPS.
- Per-user isolation is enforced at the data layer: conversations, session/task memories, scheduled tasks, long-term memories, uploads, voice calls, and CopilotKit thread access are scoped to the signed-in owner. Another user's thread id reads as missing. Server-wide settings, the Dot catalog, computers, and connected channels are owner-managed resources.
- Keep the browser service isolated from the application host and private networks. Do not expose its port publicly.
- Keep Intelligence, model, speech, and browser credentials on the server. Never commit `.env` files or local databases.
- Treat page text, uploaded content, and model output as untrusted data, not authorization to change permissions.
- Authorize every Space, Dot, and thread operation on the server. Map Slack actors explicitly; never treat a display name or client-supplied user ID as proof of identity.
- Voice sessions must use scoped, short-lived credentials and route compute actions through the same permissions as text and Slack.
- Research browsing is read-only. Page tools can edit local documents in the executing Dot’s Space; those writes use revision checks. Adding external writes requires a separate authorization and review design.

Recurring work requires an available server. A sample run is not evidence that a live provider or deployment is safe or configured correctly. Review results before using them for important decisions.

## Reporting

Use the repository's private vulnerability reporting feature when available. If it is unavailable, open an issue asking for a private reporting channel without including exploit details, credentials, private URLs, or personal data.

Do not post sensitive reproduction data in a public issue. This project does not currently promise a response-time SLA or offer a bug bounty.

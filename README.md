# LovePlay real-time starter

This is a deployable starter for the LovePlay couple app. It includes:
- Email/password registration and login (bcrypt password hashing, JWT sessions)
- Private two-player invite rooms
- Persistent private-room text chat (PostgreSQL)
- WebRTC voice/video call signalling through Socket.IO
- Room event signalling for jungle/racing game launch
- Membership request records for ₹149 / ₹399 / ₹1,999 (pending until host verifies payment)
- Selfie preview as a local browser profile avatar

## Important scope and limitations
- This is a starter, not a finished commercial app. It does not yet include full playable 3D jungle/racing games, AI selfie-to-3D conversion, push notifications, admin payment verification screens, moderation/report workflows, or production-grade privacy controls.
- Selfies are only previewed and stored in the registering browser's local storage in this starter; they are not uploaded or synced to the partner's device.
- Video uses browser WebRTC with a public STUN server. Some networks require a TURN relay (for example, a separately configured TURN provider) for reliable calls. A call requires both players to be online in the same room.
- Membership requests do not take money or activate plans. Add a payment gateway and host verification before accepting real payments.
- Use HTTPS in deployment. Never commit `.env` or expose secrets in frontend code.
- Add age verification (18+), privacy policy, terms, consent, blocking/reporting and abuse response before public launch.

## Free deployment outline
1. Create a free PostgreSQL database at https://neon.tech/ and copy its connection string. Keep it private.
2. Create a GitHub repository and upload this folder's contents.
3. Create a free web service at https://render.com/ from that repository. `render.yaml` defines the service.
4. Set `DATABASE_URL` to the Neon connection string. Set `JWT_SECRET` to a long random secret in Render environment settings.
5. Deploy. Open the Render URL and test registration on two separate devices/browsers.

Free hosting may sleep after inactivity and has resource limits. Check current provider terms before launch. For persistent production use, configure database backups and monitoring.

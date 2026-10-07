# Ceylon Rustic Invitation with MongoDB RSVP Counts

A responsive invitation preview with editable names, wedding details, and photos. RSVP replies are saved through a small Node.js API to MongoDB. The database stores a random browser submission ID, guest name, accept/decline status, guest count, and timestamps for the private admin dashboard.

## Configure MongoDB

1. Create a MongoDB Atlas cluster and database user, then copy the application's connection string from Atlas.
2. Copy `.env.example` to `.env`.
3. Set `MONGODB_URI` to your private connection string. Set a long random `RSVP_ADMIN_TOKEN` (at least 32 characters). Keep `.env` private; `.gitignore` excludes it from source control, and do not share it in a ZIP.
4. Install and start the project:

   ```sh
   npm install
   npm start
   ```

5. Open `http://localhost:3000` for the invitation. Open `http://localhost:3000/admin` and enter the admin token to see the RSVP summary.

MongoDB's Node.js driver 7.x needs Node.js 20.19 or later. The official Atlas setup uses the cluster URI, database username, and password in `MONGODB_URI` ([driver setup](https://www.mongodb.com/docs/drivers/node/current/get-started/), [Node compatibility](https://www.mongodb.com/docs/drivers/compatibility/)).

## RSVP dashboard

The private dashboard reports confirmed guests, total responses, acceptances, declines, and a table of guest names with counts. It refreshes periodically and requires the server-side `RSVP_ADMIN_TOKEN`; the token is kept in the dashboard tab's session storage.

Each browser uses a random submission ID so an RSVP changed from the same browser updates its existing record rather than counting twice. The public API validates the attendance and guest count, limits request size and submission rate, and has no cross-origin access enabled.

If deploying behind a trusted reverse proxy, set `TRUST_PROXY=true` only when that proxy replaces (rather than appends untrusted) `X-Forwarded-For` headers; the rate limiter uses that address for per-guest limits.

## Deploy on Vercel

1. Push this repo to GitHub and import it in Vercel.
2. Leave the framework preset as **Other**, do not set a custom build command, and do not set an output directory override. Static files are served from the project root and files in `api/` are deployed as serverless functions automatically.
3. In Vercel **Project Settings → Environment Variables**, add the same values from `.env`:
   - `MONGODB_URI`
   - `MONGODB_DB`
   - `RSVP_ADMIN_TOKEN`
   - `TRUST_PROXY=true`
4. Redeploy after saving the variables.

Static pages are served from the project root. RSVP API routes live in `api/`. The browser script is `invitation.js` (not `app.js`) so Vercel does not try to run it as a serverless function. Local development uses `dev-server.js` (not `server.js`) so Vercel does not treat the project as a single backend app and skip static file hosting.

## Other interactions

- “Make it yours” updates names, family names, date/time, venue, address, story, couple illustration, story image, and gallery photos. Saves require the same `RSVP_ADMIN_TOKEN` save key used by the admin dashboard, and changes are stored in MongoDB for all visitors.
- The live countdown, map, and calendar links use the edited event details.
- RSVP submissions go to the Node API; if MongoDB is not configured, the form reports that the reply could not be saved.
- Gallery images open in a lightbox.

The MongoDB connection string and admin token are not included. Add them to a private `.env` file for local use or to the hosting provider's secret environment settings before deployment. The RSVP endpoint stores the guest name for the private dashboard only; it does not collect email addresses or phone numbers.

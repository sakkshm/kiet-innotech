# InnoTech26 API

FastAPI backend for the student portal (`client/`) and the admin panel (`admin-panel/`).
PostgreSQL for data (in Docker on the same EC2 instance), Google sign-in verified by this API, Amazon SES for emails.

## Run it locally

Needs Python 3.12 and a local PostgreSQL.

```bash
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
createdb innotech_dev && createdb innotech_test
cp .env.development.example .env          # local settings, never used in production
.venv/bin/alembic upgrade head            # create the tables
.venv/bin/python -m app.dev_seed          # optional: demo students, a team and demo admins
.venv/bin/uvicorn app.main:app --reload   # http://localhost:8000, docs at /docs
```

Tests run against the `innotech_test` database (override with `TEST_DATABASE_URL`):

```bash
.venv/bin/python -m pytest
.venv/bin/ruff check app tests && .venv/bin/ruff format --check app tests
```

### Frontends against the local API

Without Google, both frontends can sign in through `POST /dev/token`. That endpoint exists only when
`ENVIRONMENT=development` and `DEV_SIGN_IN=true`. Create a
`.env.local` in `client/` (and in `admin-panel/`):

```
NEXT_PUBLIC_API_MODE=live
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_DEV_SIGN_IN=true
NEXT_PUBLIC_FORCE_REGISTRATION_OPEN=true   # client only, while testing before 3 October
```

The demo accounts on each login page match `app/dev_seed.py`; `superadmin@kiet.edu` is the super
admin from `SUPER_ADMIN_EMAILS` in `.env.development.example`.

## Deploying

Everything is in [`deploy/`](../deploy): one CloudFormation stack (EC2 t4g.medium running Caddy, this API and
PostgreSQL in Docker; the two static sites on S3 + CloudFront; daily disk snapshots; 15-minute database dumps to S3),
and `deploy/deploy.sh` to roll out releases. Copy `deploy/production.env.example` to `deploy/production.env`, then
`./deploy.sh stack`, `./deploy.sh api`, `./deploy.sh sites`.

**Automatic deploys.** Every push and pull request runs the tests (`.github/workflows/deploy.yml`). A push to `main`
that passes them deploys whatever changed since the last deploy: the database is backed up and the migrations are
rehearsed on a copy of that backup before the real ones run; the new API replaces the old one only after its checks
pass (otherwise the old one comes back); the sites switch in one step; and if the public URLs then fail, everything
the run switched is rolled back. Migrations must only add things (CI rejects drops and renames), because a rollback
keeps the migrated database. GitHub signs in to AWS through the `innotech-github-deploy` role (`./deploy.sh ci`), with
the repository's `production` environment holding the `PRODUCTION_ENV` secret (the contents of `production.env`) and
the `AWS_DEPLOY_ROLE` variable. Set the repository variable `AUTO_DEPLOY` to `false` to pause deploys;
`./deploy.sh rollback api|sites` puts the previous release back by hand.

The app **refuses to start** in production if `DEV_SIGN_IN` or `FORCE_REGISTRATION_OPEN` is set, if `SESSION_SECRET` is
shorter than 32 characters, if `GOOGLE_CLIENT_IDS` is empty, if `CORS_ORIGINS` contains `*`, or if `EMAIL_BACKEND` is not
set explicitly.

### Sign-in

- The frontends show Google's "Sign in with Google" button (Google Identity Services) and post the Google ID token to
  `POST /auth/google` with `app` = `portal` or `admin`. The API checks Google's signature, the audience (one of
  `GOOGLE_CLIENT_IDS`), expiry and `email_verified`, and returns its own session token
  (`{token, expires_at, email, name}`): 7 days for the portal, 12 hours for the admin panel. Admin tokens are issued only
  to organisers, and portal tokens are rejected by admin endpoints.
- `@kiet.edu` accounts must carry Google Workspace's `hd=kiet.edu` claim, so a personal Google account registered with a
  KIET address cannot pose as a student.
- Google Cloud Console: OAuth consent screen *External* and *In production* (the scopes `openid email profile` need no
  verification); an OAuth client of type *Web application* whose *Authorised JavaScript origins* are the portal and admin
  origins (plus `http://localhost:3000` and `:3001` for local testing). No redirect URIs are needed.

### Other pieces

- **SES**: `EMAIL_BACKEND=ses`, a verified sender identity and SES production access. Emails are sent after the request
  commits; a failed email is logged and never fails the action.
- **Rate limiting**: invitations per team per day, and join-code attempts per student (stored in PostgreSQL, shared by
  all workers). Caddy caps request bodies at 1 MB.
- **Admins**: people in `SUPER_ADMIN_EMAILS` are always super admins and add department admins in the admin panel.
- **Schedule**: `REGISTRATION_OPENS`, `REGISTRATION_CLOSES` and `NOMINATIONS_DEADLINE` are only the *planned* dates. A super admin
  changes them (or opens/closes registration on the spot) on the admin panel's Schedule page; the change is stored in the
  database and applies to every student's next request, with no redeploy. Department admins can no longer change
  nominations after the deadline; super admins always can.

## How it works

```
app/
  main.py          app setup: CORS, security headers, error format, routers, /health
  config.py        settings from environment variables, with production safety checks
  auth.py          Google ID token verification, session tokens, current student / admin
  rules.py         registration rules (mirrors client/lib/rules.ts)
  models.py        tables and constraints
  schemas.py       request validation and response shapes
  services/        students.py (profile, teams, invitations), admin.py, serializers, audit, limits (rate limits)
  routers/         auth.py (sign-in), students.py, admin.py, dev.py (development only)
  emails.py        SES notifications
migrations/        Alembic
tests/             pytest, against PostgreSQL
```

Errors always return `{"detail": "<message for the user>"}`: 401 not signed in, 403 not allowed or registration
closed, 404 not found (also for other people's teams), 409 conflict (e.g. team locked), 422 invalid input,
429 too many invitations.

**Rules enforced on the server** include: `@kiet.edu` accounts register only as KIET and other accounts only as other
college or school; teams of 2 to 5 from the same college or school; one team per student; school teams only in
Categories 5 and 7; Category 6 only for first-years; the registration window; teams locked after submission;
college, department and year locked while in a team; one pending invitation per student per team; unique team
names and KIET roll numbers; finalist quotas per department; department admins limited to their department.

**Concurrent requests**: every change to a team locks the team row (`SELECT ... FOR UPDATE`), and unique constraints
back up the cross-team rules (one team per student, unique names), so double clicks and simultaneous actions by
teammates cannot break the rules. `tests/test_concurrency.py` fires such races in parallel against PostgreSQL.

### Endpoints

Sign-in: `POST /auth/google` (and `POST /dev/token` in development). Public: `GET /config` (the registration window,
from the server's clock, for pages that need it before anyone signs in).

Student portal (`client/lib/api/live.ts`): `GET /me` (includes the registration window the server enforces), `PUT /me/profile`, `GET /me/team`, `GET /me/invitations`,
`POST /teams`, `POST /teams/join`, `POST /teams/{id}/join-code/reset`, `PATCH /teams/{id}`, `DELETE /teams/{id}`, `POST /teams/{id}/submit`, `POST /teams/{id}/leave`,
`DELETE /teams/{id}/members/{user_id}`, `POST /teams/{id}/invitations`, `DELETE /invitations/{id}`,
`POST /invitations/{id}/accept`, `POST /invitations/{id}/decline`.

Admin panel (`admin-panel/lib/api/live.ts`, which documents scoping and errors in detail): `GET /admin/me`,
`GET /admin/stats`, `GET /admin/teams`, `GET /admin/teams/export`, `GET /admin/teams/{id}`,
`POST /admin/teams/{id}/withdraw|disqualify|restore`, `GET /admin/students`, `GET /admin/students/export`,
`GET|PUT /admin/schedule` and `POST /admin/schedule/open-now|close-now` (registration window and nominations deadline; any
admin reads, only a super admin changes), `GET /admin/finalists`, `PUT /admin/finalists/{department}`, `GET /admin/finalists/summary`,
`POST /admin/results/publish`, `GET|POST /admin/admins`, `DELETE /admin/admins/{email}`, `GET /admin/audit`.

Certificates: `GET /me/certificates` and `GET /me/certificates/{type}.pdf` (students), `GET /judge/certificates` and
`GET /judge/certificates/{type}.pdf` (a judge's own), and super-admin design endpoints
`GET /admin/certificates`, `GET|PUT /admin/certificates/{type}/template|fields|publish|withdraw`,
`GET /admin/certificates/{type}/preview|sample.pdf`, `GET|POST /admin/certificate-fonts`, `DELETE /admin/certificate-fonts/{id}`.
Templates and uploaded fonts are stored in Postgres; PDFs are rendered on demand with PyMuPDF. A student is eligible only
after they are marked present for the department round, and only once results (participation) or department awards
(winner) are published. The recipient always comes from the session, never from the request.

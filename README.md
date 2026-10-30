# Campusly College Management System

A lightweight college administration app using HTML, CSS, vanilla JavaScript, Flask, SQLAlchemy and SQLite/PostgreSQL. The existing student directory and CRUD API are retained; `db.create_all()` adds the new tables without dropping or rewriting existing student records.

## Features

- Separate teacher and student sign-in with hashed passwords, signed HTTP-only sessions, CSRF protection and role checks.
- Dashboard totals and interactive six-month attendance/fee charts.
- Student search, filters, profiles, CRUD and printable student details.
- Teacher roster search, daily attendance, per-student history, date-filtered reports and calculated attendance percentages.
- A private student dashboard with the student's profile, attendance totals, percentage and read-only history.
- Exams, marks, percentage results and automatic letter grades.
- Fee invoices, partial payments, balances and fee reports.
- Course catalog, user accounts, Excel student export and PDF reports.
- Responsive navigation, notifications and a saved light/dark theme.
- SQLite locally; Neon PostgreSQL in production.

## Local setup

Requires Python 3.7 or newer. In PowerShell from the project directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env` before the first run:

1. Generate a secret with `python -c "import secrets; print(secrets.token_urlsafe(48))"` and use it as `SECRET_KEY`.
2. Set `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` (at least 10 characters). The first administrator is created on startup only if no admin exists. Remove the initial-admin variables after setup.
3. Leave `DATABASE_URL` blank for the local `students.db` file in the project root.
4. On local development, teacher and student demo accounts are created automatically. The demo credentials are `teacher@gmail.com` / `teach` and `student@gmail.com` / `student`. The demo student profile is added only when no student/account with that email exists. Existing accounts are never overwritten.

Start the app:

```powershell
python -m backend.app
```

Open <http://127.0.0.1:5000>. Choose **Teacher Login** or **Student Login**; the admin account uses Teacher Login. If PowerShell blocks venv activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` first. `.env` and `students.db` are ignored by Git.

## Accounts and permissions

Only an administrator can create accounts at **User accounts** or `POST /api/auth/users`. Faculty and students cannot self-register. Student accounts must be linked to an existing student record. Passwords are hashed and never returned by the API. The short demo passwords are for local testing only; set unique strong demo passwords in production.

| Role | Access |
|---|---|
| Admin | Manage students, accounts, courses, attendance, exams and fees; view all reports |
| Faculty / Teacher | View, add and edit students; search the roster; mark attendance; view individual attendance and reports; manage courses, exams and results |
| Student | View only their own profile, attendance, exam results and fee records |

Teachers cannot delete students, create accounts, administer fees or access admin-only endpoints. The login is `POST /api/auth/login`; send `{"email":"...","password":"...","login_type":"teacher"}` or use `"student"` for student login. Admin accounts sign in through Teacher Login and retain admin permissions. `GET /api/auth/me` returns the signed-in user and `POST /api/auth/logout` ends the session. Mutating API requests require the `X-CSRF-Token` header. The app supplies it automatically in the browser.

## API reference

All API routes are under `/api`. Dates use `YYYY-MM-DD`; request errors use `{"error":"..."}`. Admin/faculty and student record visibility follows the permissions table above.

| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/csrf` | Start a session and get a CSRF token |
| POST | `/auth/login`, `/auth/logout` | Sign in / sign out |
| GET | `/auth/me` | Current account |
| GET, POST | `/auth/users` | Admin: list accounts / create account |
| GET, POST, PUT, DELETE | `/students`, `/students/<id>` | Student directory CRUD; GET supports `search`, `course`, `department` |
| GET | `/dashboard/stats`, `/dashboard/analytics` | Dashboard totals and six-month chart data |
| GET | `/teacher/dashboard?date=YYYY-MM-DD&search=...` | Teacher roster and attendance dashboard; admin/faculty only |
| GET | `/student/dashboard` | Signed-in student's profile, attendance history and totals |
| GET, POST | `/courses` | List courses / admin creates a course |
| GET, POST | `/attendance` | View history (optional `date`, `student_id`) / staff marks a date's `records` |
| GET | `/attendance/summary` | Attendance days and percentage (optional `student_id`) |
| GET | `/attendance/students/<id>` | Individual attendance history; students may request only themselves |
| GET | `/attendance/report?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` | Daily and per-student attendance totals; admin/faculty only |
| GET, POST | `/exams` | List exams and results / staff creates an exam |
| POST | `/exams/<id>/results` | Staff creates or updates marks; grade is calculated automatically |
| GET, POST | `/fees` | List accessible fee records / admin creates a fee record |
| POST | `/fees/<id>/payments` | Admin records a payment, up to the outstanding balance |
| GET | `/fees/report` | Admin fee totals and itemized report |
| GET | `/reports/students.xlsx` | Admin/faculty Excel export |
| GET | `/reports/students.pdf` | Admin/faculty student PDF report |
| GET | `/reports/students/<id>.pdf` | Admin/faculty student profile PDF |
| GET | `/reports/fees.pdf` | Admin fee PDF report |

Attendance accepts a JSON body such as:

```json
{
  "date": "2026-10-30",
  "records": [
    { "student_id": 1, "status": "Present" },
    { "student_id": 2, "status": "Absent" }
  ]
}
```

Attendance is recorded once per student per date. For this daily-attendance model, the dashboard's **total classes** means distinct dates with attendance records; a student's class totals count their own recorded dates.

Fee, exam and account creation have required fields validated by the API. Duplicate emails/course codes and duplicate daily attendance or exam results are rejected; payments cannot exceed an invoice balance. Student deletion is blocked with HTTP 409 when linked account or academic/fee history exists, to prevent losing college records.

## Postman

1. Run the Flask app and import `Student-Management-System.postman_collection.json`.
2. Set `baseUrl` and the relevant account variables. Use **Teacher login** (`teacher@gmail.com` / `teach`) to test teacher permissions or **Student login** (`student@gmail.com` / `student`) to test student isolation. Use **Admin login** for admin-only APIs.
3. Run the desired login first. Its session cookie is retained by Postman. The collection pre-request script fetches a fresh CSRF token and sends `X-CSRF-Token` on every mutating request.
4. Run student CRUD and module requests. Create an exam/course/student before using its ID in dependent requests. An Add Student test saves the returned numeric ID as `studentId`.

The collection includes requests for role-specific authentication, student CRUD, teacher/student dashboards, attendance reports and history, courses, examinations, fees, users and reports.

## Neon and Vercel deployment

1. Create a PostgreSQL project in [Neon](https://neon.tech) and copy the connection string.
2. Push this folder to a GitHub repository (`git init`, `git add .`, `git commit`, then add the GitHub remote and `git push`).
3. Import the GitHub repository in the Vercel dashboard. The configured Flask entrypoint is `backend.app:app`; `build.py` publishes `frontend/` files to Vercel's `public/` directory.
4. In Vercel project **Settings → Environment Variables**, set the variables below and redeploy. Set the initial admin pair during first database setup; remove those two variables afterward. Set both demo-account passwords to unique strong values if you want the demo accounts created in production; Vercel never falls back to the weak local demo passwords.

| Variable | Local | Vercel |
|---|---|---|
| `DATABASE_URL` | Blank uses local SQLite; optional SQLite/PostgreSQL URI | Required Neon PostgreSQL connection string; SQLite is refused on Vercel |
| `SECRET_KEY` | Required for a stable local session; generate a random value | Required; use a long random secret and keep it private |
| `INITIAL_ADMIN_EMAIL` | Optional first-admin email | Optional during initial setup only |
| `INITIAL_ADMIN_PASSWORD` | Optional first-admin password, 10+ characters | Optional during initial setup only |
| `DEMO_TEACHER_EMAIL` | Defaults to `teacher@gmail.com` | Optional; defaults to `teacher@gmail.com` |
| `DEMO_TEACHER_PASSWORD` | Defaults to `teach` for local demo only | Set a unique strong password to initialize the teacher demo account |
| `DEMO_STUDENT_EMAIL` | Defaults to `student@gmail.com` | Optional; defaults to `student@gmail.com` |
| `DEMO_STUDENT_PASSWORD` | Defaults to `student` for local demo only | Set a unique strong password to initialize the student demo account |
| `VERCEL` | Not set | Set by the platform; enables secure cookies and prohibits SQLite fallback |

The frontend calls same-origin `/api` endpoints. PostgreSQL uses the same SQLAlchemy models as local SQLite; existing student rows are left in place as new module tables are created. Vercel serverless deployments need a persistent external database such as Neon.

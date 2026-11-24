# VaultLedger — combined project

Complete React and Flask coursework project, reorganized into fewer source files.
The existing screens, styles, animation, API routes, investigation workflow, and
synthetic datasets are retained. This is a coursework cryptography prototype,
not production banking software.

## File organization

There are **25 distributed files**: 9 frontend files, 4 backend files,
10 dataset CSVs, this README, and `.gitignore`.
Installing dependencies, building, and running the app create additional files.

| File | Contents |
| --- | --- |
| `frontend/index.html` | HTML entry point |
| `frontend/package.json` | JavaScript dependencies and commands |
| `frontend/vite.config.js` | React/Tailwind build configuration and development API proxy |
| `frontend/src/main.jsx` | React startup, router, authentication and toast providers |
| `frontend/src/App.jsx` | All ten pages and their routes, separated by comments |
| `frontend/src/components.jsx` | Shared UI, bank labels, investigation progress, identity panels, animation and layout |
| `frontend/src/services.jsx` | API requests, session storage, polling and authentication context |
| `frontend/src/index.css` | Existing theme, styles and CSS animations |
| `frontend/public/favicon.svg` | Browser-tab icon |
| `backend/app.py` | SQLite schema/helpers, Flask API, login, approvals and frontend serving |
| `backend/engine.py` | Bank data loading, risk logic, DH-PSI, Paillier operations and investigation runner |
| `backend/test_flow.py` | End-to-end backend workflow checks using a temporary database |
| `backend/requirements.txt` | Python dependencies |

The dataset is now a **separate top-level folder**, alongside `frontend` and
`backend`. All ten CSV files are unchanged:

| Folder | Files |
| --- | --- |
| `dataset/bank_A/` | `customers.csv`, `transactions.csv`, `local_risk_scores.csv` |
| `dataset/bank_B/` | `customers.csv`, `transactions.csv`, `local_risk_scores.csv` |
| `dataset/bank_C/` | `customers.csv`, `transactions.csv`, `local_risk_scores.csv` |
| `dataset/ground_truth/` | `entity_labels.csv` |

Keep these folders together after extracting the ZIP. The engine resolves the
dataset path relative to its own file, independently of your terminal location.
The CSVs represent separate banks in this local demonstration; moving them into
this folder does not introduce a distributed deployment.

## What was combined

- Ten page modules and the previous App module become `src/App.jsx`.
- Six component modules become `src/components.jsx`. Animation type annotations
  are removed so it is ordinary JSX; the animation behavior is retained.
- API, polling and authentication modules become `src/services.jsx`.
- Database helpers and HTTP API become `backend/app.py`.
- Core algorithms and the investigation pipeline become `backend/engine.py`.
- Database callbacks are passed from the app to the engine, avoiding circular
  imports. API URLs and response formats remain unchanged.

Use this extracted project as a new folder. Do not overlay it on the old project,
which would leave the old modules in place. Start with a fresh runtime database;
old databases can contain serialized objects referring to the old module names.

## Run the application

Use a recent Node.js LTS version supported by Vite 8 (Node 22.12+ or Node 24 LTS)
and Python 3.10 or newer. Run these commands from the extracted project folder:

```bash
cd frontend
npm install
npm run build
cd ../backend
python -m pip install -r requirements.txt
python app.py
```

On systems where Python is named `python3`, use that instead of `python`.
A Python virtual environment is optional but recommended for dependency isolation.

Open **http://localhost:8080**. The server creates `backend/vaultledger.db`
automatically on first run. You do not need to create a database manually.

| Bank | Username | Password |
| --- | --- | --- |
| A | `bank_a` | `bank_a123` |
| B | `bank_b` | `bank_b123` |
| C | `bank_c` | `bank_c123` |

Use separate browser tabs for the different banks when demonstrating consent.
Sessions use sessionStorage, so each tab can maintain a different login.

## Frontend development

Keep `python app.py` running in one terminal. In another terminal:

```bash
cd frontend
npm run dev
```

Open **http://localhost:5173**. The development server forwards `/api` requests to
the Flask backend on port 8080. Rebuild with `npm run build` when you want the
Flask-served version on port 8080 to show your latest changes.

## Verify the backend

```bash
cd backend
python test_flow.py
```

The test uses a temporary database and disables stage delays itself. It checks
login, bank isolation, investigation consent, pipeline execution, decryption
approval, identity reveal and audit logs. Success ends with `ALL CHECKS PASSED`.

For the retained console demonstration, run `python engine.py` from `backend`.

## GitHub

Upload the source folders, the synthetic `dataset` folder, README and `.gitignore`.
Dependency folders, build output and runtime databases are excluded by `.gitignore`.
`npm install` may create a `package-lock.json`; committing that generated lockfile
is useful for reproducible dependency versions.

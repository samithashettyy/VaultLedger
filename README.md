# VaultLedger

VaultLedger is a privacy-focused banking investigation system that helps multiple banks identify suspicious transactions and potential fraud without directly sharing sensitive customer information.

The project uses cryptographic techniques to enable secure collaboration between banks while maintaining data privacy.

## Features

- **Multi-Bank System:** Supports three banks with separate login credentials and customer datasets.
- **Fraud Detection:** Analyzes transaction data and risk scores to identify suspicious activity.
- **Privacy-Preserving Matching:** Uses cryptographic techniques to identify common entities across banks.
- **Investigation Dashboard:** Provides an interface to monitor investigations and view results.
- **Consent-Based Investigation:** Requires bank approval before proceeding with sensitive operations.
- **Controlled Identity Reveal:** Customer identities can only be revealed after the required approvals.
- **Audit Logs:** Maintains records of investigation activities.

## Tech Stack

| Component | Technology |
|---|---|
| Frontend | React, Vite, Tailwind CSS |
| Backend | Python, Flask |
| Database | SQLite |
| Cryptography | Diffie-Hellman PSI, Paillier Encryption |

## Project Structure

```text
VaultLedger/
├── frontend/
│   ├── public/
│   ├── src/
│   ├── package.json
│   └── vite.config.js
│
├── backend/
│   ├── app.py
│   ├── engine.py
│   ├── test_flow.py
│   └── requirements.txt
│
├── dataset/
│   ├── bank_A/
│   ├── bank_B/
│   ├── bank_C/
│   └── ground_truth/
│
└── README.md
```

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/VaultLedger.git
cd VaultLedger
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
npm run build
```

### 3. Set up the backend

```bash
cd ../backend
python3 -m pip install -r requirements.txt
```

### 4. Run the application

```bash
python3 app.py
```

Open your browser and visit:

**http://localhost:8080**

The SQLite database is created automatically when the application starts.

## Demo Credentials

| Bank | Username | Password |
|---|---|---|
| Bank A | `bank_a` | `bank_a123` |
| Bank B | `bank_b` | `bank_b123` |
| Bank C | `bank_c` | `bank_c123` |

These credentials are for the local demonstration only.

## How It Works

1. Each bank logs in and accesses its own transaction data.
2. The system analyzes transaction patterns and local risk scores.
3. Privacy-preserving matching helps identify entities appearing across multiple banks.
4. Banks review and approve investigation requests.
5. Approved investigations generate results that can be viewed through the dashboard.
6. Identity reveal requires additional authorization, and investigation activities are recorded in audit logs.

## Testing

To run the backend workflow tests:

```bash
cd backend
python3 test_flow.py
```

A successful run displays `ALL CHECKS PASSED`.

## Note

VaultLedger is an academic prototype developed to explore privacy-preserving fraud detection using cryptography. It uses synthetic banking datasets and is not intended for real-world banking deployment.

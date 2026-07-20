# SYNTHIA SETUP GUIDE

## Part 1: Supabase Initialization

### Step 1: Create Project
Create a new project at [supabase.com](https://supabase.com).

### Step 2: Storage
Create a public bucket named `Synthia-frames`.

### Step 3: Database Schema
Copy the contents of `supabase_schema.sql` from the project root and run it in the Supabase SQL Editor.

## Part 2: Coordinator Setup

### Step 1: Install
```bash
cd coordinator
npm install
```

### Step 2: Environment
Create `.env` in `coordinator/`:
```env
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

### Step 3: Run
```bash
npm run dev
```
# SYNTHIA Setup Guide

This guide will walk you through setting up SYNTHIA from scratch across two machines and a Kaggle notebook.

## PART 1 — SUPABASE SETUP

1.  **Create Account**: Go to [supabase.com](https://supabase.com) and sign up.
2.  **Create Project**: Name it "synthia".
3.  **Run Schema**: Go to the **SQL Editor** and run the schema found in `coordinator/PHASE3_DOCS.md`.
4.  **Enable Vector**: Go to **Extensions**, search for "vector", and enable it.
5.  **Get API Keys**: Go to **Settings -> API**. Copy your **Project URL** and **anon public key**.
6.  **Setup Storage**: Go to **Storage**, create a public bucket named `Synthia-frames`.

## PART 2 — KAGGLE SETUP

1.  **Phone Verification**: Ensure your Kaggle account is phone verified to use GPUs.
2.  **Create Notebook**: Create a new notebook and set **Accelerator** to **GPU T4x2**.
3.  **Enable Internet**: Set **Internet** to "On" in notebook settings.
4.  **Run Server**: Paste the contents of `kaggle_server.py` into a cell and run it.
5.  **Copy URL**: Look for the `fxtun.dev` URL in the output. This is your **ENDPOINT_URL**.

## PART 3 — MACHINE A (COORDINATOR)

1.  **Install Node.js**: Ensure Node v20 or newer is installed.
2.  **Setup Folder**: Navigate to the `coordinator` directory.
3.  **Install**: Run `npm install`.
4.  **Run**: Run `npm run dev`.

## PART 4 — MACHINE B (FRONTEND)

1.  **Install**: Run `npm install` in the project root.
2.  **Run**: Run `npm run dev`.
3.  **Open**: Navigate to `http://localhost:5173`.

## PART 5 — FIRST CONNECTION

1.  Open the **God Mode** panel (G key).
2.  Go to **Connection**.
3.  Enter the **ENDPOINT_URL** from Kaggle.
4.  Enter the **Supabase URL** and **Anon Key**.
5.  Click **Connect**.
6.  Wait for the "SYNTHIA is waking up..." modal.

## PART 6 — DAILY STARTUP SEQUENCE

1.  Start Kaggle (get new URL).
2.  Start Coordinator on Machine A.
3.  Start Frontend on Machine B.
4.  Update URL in God Mode and click Connect.

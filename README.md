```
        ~  ~  ~   ☁️        ☀️
   🏡   🌾🌾🌾   🏡    🐄  🐄   🌳
  ==========================================
      🥛  S M A R T   D A I R Y  🥛
      Village Milk Collection & Dairy System
      Node.js · Express.js · MySQL · HTML/CSS/JS
  ==========================================
```

# 🏡 Smart Milk Collection and Dairy Management System

Village-themed web app for a dairy: milk collection with automatic rates, farmer logins,
10-day payments, and **real SMS / WhatsApp messages** to farmers.

## Run it in VS Code

**Install once:** [Node.js LTS](https://nodejs.org) (version 18 or newer) and MySQL 8 (with MySQL Workbench).

1. Unzip, then in VS Code use **File > Open Folder** and pick `smart-dairy-node`.
2. Open the terminal: **Terminal > New Terminal**.
3. Install packages:
   ```
   npm install
   ```
4. Copy `.env.example` to a new file named `.env`. Open `.env` and set `DB_PASSWORD` to your MySQL
   password and `SECRET_KEY` to any long random text.
5. Create the database, tables, rate trigger and sample data:
   ```
   npm run setup-db
   ```
   (Alternative: open `database/schema.sql` in MySQL Workbench and run it.)
6. Create the admin login (use your own username and password):
   ```
   npm run create-admin -- admin admin123 admin
   ```
7. Start the app:
   ```
   npm start
   ```
   Open **http://localhost:3000**. For auto-restart while editing, use `npm run dev`.
   You can also press **F5** in VS Code to run and debug.

## First use
1. Log in on the **Admin / Staff** tab.
2. **Farmers**: add a farmer, then create their username and password in that row.
3. Log out and try the **Farmer** tab with those details.
4. **Collection**: add a milk entry. The rate is picked from the Rate Chart by Fat and SNF.
5. **Payments**: generate a cycle, set deductions, mark paid (cash / bank / UPI).

## Logins and roles
The login page has two tabs, **Admin / Staff** and **Farmer**, and each only accepts its own accounts.
- `admin`: everything, including creating and resetting farmer logins
- `farmer`: sees only their own collections, payments, messages and tips (My Portal)
- `collector`: farmers, collection, dashboard, reports, alerts, messages
- `accountant`: rate chart, payments, transactions, sales, collection, dashboard, reports

Extra staff: `npm run create-admin -- ravi pass123 collector` (or `accountant`).

## Payments
Pay cycles are 1–10, 11–20 and 21–month end. **Payments > Generate** creates a record for every
farmer who delivered milk and sends each one a statement. The accountant can set deductions and
mark each payment paid with a mode and reference. Every payment is also stored in **Transactions**
(day-wise and mode-wise totals). A farmer is skipped if they already have a payment overlapping
the dates, so the same milk is never paid twice.
To generate automatically every day, schedule `npm run run-cycle` (Windows Task Scheduler or cron).

## Real SMS / WhatsApp messages
Every collection entry, 10-day statement, payment and milk-quantity tip is saved in the farmer portal
and sent to the farmer's phone.
1. In `.env` choose ONE provider:
   - **Fast2SMS** (India, SMS): `SMS_PROVIDER=fast2sms` and `FAST2SMS_KEY=your_api_key`
   - **Twilio** (SMS or WhatsApp): `SMS_PROVIDER=twilio`, `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`;
     add `TWILIO_WHATSAPP=1` for WhatsApp (use Twilio's sandbox number while testing)
2. Restart the app. Log in as admin, open **Messages** and send a **test message** to your own phone.
   If it fails, the exact reason is shown.

On the Messages page the admin can also **resend** failed messages and send an **announcement** to all
active farmers. 10-digit numbers are treated as Indian (+91); change `DEFAULT_COUNTRY_CODE` if needed.
You need your own provider account and credit. SMS to Indian numbers can need sender/template
registration (DLT), so check your provider's current rules; WhatsApp via Twilio is easier to start with.

## Smart alerts and milk tips
Each saved entry is checked: low SNF or fat (possible water mixing), yield drop of 30% or more
(cattle health or feed problem) and yield spike of 50% or more (check the weighing). When yield drops,
the farmer automatically gets tips to increase milk. Limits are in `src/config.js`; the tip wording is in `src/tips.js`.

## Project layout
```
server.js            Express server, sessions, static files
src/api.js           all /api routes (login, farmers, collection, payments, messages ...)
src/services.js      cycles, notifications, alerts, payment generation
src/notify.js        Fast2SMS / Twilio sending
src/alerts.js, tips.js, config.js, db.js
database/schema.sql  tables, rate trigger, daily view, sample data
scripts/             setup-db, create-admin, run-cycle
public/              HTML pages, css/style.css (village theme), js/app.js (shared helpers)
```

## Troubleshooting
- `Access denied for user 'root'`: wrong `DB_PASSWORD` in `.env`.
- `Unknown database 'dairy_db'`: run `npm run setup-db` (MySQL must be running).
- `Cannot find module ...`: run `npm install` inside the project folder.
- Port 3000 busy: change `PORT` in `.env`.
- Changed `.env`? Stop the server (Ctrl+C) and run `npm start` again.


## Smart Milk village theme update

The login page now uses a cow-and-village dairy background with separate Admin/Staff and Farmer login tabs. After authentication, the existing API redirects users by role:
- Admin/staff → `dashboard.html`
- Farmer → `my.html`

The background image is stored at `public/images/milky-mist-farm-background.png`.

All existing project modules, API routes, database schema, setup scripts and package files are retained. This ZIP does not contain a live database export or real user passwords. Use your own MySQL database and `.env` values; never share your `.env` file.

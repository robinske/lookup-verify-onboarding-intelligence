# lookup-bundle

A demo app showing how to use Twilio Lookup and Verify to gate user onboarding with phone intelligence checks.

```mermaid
flowchart LR
    A([User submits signup form]) --> D{Line type any of landline / nonFixedVoIP / tollFree / pager}
    D -- Yes --> R3[❌ Rejected]
    D -- No --> F{Status = inactive<br/>or unreachable?}
    F -- Yes --> R5[❌ Rejected]
    F -- No --> I{Identity Match first & last name<br/>= exact_match or high_partial_match?}
    I -- No --> R8[❌ Rejected]

    I -- Yes --> J[Send OTP via Verify]
    J --> K([User submits OTP code])
    K --> N{status = approved?}
    N -- No --> R12[❌ Rejected]
    N -- Yes --> Z([✅ Approved])
```

## Setup

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Run the app:
   ```bash
   node index.js
   ```

Open [http://localhost:3000](http://localhost:3000).

## Required environment variables

| Variable | Description |
|---|---|
| `TWILIO_ACCOUNT_SID` | Your Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Your Twilio Auth Token |
| `VERIFY_SERVICE_SID` | A Twilio Verify Service SID (`VA...`) |

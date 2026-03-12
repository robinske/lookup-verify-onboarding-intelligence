require("dotenv").config();
const express = require("express");
const twilio = require("twilio");

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VERIFY_SERVICE_SID } =
  process.env;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !VERIFY_SERVICE_SID) {
  throw new Error(
    "Missing required env vars. Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VERIFY_SERVICE_SID.",
  );
}

const PORT = process.env.PORT || 3000;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const app = express();

app.use(express.urlencoded({ extended: false }));
app.set("view engine", "ejs");

function logStep(steps, label, detail, passed) {
  steps.push({ label, detail, passed });
  console.log(passed ? "✅" : "❌", label + ":", detail);
}

function normalize(str) {
  return String(str || "")
    .trim()
    .toLowerCase();
}

async function runOnboardingIntelligence({ phoneNumber, firstName, lastName }) {
  const lookup = (fields, params = {}) =>
    client.lookups.v2.phoneNumbers(phoneNumber).fetch({ fields, ...params });

  const steps = [];

  // ---- 1) Line Type Intelligence
  let lti;
  try {
    lti = await lookup("line_type_intelligence");
  } catch (e) {
    return { ok: false, reason: "LOOKUP_FAILED", detail: e.message, steps };
  }

  const lineType = normalize(lti?.lineTypeIntelligence?.type);
  // https://www.twilio.com/docs/lookup/v2-api/line-type-intelligence#type-property-values
  const blockedLineTypes = new Set(["landline", "nonfixedvoip", "tollfree", "pager"]);
  const ltiPassed = !blockedLineTypes.has(lineType);
  logStep(steps, "Line Type Intelligence", lineType, ltiPassed);
  if (!ltiPassed) return { ok: false, reason: "LINE_TYPE_BLOCKED", steps };

  // ---- 2) Line Status
  // Uncomment once you have access to the package: https://docs.google.com/forms/d/e/1FAIpQLSfXowQ9dUGgDNc_onA0yj2_Mo3tXxFWK67SpDfOZjONothBYQ/viewform
  // let ls;
  // try {
  //   ls = await lookup("line_status");
  // } catch (e) {
  //   return { ok: false, reason: "LOOKUP_FAILED", detail: e.message, steps };
  // }

  // const lineStatus = normalize(ls?.lineStatus?.status);
  // const lsPassed = lineStatus !== "inactive" && lineStatus !== "unreachable";
  // logStep(steps, "Line Status", lineStatus, lsPassed);
  // if (!lsPassed) return { ok: false, reason: "LINE_STATUS_BLOCKED", steps };

  // ---- 3) Identity Match
  let im;
  try {
    im = await lookup("identity_match", { firstName, lastName });
  } catch (e) {
    return { ok: false, reason: "LOOKUP_FAILED", detail: e.message, steps };
  }

  const imErrorCode = im?.identityMatch?.error_code;
  if (imErrorCode) {
    logStep(steps, "Identity Match", `unavailable (error_code: ${imErrorCode})`, false);
    return { ok: false, reason: "IDENTITY_MATCH_UNAVAILABLE", steps };
  }

  const acceptedMatches = new Set(["exact_match", "high_partial_match"]);
  const firstNameMatch = im?.identityMatch?.first_name_match;
  const lastNameMatch = im?.identityMatch?.last_name_match;
  const imPassed = acceptedMatches.has(firstNameMatch) && acceptedMatches.has(lastNameMatch);
  logStep(steps, "Identity Match", `first: ${firstNameMatch}, last: ${lastNameMatch}`, imPassed);
  if (!imPassed) return { ok: false, reason: "IDENTITY_MATCH_FAILED", steps };

  return { ok: true, steps };
}

// -------------------- Routes --------------------

app.get("/", (req, res) => {
  res.render("index", { page: "signup", title: "Signup" });
});

app.post("/start", async (req, res) => {
  const phoneNumber = (req.body.phoneNumber || "").trim();
  const firstName = (req.body.firstName || "").trim();
  const lastName = (req.body.lastName || "").trim();

  if (!phoneNumber || !firstName || !lastName) {
    return res.status(400).render("index", { page: "rejected", title: "Error", reason: "MISSING_FIELDS" });
  }

  const gate = await runOnboardingIntelligence({
    phoneNumber,
    firstName,
    lastName,
  });

  if (!gate.ok) {
    // boolean pass/fail + reason code (rendered)
    return res.status(403).render("index", { page: "rejected", title: "Rejected", reason: gate.reason, steps: gate.steps });
  }

  // ---- 4) Verify: send OTP
  try {
    console.log("Sending OTP to:", phoneNumber);
    await client.verify.v2
      .services(VERIFY_SERVICE_SID)
      .verifications.create({ to: phoneNumber, channel: "sms" });
  } catch (e) {
    console.log(phoneNumber, firstName, lastName);
    console.error("Error sending OTP:", e);
    return res.status(500).render("index", { page: "rejected", title: "Error", reason: "OTP_SEND_FAILED" });
  }

  res.render("index", { page: "verify", title: "Verify", phoneNumber, steps: gate.steps });
});

app.post("/check", async (req, res) => {
  const phoneNumber = (req.body.phoneNumber || "").trim();
  const code = (req.body.code || "").trim();

  if (!phoneNumber || !code) {
    return res.status(400).render("index", { page: "rejected", title: "Error", reason: "MISSING_FIELDS" });
  }

  try {
    const check = await client.verify.v2
      .services(VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phoneNumber, code });

    if (check.status === "approved") {
      return res.render("index", { page: "approved", title: "Approved" });
    }

    return res.status(401).render("index", { page: "rejected", title: "Rejected", reason: "OTP_INVALID" });
  } catch (e) {
    return res.status(500).render("index", { page: "rejected", title: "Error", reason: "OTP_CHECK_FAILED" });
  }
});

app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});

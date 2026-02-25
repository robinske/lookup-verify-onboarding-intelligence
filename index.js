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

function normalize(str) {
  return String(str || "")
    .trim()
    .toLowerCase();
}

async function runOnboardingIntelligence({ phoneNumber, firstName, lastName }) {
  const lookup = (fields, params = {}) =>
    client.lookups.v2.phoneNumbers(phoneNumber).fetch({ fields, ...params });

  // ---- 1) Line Type Intelligence
  let lti;
  try {
    lti = await lookup("line_type_intelligence");
  } catch (e) {
    return { ok: false, reason: "LOOKUP_FAILED", detail: e.message };
  }

  const lineType = normalize(lti?.lineTypeIntelligence?.type);
  const blockedLineTypes = new Set(["landline", "voip", "fixedvoip", "nonfixedvoip", "fixed_voip", "non_fixed_voip"]);

  if (blockedLineTypes.has(lineType)) return { ok: false, reason: "LINE_TYPE_BLOCKED" };
  if (lineType !== "mobile") return { ok: false, reason: "LINE_TYPE_NOT_MOBILE" };

  // ---- 2) Line Status
  let ls;
  try {
    ls = await lookup("line_status");
  } catch (e) {
    return { ok: false, reason: "LOOKUP_FAILED", detail: e.message };
  }

  const lineStatus = normalize(ls?.lineStatus?.status);
  if (lineStatus === "inactive" || lineStatus === "unreachable") {
    return { ok: false, reason: "LINE_STATUS_BLOCKED" };
  }

  // ---- 3) Identity Match
  let im;
  try {
    im = await lookup("identity_match", { firstName, lastName });
  } catch (e) {
    return { ok: false, reason: "LOOKUP_FAILED", detail: e.message };
  }

  const summaryScore = Number(im?.identityMatch?.summary_score);
  if (!Number.isFinite(summaryScore)) return { ok: false, reason: "IDENTITY_SCORE_MISSING" };
  if (summaryScore < 80) return { ok: false, reason: "IDENTITY_SCORE_TOO_LOW" };

  return { ok: true };
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
    return res.status(403).render("index", { page: "rejected", title: "Rejected", reason: gate.reason });
  }

  // ---- 4) Verify: send OTP
  try {
    console.log("Sending OTP to:", phoneNumber);
    console.log(TWILIO_ACCOUNT_SID);
    console.log(VERIFY_SERVICE_SID);
    await client.verify.v2
      .services(VERIFY_SERVICE_SID)
      .verifications.create({ to: phoneNumber, channel: "sms" });
  } catch (e) {
    console.log(phoneNumber, firstName, lastName);
    console.error("Error sending OTP:", e);
    return res.status(500).render("index", { page: "rejected", title: "Error", reason: "OTP_SEND_FAILED" });
  }

  res.render("index", { page: "verify", title: "Verify", phoneNumber });
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

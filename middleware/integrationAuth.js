import crypto from "crypto";

export function verifyUnifiedIntegration(req, res, next) {
  try {
    const providedKey =
      req.headers["x-unified-integration-key"];

    const expectedKey =
      process.env.UNIFIED_INTEGRATION_SECRET;

    if (!providedKey) {
      return res.status(401).json({
        success: false,
        message: "Integration authentication required",
      });
    }
    console.log(
  "[INTEGRATION AUTH DEBUG]",
  {
    headers: Object.keys(req.headers),
    integrationKeyPresent:
      !!req.headers["x-unified-integration-key"],
  }
);
console.log("[INTEGRATION AUTH CHECK]", {
  headerPresent: !!req.headers["x-unified-integration-key"],
  expectedSecretConfigured:
    !!process.env.UNIFIED_INTEGRATION_SECRET,
  receivedLength:
    req.headers["x-unified-integration-key"]?.length || 0,
  expectedLength:
    process.env.UNIFIED_INTEGRATION_SECRET?.length || 0,
});
console.log("[INTEGRATION AUTH COMPARE]", {
  same:
    providedKey === expectedKey,

  receivedHash:
    crypto
      .createHash("sha256")
      .update(providedKey)
      .digest("hex"),

  expectedHash:
    crypto
      .createHash("sha256")
      .update(expectedKey)
      .digest("hex"),
});

    if (!expectedKey) {
      console.error(
        "[UNIFIED_INTEGRATION] UNIFIED_INTEGRATION_SECRET is missing"
      );

      return res.status(500).json({
        success: false,
        message: "Integration secret is not configured",
      });
    }

    const providedBuffer =
      Buffer.from(providedKey);

    const expectedBuffer =
      Buffer.from(expectedKey);

    if (
      providedBuffer.length !==
      expectedBuffer.length
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid integration credentials",
      });
    }

    if (
      !crypto.timingSafeEqual(
        providedBuffer,
        expectedBuffer
      )
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid integration credentials",
      });
    }
    console.log(
  "[INTEGRATION AUTH] SUCCESS - CALLING NEXT()",
  {
    method: req.method,
    path: req.originalUrl,
  }
);



    next();
  } catch (error) {
    console.error(
      "[UNIFIED_INTEGRATION_AUTH_FAILED]",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Integration authentication failed",
    });
  }
}
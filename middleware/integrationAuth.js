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
export function desktopOnly(req, res, next) {
  const ua = req.headers["user-agent"] || "";

  // Standard mobile User-Agent detection
  const mobileUserAgent =
    /Android|iPhone|iPad|iPod|Windows Phone|IEMobile|Opera Mini|BlackBerry/i.test(
      ua
    );

  // Chromium/Chrome mobile client hints
  const mobileClientHint =
    req.headers["sec-ch-ua-mobile"] === "?1";

  // Some browsers/proxies expose these headers
  const mobilePlatform =
    /Android|iOS/i.test(
      req.headers["sec-ch-ua-platform"] || ""
    );

  const isMobile =
    mobileUserAgent ||
    mobileClientHint ||
    mobilePlatform;

  if (isMobile) {
    return res.status(403).json({
      message:
        "HRMS can only be accessed from a desktop or laptop.",
    });
  }

  next();
}
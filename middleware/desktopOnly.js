export function desktopOnly(req, res, next) {
  const ua = req.headers["user-agent"] || "";

  const mobile =
    /Android.*Mobile|iPhone|iPod|Windows Phone|IEMobile|Opera Mini|BlackBerry/i.test(
      ua
    );

  if (mobile) {
    return res.status(403).json({
      message: "HRMS can only be accessed from a desktop or laptop."
    });
  }

  next();
}
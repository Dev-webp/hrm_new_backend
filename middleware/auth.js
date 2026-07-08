import jwt from "jsonwebtoken";

export const ROLES = Object.freeze({
  SUPER_ADMIN: "SUPER_ADMIN",
  OPERATIONAL_MANAGER: "OPERATIONAL_MANAGER",
  MANAGER: "MANAGER",
  SUB_ADMIN: "SUB_ADMIN",
  EMPLOYEE: "EMPLOYEE",
});

export const OPERATIONAL_ROLES = [ROLES.SUPER_ADMIN, ROLES.OPERATIONAL_MANAGER];

export function isOperationalManager(user = {}) {
  return user.role === ROLES.OPERATIONAL_MANAGER;
}

export function canAccessAllBranches(user = {}) {
  return OPERATIONAL_ROLES.includes(user.role);
}

export function canAccessBranchOperations(user = {}, branch) {
  if (canAccessAllBranches(user)) return true;
  if (user.role === ROLES.MANAGER && user.branch === branch) return true;
  if (user.role === ROLES.SUB_ADMIN && user.branch === branch) return true;
  return false;
}

export function isBranchRestrictedOperationalRole(user = {}) {
  return [ROLES.MANAGER, ROLES.SUB_ADMIN].includes(user.role);
}

export function canEditAttendance(user = {}, targetEmployee = {}) {
  if (user.role === ROLES.SUPER_ADMIN) return true;
  if (user.role === ROLES.OPERATIONAL_MANAGER) return true;
  if (isBranchRestrictedOperationalRole(user) && user.branch === targetEmployee.branch) return true;
  return false;
}

export function canAccessUserAttendance(user = {}, targetEmployee = {}) {
  if (user.role === ROLES.SUPER_ADMIN) return true;
  if (user.role === ROLES.OPERATIONAL_MANAGER) return true;
  if (Number(user.id) === Number(targetEmployee.id)) return true;
  if (isBranchRestrictedOperationalRole(user) && user.branch === targetEmployee.branch) return true;
  return false;
}

export function canAccessAuditLog(user = {}, auditLog = {}) {
  if (user.role === ROLES.SUPER_ADMIN) return true;
  if (user.role === ROLES.OPERATIONAL_MANAGER) return true;
  if (user.role === ROLES.EMPLOYEE) return Number(auditLog.user_id) === Number(user.id);
  if (isBranchRestrictedOperationalRole(user)) return auditLog.branch === user.branch;
  return false;
}

export function canCreateClientAuditLog(user = {}) {
  return [ROLES.SUPER_ADMIN, ROLES.OPERATIONAL_MANAGER, ROLES.MANAGER].includes(user.role);
}

export function canEditBreaks(user = {}, targetEmployee = {}) {
  return canEditAttendance(user, targetEmployee);
}

export function normalizeBranchFilter(branch) {
  const value = String(branch || "all").trim();
  if (!value || value.toLowerCase() === "all" || value.toLowerCase() === "all branches") {
    return "all";
  }
  return value;
}

export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(403).json({ message: "Token Required" });

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid Token" });
    req.user = decoded;
    next();
  });
};

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Access Denied" });
    }
    next();
  };
};

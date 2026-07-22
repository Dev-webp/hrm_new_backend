/** The sole canonical branch source for every letter flow. */
export const BRANCH_METADATA = Object.freeze([
  Object.freeze({
    name: "Hyderabad",
    aliases: ["hyderabad", "hyd", "hyderabad branch"],
    address: "Registered Office: 62/A, Sundari Reddy Bhavan, Ground Floor,<br>Vengalrao Nagar, S.R.Nagar,<br>Hyderabad, Telangana - 500038<br>Phone Number: +91 9440467000 / +91 8970567999<br>Email: info@vjcoverseas.com<br>Website: www.vjcoverseas.com",
    officeLocation: "Hyderabad",
  }),
  Object.freeze({
    name: "Bangalore",
    aliases: ["bangalore", "bengaluru", "blr", "bangalore branch", "bengaluru branch"],
    address: "Raheja Arcade, 16 & 17, 5th Block,<br>Opp. Nexus Mall, Koramangala,<br>Bengaluru, Karnataka - 560095<br>Phone Number: +91 9440467000 / +91 8970567999<br>Email: info@vjcoverseas.com<br>Website: www.vjcoverseas.com",
    officeLocation: "Bengaluru",
  }),
]);

const aliasIndex = new Map(BRANCH_METADATA.flatMap((branch) => [branch.name, ...branch.aliases].map((alias) => [alias.toLowerCase(), branch])));

export class UnknownBranchError extends Error {
  constructor(branch) {
    super("Unknown branch.");
    this.statusCode = 400;
    this.branch = String(branch ?? "").trim();
  }
}

export function resolveBranch(value) {
  const inputBranch = String(value ?? "").trim();
  const branch = aliasIndex.get(inputBranch.toLowerCase());
  if (!branch) throw new UnknownBranchError(inputBranch);
  console.info("[LETTER_BRANCH_RESOLUTION]", { inputBranch, normalizedBranch: branch.name, addressSelected: branch.address, officeLocationSelected: branch.officeLocation });
  return branch;
}

// Kept for non-letter compatibility callers; letter flows use resolveBranch().
export function normalizeBranch(value) { return aliasIndex.get(String(value ?? "").trim().toLowerCase())?.name || ""; }
export function getBranchAddress(branch) { return resolveBranch(branch).address; }

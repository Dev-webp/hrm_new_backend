import { pool } from "../middleware/db.js";

function toCamelCase(key) {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;

  const numberValue = Number(value);
  if (!Number.isNaN(numberValue) && value !== "") {
    return numberValue;
  }

  return value;
}

export async function loadPolicyConfig() {
  const result = await pool.query(
    `SELECT config_key, config_value FROM policy_config`
  );

  const config = {};

  for (const row of result.rows) {
    const key = row.config_key;
    const value = parseValue(row.config_value);

    config[key] = value;
    config[toCamelCase(key.toLowerCase())] = value;
  }

  return config;
}
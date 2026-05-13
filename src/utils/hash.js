const crypto = require("crypto");

function hashQuery(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

module.exports = { hashQuery };

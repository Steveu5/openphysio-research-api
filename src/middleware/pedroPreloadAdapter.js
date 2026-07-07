const storedPedroScores = require("../services/storedPedroScores");

const loadScores = storedPedroScores.ensureStoredPedroScoresLoaded;

storedPedroScores.ensureStoredPedroScoresLoaded = (...args) => {
  Promise.resolve()
    .then(() => loadScores(...args))
    .catch((error) => {
      console.warn("Stored PEDro score refresh error:", error.message);
    });

  return Promise.resolve(0);
};

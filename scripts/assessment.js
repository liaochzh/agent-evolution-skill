const { DIMENSIONS, VALID_DIMENSIONS, calculateAssessments } = require('./shared');

function register(registry, storage) {
  registry['assess'] = () => {
    const state = storage.load();
    return calculateAssessments(state.assessments || {});
  };

  registry['assess-update'] = (dimension, score) => {
    const state = storage.load();
    if (!VALID_DIMENSIONS.includes(dimension)) {
      throw new Error(`Invalid dimension: ${dimension}. Valid: ${VALID_DIMENSIONS.join(', ')}`);
    }
    const numScore = parseFloat(score);
    if (isNaN(numScore) || numScore < 1 || numScore > 5) {
      throw new Error('Score must be a number between 1 and 5');
    }

    for (const sub of DIMENSIONS[dimension]) {
      state.assessments[sub] = numScore;
    }
    state.assessments.updated_at = new Date().toISOString();
    storage.save(state);
    return { success: true, dimension, score: numScore };
  };

  registry['assess-detail'] = (dimension, subDimension, score) => {
    const state = storage.load();
    if (!VALID_DIMENSIONS.includes(dimension)) {
      throw new Error(`Invalid dimension: ${dimension}`);
    }
    if (!DIMENSIONS[dimension].includes(subDimension)) {
      throw new Error(`Invalid sub-dimension: ${subDimension}. Valid: ${DIMENSIONS[dimension].join(', ')}`);
    }
    const numScore = parseFloat(score);
    if (isNaN(numScore) || numScore < 1 || numScore > 5) {
      throw new Error('Score must be a number between 1 and 5');
    }
    state.assessments[subDimension] = numScore;
    state.assessments.updated_at = new Date().toISOString();
    storage.save(state);
    return { success: true, dimension, subDimension, score: numScore };
  };
}

module.exports = { register };
function register(registry, storage) {
  registry['identity'] = () => {
    const state = storage.load();
    return state.identity;
  };

  registry['identity-update'] = (field, value) => {
    const state = storage.load();
    const allowedFields = ['role', 'traits'];
    if (!allowedFields.includes(field)) {
      throw new Error(`Invalid field: ${field}. Allowed: ${allowedFields.join(', ')}`);
    }
    
    if (field === 'traits') {
      try {
        state.identity.traits = JSON.parse(value);
      } catch {
        state.identity.traits = value.split(',').map(s => s.trim()).filter(Boolean);
      }
    } else {
      state.identity[field] = value;
    }
    
    state.identity.version += 1;
    state.identity.updatedAt = new Date().toISOString();
    storage.save(state);
    return { success: true, identity: state.identity };
  };

  registry['evolve'] = (change, trigger) => {
    const state = storage.load();
    const event = {
      change,
      trigger,
      timestamp: new Date().toISOString(),
      version: state.identity.version + 1
    };
    state.identity.history.push(event);
    state.identity.version = event.version;
    state.identity.updatedAt = event.timestamp;
    storage.save(state);
    return { success: true, event };
  };
}

module.exports = { register };
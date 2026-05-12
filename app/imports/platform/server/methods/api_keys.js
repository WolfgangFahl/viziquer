import { Meteor } from 'meteor/meteor';
import crypto from 'crypto';

import { ApiKeys } from '../../../db/platform/collections.js';
import { is_project_admin } from '../../../libs/platform/user_rights.js';

const API_KEY_PREFIX = 'vq_';

function hash_api_key(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function generate_api_key() {
  return API_KEY_PREFIX + crypto.randomBytes(32).toString('hex');
}

Meteor.methods({
  generateApiKey: async function (list) {
    const user_id = Meteor.userId();
    if (!user_id) {
      return { status: 401, error: 'Authentication required' };
    }

    if (!await is_project_admin(user_id, list)) {
      return { status: 403, error: 'Admin access required' };
    }

    const raw_key = generate_api_key();
    const hashed_key = hash_api_key(raw_key);

    await ApiKeys.insertAsync({
      projectId: list.projectId,
      apiKey: hashed_key,
      label: list.label || 'Default API Key',
      createdBy: user_id,
      createdAt: new Date(),
      lastUsedAt: null,
    });

    return { status: 200, result: { apiKey: raw_key, label: list.label } };
  },

  revokeApiKey: async function (list) {
    const user_id = Meteor.userId();
    if (!user_id) {
      return { status: 401, error: 'Authentication required' };
    }

    if (!await is_project_admin(user_id, list)) {
      return { status: 403, error: 'Admin access required' };
    }

    await ApiKeys.removeAsync({ _id: list.apiKeyId, projectId: list.projectId });
    return { status: 200 };
  },

  listApiKeys: async function (list) {
    const user_id = Meteor.userId();
    if (!user_id) {
      return { status: 401, error: 'Authentication required' };
    }

    if (!await is_project_admin(user_id, list)) {
      return { status: 403, error: 'Admin access required' };
    }

    const keys = await ApiKeys.find(
      { projectId: list.projectId },
      { fields: { apiKey: 0 } },
    ).fetchAsync();

    return { status: 200, result: keys };
  },
});

async function validate_api_key(key) {
  if (!key || !key.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  const hashed_key = hash_api_key(key);
  const api_key_doc = await ApiKeys.findOneAsync({ apiKey: hashed_key });

  if (!api_key_doc) {
    return null;
  }

  await ApiKeys.updateAsync(
    { _id: api_key_doc._id },
    { $set: { lastUsedAt: new Date() } },
  );

  return { projectId: api_key_doc.projectId, keyId: api_key_doc._id };
}

export { validate_api_key, generate_api_key, hash_api_key, API_KEY_PREFIX };

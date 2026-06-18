const fs = require('fs');
const path = require('path');

const base = require('./app.json');

const googleServicesFile = process.env.GOOGLE_SERVICES_FILE || './google-services.json';
const googleServicesPath = path.resolve(__dirname, googleServicesFile);
const projectId = process.env.EXPO_PROJECT_ID || base.expo.extra?.eas?.projectId;

module.exports = {
  expo: {
    ...base.expo,
    android: {
      ...base.expo.android,
      ...(fs.existsSync(googleServicesPath) ? { googleServicesFile } : {}),
    },
    extra: {
      ...base.expo.extra,
      ...(projectId ? { eas: { projectId } } : {}),
    },
  },
};

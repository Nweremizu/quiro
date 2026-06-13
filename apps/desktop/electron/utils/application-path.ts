import path from 'node:path';
import { app } from 'electron';

const testUserDataPath = process.env.QUIRO_TEST_USER_DATA_DIR;

if (testUserDataPath) {
  app.setPath('userData', testUserDataPath);
  app.setPath('sessionData', path.join(testUserDataPath, 'session'));
} else if (process.env['VITE_DEV_SERVER_URL']) {
  const devUserDataPath = path.join(app.getPath('appData'), 'Quiro-dev');
  app.setPath('userData', devUserDataPath);
  app.setPath('sessionData', path.join(devUserDataPath, 'session'));
}

export const USER_DATA_PATH = app.getPath('userData');
export const RECORDINGS_DIR = path.join(USER_DATA_PATH, 'recordings');

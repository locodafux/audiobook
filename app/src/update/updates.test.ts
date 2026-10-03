import { checkForUpdate } from './updates';

const release = (...names: string[]) => ({ assets: names.map((name) => ({ name, browser_download_url: `https://x/${name}` })) });

describe('checkForUpdate', () => {
  it('returns the newer APK', async () => {
    expect(await checkForUpdate(1, async () => release('hearthread-2.apk'))).toEqual({ versionCode: 2, url: 'https://x/hearthread-2.apk' });
  });
  it('is null when up to date, older, or the asset is not ours', async () => {
    expect(await checkForUpdate(2, async () => release('hearthread-2.apk'))).toBeNull();
    expect(await checkForUpdate(5, async () => release('hearthread-2.apk'))).toBeNull();
    expect(await checkForUpdate(1, async () => release('notes.txt', 'hearthread-x.apk'))).toBeNull();
    expect(await checkForUpdate(1, async () => ({}))).toBeNull();
  });
  it('is null when the check fails', async () => {
    expect(await checkForUpdate(1, async () => Promise.reject(new Error('offline')))).toBeNull();
  });
});
